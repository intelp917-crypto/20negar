//! 20negar Setup Wizard — `setup.exe`
//! =====================================================================
//! A self-contained Windows installer wizard for the 20negar video
//! management system. It has **no external crate dependencies**: instead of
//! bundling an HTTP client or an installer engine it orchestrates the tooling
//! that already ships with Windows (winget, curl.exe, msiexec, PowerShell) plus
//! the official Node.js / Rust bootstrappers.
//!
//! What it does, in order:
//!   1. Show a step-by-step wizard with coloured progress output.
//!   2. Detect the system (admin rights, Node.js, npm, Rust, cargo, git).
//!   3. Install anything missing: Node.js LTS, Rust (rustup) and optionally Git.
//!   4. Locate the project (or clone it from GitHub on a brand-new machine).
//!   5. `npm install` the web dependencies.
//!   6. Build the Rust transfer engine (`cargo build --release`).
//!   7. Build the production frontend bundle.
//!   8. Create a `Start 20negar.bat` launcher and a desktop shortcut.
//!   9. Print a summary and (optionally) start the app.
//!
//! Interactive by default; `--silent` / `--yes` make it unattended.
//! Run `setup.exe --help` for every flag, or `setup.exe --check` for a
//! read-only system report.

use std::env;
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};

// ── constants ────────────────────────────────────────────────────────────────

const DEFAULT_REPO: &str = "https://github.com/intelp917-crypto/20negar.git";
const MIN_NODE_MAJOR: u32 = 20;
const RUSTUP_URL_X64: &str =
    "https://static.rust-lang.org/rustup/dist/x86_64-pc-windows-msvc/rustup-init.exe";
const RUSTUP_URL_ARM64: &str =
    "https://static.rust-lang.org/rustup/dist/aarch64-pc-windows-msvc/rustup-init.exe";
const NODE_SHASUMS_LTS: &str = "https://nodejs.org/dist/latest-lts/SHASUMS256.txt";

const RESET: &str = "\x1b[0m";
const BOLD: &str = "\x1b[1m";
const DIM: &str = "\x1b[2m";
const RED: &str = "\x1b[31m";
const GREEN: &str = "\x1b[32m";
const YELLOW: &str = "\x1b[33m";
const CYAN: &str = "\x1b[36m";
const MAGENTA: &str = "\x1b[35m";

// ── console helpers ──────────────────────────────────────────────────────────

/// Turn on ANSI (VT) processing so the colours render in the Windows console.
#[cfg(windows)]
fn enable_ansi() {
    #[link(name = "kernel32")]
    extern "system" {
        fn GetStdHandle(n_std_handle: u32) -> *mut core::ffi::c_void;
        fn GetConsoleMode(handle: *mut core::ffi::c_void, mode: *mut u32) -> i32;
        fn SetConsoleMode(handle: *mut core::ffi::c_void, mode: u32) -> i32;
    }
    const STD_OUTPUT_HANDLE: u32 = 0xFFFF_FFF5;
    const ENABLE_VIRTUAL_TERMINAL_PROCESSING: u32 = 0x0004;
    unsafe {
        let handle = GetStdHandle(STD_OUTPUT_HANDLE);
        let mut mode = 0u32;
        if GetConsoleMode(handle, &mut mode) != 0 {
            SetConsoleMode(handle, mode | ENABLE_VIRTUAL_TERMINAL_PROCESSING);
        }
    }
}

#[cfg(not(windows))]
fn enable_ansi() {}

fn info(msg: impl std::fmt::Display) {
    println!("  {CYAN}•{RESET} {msg}");
}
fn good(msg: impl std::fmt::Display) {
    println!("  {GREEN}✓{RESET} {msg}");
}
fn warn(msg: impl std::fmt::Display) {
    println!("  {YELLOW}!{RESET} {msg}");
}
fn bad(msg: impl std::fmt::Display) {
    println!("  {RED}✗{RESET} {msg}");
}
fn step(n: u32, total: u32, title: &str) {
    println!("\n{BOLD}{MAGENTA}[{n}/{total}]{RESET} {BOLD}{title}{RESET}");
}
fn rule() {
    println!("{DIM}────────────────────────────────────────────────────────────{RESET}");
}

fn banner() {
    println!();
    println!("{BOLD}{MAGENTA}   ██████╗  ██████╗ ███╗   ██╗███████╗ ██████╗  █████╗ ██████╗ {RESET}");
    println!("{BOLD}{MAGENTA}  ██╔═████╗██╔═████╗████╗  ██║██╔════╝██╔════╝ ██╔══██╗██╔══██╗{RESET}");
    println!("{BOLD}{MAGENTA}  ██║██╔██║██║██╔██║██╔██╗ ██║█████╗  ██║  ███╗███████║██████╔╝{RESET}");
    println!("{BOLD}{MAGENTA}  ████╔╝██║████╔╝██║██║╚██╗██║██╔══╝  ██║   ██║██╔══██║██╔══██╗{RESET}");
    println!("{BOLD}{MAGENTA}  ╚██████╔╝╚██████╔╝██║ ╚████║███████╗╚██████╔╝██║  ██║██║  ██║{RESET}");
    println!("{BOLD}{MAGENTA}   ╚═════╝  ╚═════╝ ╚═╝  ╚═══╝╚══════╝ ╚═════╝ ╚═╝  ╚═╝╚═╝  ╚═╝{RESET}");
    println!("{DIM}        20negar Video Management Setup (v{}){RESET}", env!("CARGO_PKG_VERSION"));
    println!();
}

fn ask(msg: &str, default_yes: bool) -> bool {
    let hint = if default_yes { "[Y/n]" } else { "[y/N]" };
    print!("  {BOLD}{msg}{RESET} {DIM}{hint}{RESET} ");
    let _ = io::stdout().flush();
    let mut line = String::new();
    if io::stdin().read_line(&mut line).is_err() {
        return default_yes;
    }
    let t = line.trim().to_lowercase();
    if t.is_empty() {
        default_yes
    } else {
        matches!(t.as_str(), "y" | "yes")
    }
}

fn pause(msg: &str) {
    print!("  {DIM}{msg}{RESET}");
    let _ = io::stdout().flush();
    let mut line = String::new();
    let _ = io::stdin().read_line(&mut line);
}

// ── process helpers ──────────────────────────────────────────────────────────

fn is_script(program: &str) -> bool {
    let lower = program.to_lowercase();
    lower.ends_with(".cmd") || lower.ends_with(".bat")
}

/// Runs a program with inherited stdio and returns its exit code.
fn run(program: &str, args: &[&str], cwd: Option<&Path>) -> io::Result<i32> {
    let program = if program == "npm" { "npm.cmd" } else { program };
    let mut cmd = if is_script(program) {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(program);
        c
    } else {
        Command::new(program)
    };
    cmd.args(args);
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    let status = cmd.status().map_err(|err| {
        bad(format!("Could not start {program}: {err}"));
        err
    })?;
    Ok(status.code().unwrap_or(-1))
}

fn run_quiet(program: &str, args: &[&str], cwd: Option<&Path>) -> Option<i32> {
    let mut cmd = if is_script(program) {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(program);
        c
    } else {
        Command::new(program)
    };
    cmd.args(args)
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    if let Some(dir) = cwd {
        cmd.current_dir(dir);
    }
    cmd.status().ok().map(|s| s.code().unwrap_or(-1))
}

/// Captures stdout of a program; `None` when it is missing or fails.
fn capture(program: &str, args: &[&str]) -> Option<String> {
    let mut cmd = if is_script(program) {
        let mut c = Command::new("cmd");
        c.arg("/C").arg(program);
        c
    } else {
        Command::new(program)
    };
    let out = cmd
        .args(args)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&out.stdout).trim().to_string())
}

fn which(program: &str) -> Option<PathBuf> {
    let out = Command::new("where")
        .arg(program)
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .output()
        .ok()?;
    if !out.status.success() {
        return None;
    }
    for line in String::from_utf8_lossy(&out.stdout).lines() {
        let p = PathBuf::from(line.trim());
        if p.exists() {
            return Some(p);
        }
    }
    None
}

fn prepend_path(dir: &Path) {
    if !dir.exists() {
        return;
    }
    let current = env::var("PATH").unwrap_or_default();
    let dir_s = dir.display().to_string();
    if current.to_lowercase().contains(&dir_s.to_lowercase()) {
        return;
    }
    env::set_var("PATH", format!("{dir_s};{current}"));
}

/// Re-reads PATH from the registry so freshly installed tools become visible
/// in this process without a reboot.
fn refresh_path() {
    let script = "[Environment]::GetEnvironmentVariable('Path','Machine') + ';' + \
                  [Environment]::GetEnvironmentVariable('Path','User')";
    if let Some(path) = capture("powershell", &["-NoProfile", "-Command", script]) {
        if !path.is_empty() {
            env::set_var("PATH", path);
        }
    }
    if let Some(home) = env::var_os("USERPROFILE") {
        prepend_path(&PathBuf::from(&home).join(".cargo").join("bin"));
        prepend_path(&PathBuf::from(&home).join("AppData").join("Roaming").join("npm"));
    }
    for dir in [
        r"C:\Program Files\nodejs",
        r"C:\Program Files (x86)\nodejs",
    ] {
        prepend_path(Path::new(dir));
    }
}

fn is_admin() -> bool {
    // High integrity level == elevated.
    capture("whoami", &["/groups"])
        .map(|s| s.contains("S-1-16-12288"))
        .unwrap_or(false)
}

fn elevate_self(args: &[String]) -> bool {
    let exe = match env::current_exe() {
        Ok(p) => p,
        Err(_) => return false,
    };
    let quoted: Vec<String> = args
        .iter()
        .map(|a| format!("'\"{}\"'", a.replace('\'', "''")))
        .collect();
    let script = format!(
        "$ErrorActionPreference='Stop'; $p=Start-Process -FilePath '{}' -ArgumentList {} -Verb RunAs -Wait -PassThru; exit $p.ExitCode",
        exe.display().to_string().replace('\'', "''"),
        quoted.join(",")
    );
    run_quiet(
        "powershell",
        &["-NoProfile", "-Command", &script],
        None,
    )
    == Some(0)
}

// ── downloads ────────────────────────────────────────────────────────────────

fn download(url: &str, dest: &Path) -> bool {
    println!("  {DIM}↓ {url}{RESET}");
    if let Some(dir) = dest.parent() {
        if let Err(err) = fs::create_dir_all(dir) {
            bad(&format!("Could not create download directory {}: {err}", dir.display()));
            return false;
        }
    }
    // Never mistake a stale partial download for a successful new download.
    let _ = fs::remove_file(dest);
    let dest_s = dest.display().to_string();
    if which("curl.exe").is_some() || which("curl").is_some() {
        let prog = if which("curl.exe").is_some() {
            "curl.exe"
        } else {
            "curl"
        };
        let code = run_quiet(
            prog,
            &["-L", "--fail", "--retry", "3", "-o", &dest_s, url],
            None,
        );
        if code == Some(0) && dest.exists() {
            return true;
        }
    }
    // Fallback: PowerShell is present on every supported Windows build.
    let script = format!(
        "$ProgressPreference='SilentlyContinue'; \
         [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; \
         $ErrorActionPreference='Stop'; Invoke-WebRequest -Uri '{}' -OutFile '{}'",
         url.replace('\'', "''"), dest_s.replace('\'', "''")
    );
    run_quiet("powershell", &["-NoProfile", "-Command", &script], None) == Some(0)
        && dest.exists()
}

fn temp_file(name: &str) -> PathBuf {
    let base = env::var_os("TEMP")
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from("."));
    base.join("20negar-setup").join(name)
}

/// Resolves the current Node.js LTS Windows x64 MSI straight from nodejs.org.
fn node_lts_msi_url() -> Option<String> {
    let shasums = capture("powershell", &["-NoProfile", "-Command", &format!(
        "(New-Object Net.WebClient).DownloadString('{NODE_SHASUMS_LTS}')"
    )])
    .or_else(|| {
        let out = Command::new("curl.exe")
            .args(["-sL", NODE_SHASUMS_LTS])
            .output()
            .ok()?;
        Some(String::from_utf8_lossy(&out.stdout).to_string())
    })?;
    for line in shasums.lines() {
        let file = line.split_whitespace().last().unwrap_or("");
        if file.starts_with("node-v") && file.ends_with("-x64.msi") {
            return Some(format!("https://nodejs.org/dist/latest-lts/{file}"));
        }
    }
    None
}

// ── component installers ─────────────────────────────────────────────────────

fn node_major() -> Option<u32> {
    let v = capture("node", &["--version"])?;
    let digits: String = v
        .trim_start_matches('v')
        .chars()
        .take_while(|c| c.is_ascii_digit())
        .collect();
    digits.parse().ok()
}

fn install_node(opts: &Options) -> bool {
    // winget is the fastest, signature-verified path when it is available.
    if which("winget").is_some() {
        info("Installing Node.js LTS via winget…");
        let code = run(
            "winget",
            &[
                "install",
                "--id",
                "OpenJS.NodeJS.LTS",
                "-e",
                "--silent",
                "--disable-interactivity",
                "--accept-source-agreements",
                "--accept-package-agreements",
            ],
            None,
        )
        .unwrap_or(-1);
        refresh_path();
        if node_major().map(|v| v >= MIN_NODE_MAJOR).unwrap_or(false) {
            good("Node.js installed through winget.");
            return true;
        }
        if code != 0 {
            warn(format!("winget returned exit code {code}; trying the official MSI…"));
        }
    } else {
        info("winget is not available; using the official Node.js MSI.");
    }

    let url = match node_lts_msi_url() {
        Some(u) => u,
        None => {
            bad("Could not resolve the Node.js LTS download URL. Install Node.js manually: https://nodejs.org/en/download");
            return false;
        }
    };
    let msi = temp_file("node-lts-x64.msi");
    if !download(&url, &msi) {
        bad("Download failed.");
        return false;
    }
    info("Running the Node.js installer silently (this may take a minute)…");
    let log = temp_file("node-msi.log");
    let code = run(
        "msiexec",
        &[
            "/i",
            &msi.display().to_string(),
            "/qn",
            "/norestart",
            "ADDLOCAL=ALL",
            "/l*v",
            &log.display().to_string(),
        ],
        None,
    )
    .unwrap_or(-1);
    refresh_path();
    if node_major().map(|v| v >= MIN_NODE_MAJOR).unwrap_or(false) {
        good("Node.js installed.");
        true
    } else {
        let _ = opts;
        bad(format!(
            "Node.js installer exited with code {code}. See the log: {}",
            log.display()
        ));
        false
    }
}

fn install_rust() -> bool {
    let url = if env::consts::ARCH == "aarch64" {
        RUSTUP_URL_ARM64
    } else {
        RUSTUP_URL_X64
    };
    let init = temp_file("rustup-init.exe");
    info("Downloading the official Rust toolchain bootstrapper…");
    if !download(url, &init) {
        bad("Download failed.");
        return false;
    }
    info("Installing Rust (profile: minimal, toolchain: stable)…");
    let code = run(
        &init.display().to_string(),
        &[
            "-y",
            "--profile",
            "minimal",
            "--default-toolchain",
            "stable",
        ],
        None,
    )
    .unwrap_or(-1);
    refresh_path();
    if which("cargo").is_some() {
        good("Rust & Cargo installed.");
        true
    } else {
        bad(format!(
            "rustup-init exited with code {code}. Install Rust manually: https://rustup.rs"
        ));
        false
    }
}

fn install_git() -> bool {
    if which("winget").is_some() {
        info("Installing Git via winget…");
        let code = run(
            "winget",
            &[
                "install",
                "--id",
                "Git.Git",
                "-e",
                "--silent",
                "--disable-interactivity",
                "--accept-source-agreements",
                "--accept-package-agreements",
            ],
            None,
        ).unwrap_or(-1);
        refresh_path();
        if which("git").is_some() {
            good("Git installed through winget.");
            return true;
        }
        warn(format!("winget Git installation returned {code}; trying the official Git release."));
    }
    // Windows Server and fresh Windows images may not have App Installer/winget.
    let script = "$ErrorActionPreference='Stop'; [Net.ServicePointManager]::SecurityProtocol=[Net.SecurityProtocolType]::Tls12; \
        $r=Invoke-RestMethod 'https://api.github.com/repos/git-for-windows/git/releases/latest'; \
        ($r.assets | Where-Object { $_.name -match '^Git-.*-64-bit.exe$' } | Select-Object -First 1).browser_download_url";
    if let Some(url) = capture("powershell", &["-NoProfile", "-Command", script]) {
        let setup = temp_file("git-setup.exe");
        if url.starts_with("https://github.com/git-for-windows/git/releases/download/") && download(&url, &setup) {
            let code = run(&setup.display().to_string(), &["/VERYSILENT", "/NORESTART", "/SP-"], None).unwrap_or(-1);
            refresh_path();
            if code == 0 && which("git").is_some() {
                good("Git installed from the official release.");
                return true;
            }
            warn(format!("Git installer failed with exit code {code}. Run setup as administrator."));
        }
    }
    warn("Git could not be installed automatically. Download it from https://git-scm.com/download/win if you need to clone the repository.");
    false
}

fn ensure_msvc() -> bool {
    let vswhere = PathBuf::from(env::var_os("ProgramFiles(x86)").unwrap_or_else(|| r"C:\Program Files (x86)".into()))
        .join(r"Microsoft Visual Studio\Installer\vswhere.exe");
    if capture(&vswhere.display().to_string(), &["-latest", "-products", "*", "-requires", "Microsoft.VisualStudio.Component.VC.Tools.x86.x64", "-property", "installationPath"])
        .map(|s| !s.is_empty()).unwrap_or(false) {
        good("Visual C++ build tools detected.");
        return true;
    }
    info("Installing Visual Studio C++ Build Tools and Windows SDK (required by Rust MSVC; several GB)…");
    let setup = temp_file("vs_buildtools.exe");
    if !download("https://aka.ms/vs/17/release/vs_BuildTools.exe", &setup) {
        return false;
    }
    let code = run(&setup.display().to_string(), &["--passive", "--wait", "--norestart", "--add", "Microsoft.VisualStudio.Workload.VCTools", "--includeRecommended"], None).unwrap_or(-1);
    if code == 3010 {
        warn("C++ Build Tools require a Windows restart. Restart and rerun setup before building the engine.");
        return false;
    }
    if code != 0 {
        bad(format!("C++ Build Tools installation failed with exit code {code}. Install the Desktop development with C++ workload, then rerun setup as administrator."));
        return false;
    }
    good("Visual C++ Build Tools installed.");
    true
}

// ── project helpers ──────────────────────────────────────────────────────────

fn find_project_root(start: &Path) -> Option<PathBuf> {
    let mut current = Some(start.to_path_buf());
    while let Some(dir) = current {
        if dir.join("package.json").exists() && dir.join("server.ts").exists() {
            return Some(dir);
        }
        current = dir.parent().map(|p| p.to_path_buf());
    }
    None
}

fn npm_install(root: &Path, use_ci: bool) -> bool {
    let has_lock = root.join("package-lock.json").exists();
    let sub = if use_ci && has_lock { "ci" } else { "install" };
    info(format!("Running `npm {sub}` (this is the slow step — several minutes on a fresh machine)…"));
    let code = run("npm", &[sub, "--no-audit", "--no-fund"], Some(root)).unwrap_or(-1);
    if code == 0 {
        good("Web dependencies installed.");
        true
    } else if sub == "ci" {
        warn("`npm ci` failed (the lockfile may be out of date); falling back to `npm install`…");
        let code2 = run("npm", &["install", "--no-audit", "--no-fund"], Some(root)).unwrap_or(-1);
        if code2 == 0 {
            good("Web dependencies installed.");
            true
        } else {
            bad(format!("`npm install` failed with exit code {code2}."));
            false
        }
    } else {
        bad(format!("`npm install` failed with exit code {code}."));
        false
    }
}

/// Creates a production environment file only on a fresh checkout.
///
/// The secret is generated by the Windows cryptography provider through
/// PowerShell and is kept in memory only long enough to write `.env`. The
/// create-new write protects an existing file even if another process races
/// this installer.
fn ensure_environment(root: &Path) -> bool {
    let env_path = root.join(".env");
    if env_path.exists() {
        good("Existing .env preserved.");
        return true;
    }

    let template_path = root.join(".env.example");
    let template = match fs::read_to_string(&template_path) {
        Ok(contents) => contents,
        Err(err) => {
            bad(format!("Could not read .env.example: {err}"));
            return false;
        }
    };

    let script = "$bytes = New-Object byte[] 48; \
        $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create(); \
        try { $rng.GetBytes($bytes) } finally { $rng.Dispose() }; \
        ($bytes | ForEach-Object { $_.ToString('x2') }) -join ''";
    let secret = match capture(
        "powershell",
        &["-NoProfile", "-NonInteractive", "-Command", script],
    ) {
        Some(value) if value.len() == 96 && value.chars().all(|c| c.is_ascii_hexdigit()) => value,
        _ => {
            bad("Could not generate a cryptographically secure JWT secret. No .env was created.");
            return false;
        }
    };

    let mut found_secret = false;
    let mut found_production = false;
    let mut rendered = Vec::new();
    for line in template.lines() {
        let key = line.trim_start();
        if key.starts_with("JWT_SECRET=") {
            rendered.push(format!("JWT_SECRET=\"{secret}\""));
            found_secret = true;
        } else if key.starts_with("NODE_ENV=") {
            rendered.push("NODE_ENV=\"production\"".to_string());
            found_production = true;
        } else {
            rendered.push(line.to_string());
        }
    }
    if !found_secret {
        bad(".env.example does not define JWT_SECRET. No .env was created.");
        return false;
    }
    if !found_production {
        rendered.insert(0, "NODE_ENV=\"production\"".to_string());
    }
    let mut contents = rendered.join("\n");
    if template.ends_with('\n') || template.ends_with('\r') {
        contents.push('\n');
    }

    let mut file = match fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(&env_path)
    {
        Ok(file) => file,
        Err(err) if err.kind() == io::ErrorKind::AlreadyExists => {
            good("Existing .env preserved.");
            return true;
        }
        Err(err) => {
            bad(format!("Could not create .env: {err}"));
            return false;
        }
    };

    if let Err(err) = file.write_all(contents.as_bytes()) {
        let _ = fs::remove_file(&env_path);
        bad(format!("Could not write .env: {err}"));
        return false;
    }
    good("Created production .env from .env.example.");
    true
}

fn build_engine(root: &Path) -> bool {
    let manifest = root.join("rust").join("negartransfer").join("Cargo.toml");
    if !manifest.exists() {
        warn("The Rust engine source is missing; skipping the engine build.");
        return false;
    }
    info("Building the Rust transfer engine (cargo build --release)…");
    let code = run(
        "cargo",
        &[
            "build",
            "--release",
            "--manifest-path",
            &manifest.display().to_string(),
        ],
        Some(root),
    )
    .unwrap_or(-1);
    let binary = root
        .join("rust")
        .join("negartransfer")
        .join("target")
        .join("release")
        .join("negartransfer.exe");
    if code == 0 && binary.exists() {
        good(format!("Engine built: {}", binary.display()));
        true
    } else {
        bad(format!("Engine build failed with exit code {code}."));
        false
    }
}

fn build_frontend(root: &Path) -> bool {
    info("Building the production frontend bundle (npm run build)…");
    let code = run("npm", &["run", "build"], Some(root)).unwrap_or(-1);
    if code == 0 {
        good("Frontend bundle built into dist/.");
        true
    } else {
        bad(format!("`npm run build` failed with exit code {code}."));
        false
    }
}

/// Creates a production .env once, without overwriting an operator's existing
/// configuration. The secret is generated by Windows CNG through PowerShell
/// and is never printed.
fn ensure_env(root: &Path) -> bool {
    let env_path = root.join(".env");
    if env_path.exists() {
        good("Existing .env configuration preserved.");
        return true;
    }

    let example = root.join(".env.example");
    let template = match fs::read_to_string(&example) {
        Ok(value) => value,
        Err(err) => {
            bad(format!("Could not read {}: {err}", example.display()));
            return false;
        }
    };
    let random_script = "$b=New-Object byte[] 48; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToHexString($b)";
    let secret = match capture("powershell", &["-NoProfile", "-Command", random_script]) {
        Some(value) if value.len() >= 64 => value,
        _ => {
            bad("Could not generate a secure JWT secret. Create .env manually and rerun setup.");
            return false;
        }
    };
    let configured = template
        .lines()
        .map(|line| if line.trim_start().starts_with("JWT_SECRET=") {
            format!("JWT_SECRET=\"{secret}\"")
        } else {
            line.to_string()
        })
        .collect::<Vec<_>>()
        .join("\r\n") + "\r\n";

    match fs::write(&env_path, configured) {
        Ok(_) => {
            good("Production .env created with a generated JWT secret.");
            true
        }
        Err(err) => {
            bad(format!("Could not create {}: {err}", env_path.display()));
            false
        }
    }
}

fn write_launcher(root: &Path) -> Option<PathBuf> {
    let bat = root.join("Start 20negar.bat");
    let body = format!(
        "@echo off\r\n\
         title 20negar Video Management\r\n\
         cd /d \"{root}\"\r\n\
         set \"PATH=%USERPROFILE%\\.cargo\\bin;%PATH%\"\r\n\
         echo Starting 20negar...\r\n\
         set \"NODE_ENV=production\"\r\n\
         call npm start\r\n\
         echo.\r\n\
         echo The server stopped. Press any key to close.\r\n\
         pause >nul\r\n",
        root = root.display()
    );
    match fs::write(&bat, body) {
        Ok(_) => Some(bat),
        Err(err) => {
            warn(format!("Could not write the launcher: {err}"));
            None
        }
    }
}

fn create_shortcut(target: &Path, root: &Path, name: &str) -> bool {
    let desktop = env::var_os("USERPROFILE")
        .map(PathBuf::from)
        .map(|h| h.join("Desktop").join(format!("{name}.lnk")));
    let link = match desktop {
        Some(l) => l,
        None => return false,
    };
    let esc = |p: &str| p.replace('\'', "''");
    let script = format!(
        "$ws = New-Object -ComObject WScript.Shell; \
         $s = $ws.CreateShortcut('{link}'); \
         $s.TargetPath = '{target}'; \
         $s.WorkingDirectory = '{cwd}'; \
         $s.IconLocation = '{icon}'; \
         $s.Description = '20negar video management system'; \
         $s.Save()",
        link = esc(&link.display().to_string()),
        target = esc(&target.display().to_string()),
        cwd = esc(&root.display().to_string()),
        icon = esc(&target.display().to_string()),
    );
    run_quiet("powershell", &["-NoProfile", "-Command", &script], None) == Some(0) && link.exists()
}

fn open_folder(path: &Path) {
    let _ = run_quiet("explorer", &[&path.display().to_string()], None);
}

// ── CLI options ──────────────────────────────────────────────────────────────

struct Options {
    yes: bool,
    silent: bool,
    check_only: bool,
    start: bool,
    skip_node: bool,
    skip_rust: bool,
    skip_git: bool,
    skip_npm: bool,
    skip_engine: bool,
    skip_frontend: bool,
    no_shortcut: bool,
    ci: bool,
    no_elevate: bool,
    repo: String,
    dir: Option<PathBuf>,
}

impl Default for Options {
    fn default() -> Self {
        Options {
            yes: false,
            silent: false,
            check_only: false,
            start: true,
            skip_node: false,
            skip_rust: false,
            skip_git: false,
            skip_npm: false,
            skip_engine: false,
            skip_frontend: false,
            no_shortcut: false,
            ci: false,
            no_elevate: false,
            repo: DEFAULT_REPO.to_string(),
            dir: None,
        }
    }
}

fn help() {
    banner();
    println!("{BOLD}USAGE{RESET}");
    println!("  setup.exe [options]");
    println!();
    println!("{BOLD}OPTIONS{RESET}");
    println!("  -y, --yes            Accept every prompt (non-interactive).");
    println!("      --silent         Same as --yes, unattended.");
    println!("      --check          Report what is installed and exit (no changes).");
    println!("      --no-start       Do not launch the app when finished.");
    println!("      --start          Launch the app when finished (default).");
    println!("      --skip-node      Do not install Node.js.");
    println!("      --skip-rust      Do not install Rust.");
    println!("      --skip-git       Do not install Git.");
    println!("      --skip-npm       Do not run npm install.");
    println!("      --skip-engine    Do not build the Rust transfer engine.");
    println!("      --with-frontend  Build the production frontend (default).");
    println!("      --skip-frontend  Skip the frontend build (requires an existing dist/).");
    println!("      --ci             Prefer `npm ci` over `npm install`.");
    println!("      --no-shortcut    Do not create a desktop shortcut.");
    println!("      --no-elevate     Never attempt to self-elevate.");
    println!("      --repo <url>     Git repository to clone when no project is found.");
    println!("      --dir <path>     Project directory to set up.");
    println!("  -h, --help           Show this help.");
    println!();
    println!("{DIM}Example (fresh machine):  setup.exe --dir C:\\20negar{RESET}");
}

fn parse_args() -> Option<Options> {
    let mut o = Options::default();
    let mut args = env::args().skip(1);
    while let Some(a) = args.next() {
        match a.as_str() {
            "-h" | "--help" => {
                help();
                return None;
            }
            "-y" | "--yes" => o.yes = true,
            "--silent" => {
                o.silent = true;
                o.yes = true;
            }
            "--check" => o.check_only = true,
            "--start" => o.start = true,
            "--no-start" => o.start = false,
            "--skip-node" => o.skip_node = true,
            "--skip-rust" => o.skip_rust = true,
            "--skip-git" => o.skip_git = true,
            "--skip-npm" => o.skip_npm = true,
            "--skip-engine" => o.skip_engine = true,
            "--with-frontend" => o.skip_frontend = false,
            "--skip-frontend" => o.skip_frontend = true,
            "--ci" => o.ci = true,
            "--no-shortcut" => o.no_shortcut = true,
            "--no-elevate" => o.no_elevate = true,
            "--repo" => o.repo = args.next().unwrap_or(o.repo),
            "--dir" => o.dir = args.next().map(PathBuf::from),
            other => {
                warn(format!("Ignoring unknown option: {other}"));
            }
        }
    }
    Some(o)
}

// ── main ─────────────────────────────────────────────────────────────────────

fn main() {
    enable_ansi();
    let opts = match parse_args() {
        Some(o) => o,
        None => return,
    };
    banner();

    let total_steps = 5;

    // ── step 1: detect ──────────────────────────────────────────────────────
    step(1, total_steps, "Checking this system");
    let admin = is_admin();
    info(format!(
        "Windows / {} — running {}",
        env::consts::ARCH,
        if admin { "as administrator" } else { "as a standard user" }
    ));

    let node = node_major();
    let has_npm = which("npm").is_some();
    let has_cargo = which("cargo").is_some();
    let mut has_git = which("git").is_some();

    match node {
        Some(v) if v >= MIN_NODE_MAJOR => good(format!("Node.js v{v} detected.")),
        Some(v) => warn(format!("Node.js v{v} is older than the required v{MIN_NODE_MAJOR}.")),
        None => warn("Node.js was not found."),
    }
    if has_npm {
        good("npm detected.");
    } else {
        warn("npm was not found (it ships with Node.js).");
    }
    if has_cargo {
        good("Rust / Cargo detected.");
    } else {
        warn("Rust was not found (needed to build the transfer engine).");
    }
    if has_git {
        good("Git detected.");
    } else {
        warn("Git was not found (only needed to clone the repository).");
    }

    // --check is genuinely read-only: do not clone, install, or inspect a
    // project directory just to print the system report.
    if opts.check_only {
        println!();
        rule();
        println!("{BOLD}System report only — nothing was changed ({RESET}{DIM}--check{RESET}{BOLD}).{RESET}");
        rule();
        if !opts.silent {
            pause("Press Enter to exit…");
        }
        return;
    }

    // Elevate before cloning: a fresh machine needs Git before it has a project.
    if !admin && !opts.no_elevate && (!has_git || node.map(|v| v < MIN_NODE_MAJOR).unwrap_or(true) || !opts.skip_engine) {
        warn("Installing prerequisites may require administrator rights.");
        if opts.yes || ask("Relaunch this wizard as administrator?", true) {
            let mut args: Vec<String> = env::args().skip(1).collect();
            args.push("--no-elevate".into());
            args.push("--yes".into());
            // Preserve relative --dir resolution across UAC's working-directory change.
            if let Some(index) = args.iter().position(|a| a == "--dir") {
                if let Some(dir) = args.get_mut(index + 1) {
                    if let Ok(absolute) = std::path::absolute(&*dir) {
                        *dir = absolute.display().to_string();
                    }
                }
            }
            if elevate_self(&args) {
                return;
            }
            bad("The elevated setup failed or elevation was declined. See the elevated window for errors; rerun as administrator.");
            std::process::exit(1);
        }
    }

    // ── step 2: locate the project ──────────────────────────────────────────
    step(2, total_steps, "Locating the project");
    let exe_dir = env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));

    let mut root = match opts.dir.as_ref() {
        Some(dir) => {
            if dir.join("package.json").exists() && dir.join("server.ts").exists() {
                Some(std::path::absolute(dir).unwrap_or_else(|_| dir.clone()))
            } else {
                None
            }
        }
        None => find_project_root(&exe_dir),
    };

    if let Some(ref r) = root {
        good(format!("Project found: {}", r.display()));
    } else {
        let target = opts
            .dir
            .clone()
            .unwrap_or_else(|| env::current_dir().unwrap_or_else(|_| PathBuf::from(".")).join("20negar"));
        info(format!(
            "No project next to the installer. It will be cloned into: {}",
            target.display()
        ));
        // Git is needed before the clone, while the regular prerequisites step
        // below runs after the project has been located.
        if !has_git && !opts.skip_git && (opts.yes || ask("Install Git now so the repository can be cloned?", true)) {
            has_git = install_git();
        }
        if !has_git {
            bad("Git is required to clone the project. Install Git and run setup again, or copy the project folder next to setup.exe.");
            if !opts.silent {
                pause("Press Enter to exit…");
            }
            std::process::exit(1);
        }
        let code = run(
            "git",
            &["clone", "--depth", "1", &opts.repo, &target.display().to_string()],
            None,
        )
        .unwrap_or(-1);
        if code == 0 && target.join("package.json").exists() {
            good(format!("Repository cloned into {}", target.display()));
            root = Some(target);
        } else {
            bad("Cloning failed. Check your network connection and the repository URL.");
            if !opts.silent {
                pause("Press Enter to exit…");
            }
            std::process::exit(1);
        }
    }
    let root = root.unwrap();

    if !ensure_environment(&root) {
        bad("Setup cannot continue without a valid production .env.");
        if !opts.silent {
            pause("Press Enter to exit…");
        }
        std::process::exit(1);
    }

    if opts.skip_frontend && !root.join("dist").join("index.html").is_file() {
        bad("--skip-frontend requires an existing dist/index.html. Rerun setup without --skip-frontend to build the production frontend.");
        std::process::exit(1);
    }

    // ── step 3: prerequisites ───────────────────────────────────────────────
    step(3, total_steps, "Installing prerequisites");

    if !opts.skip_node && node.map(|v| v < MIN_NODE_MAJOR).unwrap_or(true) {
        if opts.yes || ask("Install Node.js LTS now?", true) {
            if !install_node(&opts) {
                bad("Node.js installation did not complete; setup cannot continue.");
                std::process::exit(1);
            }
        }
    } else if node.is_some() {
        good("Node.js is already installed — skipping.");
    }

    if !opts.skip_rust && !has_cargo {
        if opts.yes || ask("Install Rust (for the transfer engine)?", true) {
            if !opts.skip_engine && !ensure_msvc() {
                std::process::exit(1);
            }
            if !install_rust() && !opts.skip_engine {
                bad("Rust installation did not complete; setup cannot build the transfer engine.");
                std::process::exit(1);
            }
        }
    } else if has_cargo {
        good("Rust is already installed — skipping.");
    }

    if !opts.skip_git && !has_git {
        if opts.yes || ask("Install Git?", true) {
            has_git = install_git();
            if !has_git {
                bad("Git installation did not complete. Git is required when setup must clone the repository.");
            }
        }
    } else if has_git {
        good("Git is already installed — skipping.");
    }

    refresh_path();
    if node_major().map(|v| v < MIN_NODE_MAJOR).unwrap_or(true) {
        bad(format!("Node.js {MIN_NODE_MAJOR}+ is required. Upgrade Node.js and rerun setup."));
        std::process::exit(1);
    }
    if which("npm").is_none() {
        bad("npm is still not available. Open a NEW terminal (so PATH refreshes) and run setup.exe again.");
        if !opts.silent {
            pause("Press Enter to exit…");
        }
        std::process::exit(1);
    }
    if !opts.skip_engine && which("cargo").is_none() {
        bad("Cargo is still not available; install Rust or rerun with --skip-engine.");
        if !opts.silent {
            pause("Press Enter to exit…");
        }
        std::process::exit(1);
    }

    // ── step 4: dependencies & engine ───────────────────────────────────────
    step(4, total_steps, "Installing dependencies and building");

    let mut npm_ok = true;
    if !opts.skip_npm {
        npm_ok = npm_install(&root, opts.ci);
    }

    let env_ok = ensure_env(&root);

    let mut engine_ok = true;
    if !opts.skip_engine {
        if which("cargo").is_some() {
            if !ensure_msvc() {
                std::process::exit(1);
            }
            engine_ok = build_engine(&root);
        } else {
            warn("Cargo is unavailable — the app will run with the built-in Node transfer path instead of the Rust engine.");
            engine_ok = false;
        }
    }

    let frontend_ok = if !opts.skip_frontend && npm_ok {
        build_frontend(&root)
    } else {
        true
    };

    // A setup run is successful only when every requested build step passed.
    // Do not leave a half-installed machine with a zero exit code.
    if !npm_ok || !env_ok || (!opts.skip_engine && !engine_ok) || !frontend_ok {
        bad("Setup did not complete successfully; see the errors above and rerun after fixing them.");
        if !opts.silent {
            pause("Press Enter to exit…");
        }
        std::process::exit(1);
    }

    // ── step 5: finish ──────────────────────────────────────────────────────
    step(5, total_steps, "Finishing up");

    let launcher = write_launcher(&root);
    if launcher.is_none() {
        bad("Setup could not create the production launcher. Check directory permissions and rerun setup.");
        std::process::exit(1);
    }
    if let Some(ref bat) = launcher {
        good(format!("Launcher created: {}", bat.display()));
    }

    if !opts.no_shortcut {
        if let Some(ref bat) = launcher {
            if create_shortcut(bat, &root, "20negar") {
                good("Desktop shortcut created.");
            } else {
                warn("Desktop shortcut could not be created.");
            }
        }
    }

    println!();
    rule();
    println!("{BOLD}Setup summary{RESET}");
    rule();
    println!("  Project      : {}", root.display());
    println!(
        "  Web deps     : {}",
        if npm_ok { format!("{GREEN}ok{RESET}") } else { format!("{RED}failed{RESET}") }
    );
    println!(
        "  Rust engine  : {}",
        if opts.skip_engine { format!("{DIM}skipped{RESET}") } else if engine_ok { format!("{GREEN}built{RESET}") } else { format!("{RED}failed{RESET}") }
    );
    println!(
        "  Frontend     : {}",
        if opts.skip_frontend { format!("{DIM}using existing dist/{RESET}") } else if frontend_ok { format!("{GREEN}ok{RESET}") } else { format!("{RED}failed{RESET}") }
    );
    rule();
    println!();
    println!("{BOLD}Next steps{RESET}");
    println!("  • Start the app with the desktop shortcut, or run:");
    println!("      {CYAN}cd /d \"{}\" && set \"NODE_ENV=production\" && npm start{RESET}", root.display());
    println!("  • Open {CYAN}http://localhost:3000{RESET} in your browser.");
    println!("  • On first run, set {CYAN}SUPERADMIN_INITIAL_PASSWORD{RESET} in a .env file to create the admin account.");
    println!();

    if opts.start && npm_ok {
        let start_now = opts.yes || ask("Start 20negar now?", true);
        if start_now {
            if let Some(ref bat) = launcher {
                info("Launching the server in a new window…");
                let _ = run_quiet("cmd", &["/C", "start", "", &bat.display().to_string()], Some(&root));
                std::thread::sleep(std::time::Duration::from_millis(1500));
                open_folder(&root);
            }
        }
    }

    println!("{GREEN}{BOLD}Done.{RESET} {DIM}Double-click \"Start 20negar.bat\" any time to launch the app.{RESET}");
    if !opts.silent {
        pause("Press Enter to close…");
    }
}

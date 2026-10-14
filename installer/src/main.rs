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
//!   7. Optionally build the production frontend bundle.
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

fn info(msg: &str) {
    println!("  {CYAN}•{RESET} {msg}");
}
fn good(msg: &str) {
    println!("  {GREEN}✓{RESET} {msg}");
}
fn warn(msg: &str) {
    println!("  {YELLOW}!{RESET} {msg}");
}
fn bad(msg: &str) {
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
    println!("{DIM}        Setup Wizard — سامانه مدیریت ویدیو ۲۰نگار (v1.0.0){RESET}");
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
    Ok(cmd.status()?.code().unwrap_or(-1))
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
        prepend_path(&PathBuf::from(home).join(".cargo").join("bin"));
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
        .map(|a| format!("'{}'", a.replace('\'', "''")))
        .collect();
    let script = format!(
        "Start-Process -FilePath '{}' -ArgumentList {} -Verb RunAs",
        exe.display().to_string().replace('\'', "''"),
        quoted.join(",")
    );
    run_quiet(
        "powershell",
        &["-NoProfile", "-Command", &format!("{script}; exit 0")],
        None,
    )
    .is_some()
}

// ── downloads ────────────────────────────────────────────────────────────────

fn download(url: &str, dest: &Path) -> bool {
    println!("  {DIM}↓ {url}{RESET}");
    if let Some(dir) = dest.parent() {
        let _ = fs::create_dir_all(dir);
    }
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
         Invoke-WebRequest -Uri '{url}' -OutFile '{dest_s}'"
    );
    run_quiet("powershell", &["-NoProfile", "-Command", &script], None);
    dest.exists()
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
        if node_major().is_some() {
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
    if node_major().is_some() {
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
        let _ = run(
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
        );
        refresh_path();
        if which("git").is_some() {
            good("Git installed through winget.");
            return true;
        }
    }
    warn("Git could not be installed automatically. Download it from https://git-scm.com/download/win if you need to clone the repository.");
    false
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

fn write_launcher(root: &Path) -> Option<PathBuf> {
    let bat = root.join("Start 20negar.bat");
    let body = format!(
        "@echo off\r\n\
         title 20negar — سامانه مدیریت ویدیو\r\n\
         cd /d \"{root}\"\r\n\
         set \"PATH=%USERPROFILE%\\.cargo\\bin;%PATH%\"\r\n\
         echo Starting 20negar…\r\n\
         npm run dev\r\n\
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
    run_quiet("powershell", &["-NoProfile", "-Command", &script], None).is_some() && link.exists()
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
            skip_frontend: true,
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
    println!("      --with-frontend  Also run the production frontend build.");
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
    let has_git = which("git").is_some();

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

    // ── step 2: locate the project ──────────────────────────────────────────
    step(2, total_steps, "Locating the project");
    let exe_dir = env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.to_path_buf()))
        .unwrap_or_else(|| PathBuf::from("."));

    let mut root = opts
        .dir
        .clone()
        .filter(|d| d.join("package.json").exists())
        .or_else(|| find_project_root(&exe_dir));

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

    // ── step 3: prerequisites ───────────────────────────────────────────────
    step(3, total_steps, "Installing prerequisites");

    let mut need_admin = false;
    if !opts.skip_node && node.map(|v| v < MIN_NODE_MAJOR).unwrap_or(true) {
        need_admin = true;
    }
    if !opts.skip_git && !has_git {
        need_admin = true;
    }

    if need_admin && !admin && !opts.no_elevate {
        warn("Installing Node.js/Git needs administrator rights.");
        let proceed = opts.yes || ask("Relaunch this wizard as administrator?", true);
        if proceed {
            let mut args: Vec<String> = env::args().skip(1).collect();
            if !args.iter().any(|a| a == "--yes" || a == "-y") {
                args.push("--yes".into());
            }
            info("Requesting elevation — accept the Windows prompt…");
            if elevate_self(&args) {
                println!("  {DIM}The elevated wizard is running in a new window.{RESET}");
                return;
            }
            warn("Elevation was declined; continuing without it (some steps may fail).");
        }
    }

    if !opts.skip_node && node.map(|v| v < MIN_NODE_MAJOR).unwrap_or(true) {
        if opts.yes || ask("Install Node.js LTS now?", true) {
            install_node(&opts);
        }
    } else if node.is_some() {
        good("Node.js is already installed — skipping.");
    }

    if !opts.skip_rust && !has_cargo {
        if opts.yes || ask("Install Rust (for the transfer engine)?", true) {
            install_rust();
        }
    } else if has_cargo {
        good("Rust is already installed — skipping.");
    }

    if !opts.skip_git && !has_git {
        if opts.yes || ask("Install Git?", true) {
            install_git();
        }
    } else if has_git {
        good("Git is already installed — skipping.");
    }

    refresh_path();
    if which("npm").is_none() {
        bad("npm is still not available. Open a NEW terminal (so PATH refreshes) and run setup.exe again.");
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

    let mut engine_ok = true;
    if !opts.skip_engine {
        if which("cargo").is_some() {
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

    // ── step 5: finish ──────────────────────────────────────────────────────
    step(5, total_steps, "Finishing up");

    let launcher = write_launcher(&root);
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
        if engine_ok { format!("{GREEN}built{RESET}") } else { format!("{YELLOW}fallback{RESET}") }
    );
    println!(
        "  Frontend     : {}",
        if frontend_ok { format!("{GREEN}ok{RESET}") } else { format!("{RED}failed{RESET}") }
    );
    rule();
    println!();
    println!("{BOLD}Next steps{RESET}");
    println!("  • Start the app with the desktop shortcut, or run:");
    println!("      {CYAN}cd \"{}\" && npm run dev{RESET}", root.display());
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

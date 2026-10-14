# 20negar Windows setup release

`setup.exe` is the supported 20negar 1.0.0 fresh-machine installer. It is a native
Rust program with no runtime dependencies. It:

1. requests elevation when Node.js, Git, Rust, or the MSVC build tools are
   missing;
2. installs Node.js LTS, Git, Rust stable, and the Visual C++ build tools when
   required;
3. clones the latest commit from the configured repository with
   `--depth 1` when no checkout is present;
4. creates a production `.env` from `.env.example` when the checkout does not
   already have one, including a fresh cryptographically random `JWT_SECRET`;
5. runs `npm install` by default (or `npm ci` when `--ci` is supplied), and
   builds the Rust transfer engine and production frontend; and
6. writes `Start 20negar.bat` and an optional desktop shortcut.

## Build the release executable

From the repository root on Windows:

```powershell
cargo check --manifest-path installer/Cargo.toml
cargo build --release --manifest-path installer/Cargo.toml
Copy-Item installer/target/release/setup.exe .\setup.exe
```

The release artifact is always named `setup.exe` and is written to
`installer/target/release/setup.exe`. `installer/target` is a local Cargo
output and is not committed. Build on Windows with the MSVC
Rust toolchain; this installer invokes Windows tools and the Rust transfer
engine also requires the MSVC C++ workload and Windows SDK.

## Fresh-machine invocation

```powershell
.\setup.exe --dir C:\20negar --yes --no-start
```

Use `--repo <url>` for a fork. `--check` is read-only and does not clone or
install anything. Use `--skip-engine` only when the Rust transfer engine is not
needed. The generated launcher sets `NODE_ENV=production` and invokes `npm start`.
Use `--skip-frontend` only when a current production `dist/` already exists.
A non-zero exit code means a requested prerequisite, dependency
install, or build failed; the console output and installer logs identify the
failed step.

On a fresh checkout, setup creates `.env` from `.env.example`, forces
`NODE_ENV=production`, and writes a new 48-byte cryptographically random
`JWT_SECRET`. It never overwrites an existing `.env`, and the generated secret
is never printed. If `.env.example` is missing or does not define `JWT_SECRET`,
setup stops without creating `.env`.

Set `SUPERADMIN_INITIAL_PASSWORD` (at least eight characters) before the first
start to create the initial administrator. Remove the bootstrap password after
the initial account is created. For Android PWA installation, configure a
trusted certificate matching `PUBLIC_URL` and use HTTPS. Use Node.js LTS and
retain development dependencies: `tsx` is required to run the TypeScript
server, and Vite is required to build the frontend.

There is no repository CI workflow or checked-in installer signing pipeline in
this checkout. Release operators should build and smoke-test `setup.exe` on a
clean Windows VM before distribution, verify the file name and 20negar product
identity, and sign the executable using the project's release certificate
outside this repository.

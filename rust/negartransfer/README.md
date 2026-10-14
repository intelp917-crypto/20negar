# 20negar transfer engine (Rust)

`negartransfer` handles 20negar file transfers separately from the Node server:

- **Parallel, resumable chunked uploads**: each chunk is written directly to
  its offset without buffering the entire file in memory.
- **Range downloads (206)**: streams video and HLS segments without loading
  the entire file into memory.

The engine uses the Rust standard library and pure-Rust cryptography dependencies.
Windows MSVC builds still require Visual C++ Build Tools and the Windows SDK.

## Build

```bash
npm run build:transfer
# Or:
cargo build --release --manifest-path rust/negartransfer/Cargo.toml
```

Output: `rust/negartransfer/target/release/negartransfer[.exe]`.

The Node server starts the binary automatically. If it is unavailable, the server
logs a warning and continues with its built-in transfer handlers.

## Routes

The Node server proxies these routes under `/api/transfer`:

| Method | Path | Description |
| --- | --- | --- |
| `GET` | `/health` | Engine status (unauthenticated) |
| `POST` | `/upload/init` | Create an upload session (JSON: fileName, fileSize, mimeType, chunkSize) |
| `PUT` | `/upload/:id/chunk/:index` | Send a chunk (raw body; supports parallel requests) |
| `GET` | `/upload/:id` | Read upload status and received chunks for resuming |
| `POST` | `/upload/:id/complete` | Finalize and validate file size |
| `GET` | `/download?key=&exp=&sig=&name=&dl=` | Stream a file with Range support |

## Authentication

- **Uploads**: application JWTs (HS256) signed with the server secret; allowed
  roles are `Editor`, `Cameraman`, `Admin`, and `SuperAdmin`.
- **Downloads**: short-lived HMAC signatures issued by the Node server after its
  access checks. The engine does not access the database.
- File paths are constrained to the configured storage directory.

## Environment variables

`NEGAR_TRANSFER_PORT`, `NEGAR_TRANSFER_SECRET`, `NEGAR_TRANSFER_ENABLED`,
`NEGAR_TRANSFER_BIN`, `JWT_SECRET`, `NEGAR_DATA_DIR`, `NEGAR_STORAGE_DIR`,
`NEGAR_CHUNK_DIR`.

## Compatibility

Upload sessions use the Node implementation's on-disk format (`<id>.data` and
`<id>.json` in `data/storage/temp/chunked`) so the video processing pipeline can
consume completed uploads.

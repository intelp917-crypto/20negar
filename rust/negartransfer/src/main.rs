//! negartransfer — high-performance upload/download engine for 20Negar Studio.
//!
//! A dependency-free (std + pure-Rust crypto) HTTP/1.1 engine that handles the
//! byte-heavy parts of the application:
//!
//!   * resumable, parallel chunked uploads (writes chunks directly at their
//!     offset into a pre-allocated sparse file, so N chunks can be sent at once)
//!   * fast ranged downloads (HTTP Range / 206 partial content, streamed with a
//!     fixed buffer, no whole-file buffering)
//!
//! Authorization:
//!   * uploads are authenticated with the application JWT (HS256), the same
//!     secret the Node server signs with, plus a role check.
//!   * downloads require a short-lived HMAC signature over the storage key,
//!     minted by the Node server after it has applied its own ACL checks. The
//!     engine therefore never needs database access.
//!
//! Upload sessions are written in the exact same on-disk format the Node
//! pipeline already consumes (`<id>.data` + `<id>.json` under the chunked temp
//! directory), so video creation keeps working unchanged.

use std::collections::HashMap;
use std::env;
use std::fs::{self, File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{TcpListener, TcpStream};
use std::path::{Component, Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine as _;
use hmac::{Hmac, Mac};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;

const MAX_FILE_SIZE: u64 = 4 * 1024 * 1024 * 1024; // 4 GiB
const DEFAULT_CHUNK_SIZE: u64 = 16 * 1024 * 1024; // 16 MiB
const MIN_CHUNK_SIZE: u64 = 64 * 1024;
const MAX_CHUNK_SIZE: u64 = 64 * 1024 * 1024;
const SESSION_TTL_SECS: u64 = 24 * 60 * 60;
const STREAM_BUFFER: usize = 256 * 1024;
const B64: base64::engine::general_purpose::GeneralPurpose = base64::engine::general_purpose::URL_SAFE_NO_PAD;

// ─────────────────────────────────────────────────────────────────────────────
// Configuration
// ─────────────────────────────────────────────────────────────────────────────

struct Config {
    port: u16,
    jwt_secret: Vec<u8>,
    transfer_secret: Vec<u8>,
    chunk_dir: PathBuf,
    storage_dir: PathBuf,
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0)
}

/// Milliseconds since the epoch. The Node session loader stores/compares
/// `createdAt` in milliseconds, so the session metadata must match.
fn now_millis() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

/// Seconds since the engine started, for the /health payload.
fn uptime_secs(started_at: u64) -> u64 {
    now_secs().saturating_sub(started_at)
}

fn env_path(key: &str) -> Option<PathBuf> {
    env::var(key).ok().filter(|v| !v.trim().is_empty()).map(PathBuf::from)
}

impl Config {
    fn from_env() -> Config {
        let port = env::var("NEGAR_TRANSFER_PORT")
            .ok()
            .and_then(|v| v.parse().ok())
            .unwrap_or(4310);

        let jwt_secret = env::var("JWT_SECRET")
            .unwrap_or_else(|_| "cineflow-super-secret-production-jwt-key-2026".to_string())
            .into_bytes();

        // Signatures for download URLs; falls back to the JWT secret.
        let transfer_secret = env::var("NEGAR_TRANSFER_SECRET")
            .map(|v| v.into_bytes())
            .unwrap_or_else(|_| jwt_secret.clone());

        let data_dir = env_path("NEGAR_DATA_DIR").unwrap_or_else(|| {
            env::current_dir().unwrap_or_else(|_| PathBuf::from(".")).join("data")
        });
        let storage_dir = env_path("NEGAR_STORAGE_DIR").unwrap_or_else(|| data_dir.join("storage"));
        let chunk_dir = env_path("NEGAR_CHUNK_DIR")
            .unwrap_or_else(|| storage_dir.join("temp").join("chunked"));

        fs::create_dir_all(&chunk_dir).ok();

        Config { port, jwt_secret, transfer_secret, chunk_dir, storage_dir }
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// JWT (HS256)
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Clone, Debug)]
struct AuthUser {
    id: i64,
    role: String,
}

fn hmac_sha256(key: &[u8], data: &[u8]) -> Vec<u8> {
    let mut mac = HmacSha256::new_from_slice(key).expect("hmac key length");
    mac.update(data);
    mac.finalize().into_bytes().to_vec()
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    if a.len() != b.len() {
        return false;
    }
    let mut diff = 0u8;
    for (x, y) in a.iter().zip(b.iter()) {
        diff |= x ^ y;
    }
    diff == 0
}

/// Verifies an HS256 JWT and returns the authenticated user.
fn verify_jwt(cfg: &Config, token: &str) -> Option<AuthUser> {
    let parts: Vec<&str> = token.split('.').collect();
    if parts.len() != 3 {
        return None;
    }

    let signing_input = format!("{}.{}", parts[0], parts[1]);
    let signature = B64.decode(parts[2]).ok()?;
    let expected = hmac_sha256(&cfg.jwt_secret, signing_input.as_bytes());

    if !constant_time_eq(&signature, &expected) {
        return None;
    }

    let payload = B64.decode(parts[1]).ok()?;
    let claims: serde_json::Value = serde_json::from_slice(&payload).ok()?;

    // Reject expired tokens when an exp claim is present.
    if let Some(exp) = claims.get("exp").and_then(|v| v.as_u64()) {
        if exp < now_secs() {
            return None;
        }
    }

    let id = claims.get("id").and_then(|v| v.as_i64())?;
    let role = claims.get("role").and_then(|v| v.as_str())?.to_string();

    Some(AuthUser { id, role })
}

fn role_may_upload(role: &str) -> bool {
    matches!(role, "Editor" | "Cameraman" | "SuperAdmin" | "Admin")
}

/// Verifies the short-lived HMAC signature minted by the Node server for a
/// specific storage key. Format: hex(hmac(secret, "<key>|<exp>")).
fn verify_download_signature(cfg: &Config, key: &str, exp: u64, sig: &str) -> bool {
    if exp < now_secs() {
        return false;
    }
    let message = format!("{}|{}", key, exp);
    let expected = hmac_sha256(&cfg.transfer_secret, message.as_bytes());
    let expected_hex = hex::encode(expected);
    constant_time_eq(expected_hex.as_bytes(), sig.as_bytes())
}

// ─────────────────────────────────────────────────────────────────────────────
// Simple HTTP plumbing
// ─────────────────────────────────────────────────────────────────────────────

struct Request {
    method: String,
    path: String,
    query: HashMap<String, String>,
    headers: HashMap<String, String>,
    reader: BufReader<TcpStream>,
}

impl Request {
    fn header(&self, name: &str) -> Option<&str> {
        self.headers.get(&name.to_ascii_lowercase()).map(|s| s.as_str())
    }

    fn bearer_token(&self) -> Option<String> {
        if let Some(v) = self.header("authorization") {
            if let Some(rest) = v.strip_prefix("Bearer ") {
                return Some(rest.trim().to_string());
            }
        }
        self.query.get("token").cloned()
    }

    /// Reads the full request body (supports Content-Length and chunked).
    fn read_body(&mut self) -> std::io::Result<Vec<u8>> {
        let chunked = self
            .header("transfer-encoding")
            .map(|v| v.to_ascii_lowercase().contains("chunked"))
            .unwrap_or(false);

        if chunked {
            let mut body = Vec::new();
            loop {
                let mut size_line = String::new();
                if self.reader.read_line(&mut size_line)? == 0 {
                    break;
                }
                let size_str = size_line.trim().split(';').next().unwrap_or("0").trim();
                let size = usize::from_str_radix(size_str, 16).unwrap_or(0);
                if size == 0 {
                    let mut trailer = String::new();
                    let _ = self.reader.read_line(&mut trailer);
                    break;
                }
                let mut buf = vec![0u8; size];
                self.reader.read_exact(&mut buf)?;
                body.extend_from_slice(&buf);
                let mut crlf = [0u8; 2];
                let _ = self.reader.read_exact(&mut crlf);
            }
            return Ok(body);
        }

        let len: usize = self
            .header("content-length")
            .and_then(|v| v.parse().ok())
            .unwrap_or(0);
        if len == 0 {
            return Ok(Vec::new());
        }
        let mut body = vec![0u8; len];
        self.reader.read_exact(&mut body)?;
        Ok(body)
    }

    /// Reads at most `max` bytes of the body — used for upload chunks so a huge
    /// body is never fully buffered in memory.
    fn take_body_reader(&mut self) -> std::io::Result<(Option<u64>, BodyReader<'_>)> {
        let len: Option<u64> = self.header("content-length").and_then(|v| v.parse().ok());
        Ok((len, BodyReader { inner: &mut self.reader, remaining: len }))
    }
}

struct BodyReader<'a> {
    inner: &'a mut BufReader<TcpStream>,
    remaining: Option<u64>,
}

impl<'a> Read for BodyReader<'a> {
    fn read(&mut self, buf: &mut [u8]) -> std::io::Result<usize> {
        if let Some(0) = self.remaining {
            return Ok(0);
        }
        let want = match self.remaining {
            Some(n) => buf.len().min(n as usize),
            None => buf.len(),
        };
        if want == 0 {
            return Ok(0);
        }
        let n = self.inner.read(&mut buf[..want])?;
        if let Some(rem) = self.remaining.as_mut() {
            *rem = rem.saturating_sub(n as u64);
        }
        Ok(n)
    }
}

fn write_response(
    stream: &mut TcpStream,
    status: u16,
    reason: &str,
    extra_headers: &[(&str, String)],
    body: &[u8],
) -> std::io::Result<()> {
    let mut head = String::new();
    head.push_str(&format!("HTTP/1.1 {} {}\r\n", status, reason));
    for (k, v) in extra_headers {
        head.push_str(&format!("{}: {}\r\n", k, v));
    }
    head.push_str(&format!("Content-Length: {}\r\n", body.len()));
    head.push_str("Connection: close\r\n\r\n");
    stream.write_all(head.as_bytes())?;
    stream.write_all(body)?;
    stream.flush()
}

fn json_response(stream: &mut TcpStream, status: u16, reason: &str, value: serde_json::Value) {
    let body = value.to_string().into_bytes();
    let headers = [("Content-Type", "application/json; charset=utf-8".to_string())];
    let _ = write_response(stream, status, reason, &headers, &body);
}

/// Percent-decoding for query values.
fn url_decode(input: &str) -> String {
    let bytes = input.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'%' if i + 2 < bytes.len() => {
                let hi = (bytes[i + 1] as char).to_digit(16);
                let lo = (bytes[i + 2] as char).to_digit(16);
                if let (Some(h), Some(l)) = (hi, lo) {
                    out.push((h * 16 + l) as u8);
                    i += 3;
                } else {
                    out.push(b'%');
                    i += 1;
                }
            }
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            c => {
                out.push(c);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).to_string()
}

fn parse_query(raw: &str) -> HashMap<String, String> {
    let mut map = HashMap::new();
    for pair in raw.split('&') {
        if pair.is_empty() {
            continue;
        }
        let mut it = pair.splitn(2, '=');
        let k = url_decode(it.next().unwrap_or(""));
        let v = url_decode(it.next().unwrap_or(""));
        map.insert(k, v);
    }
    map
}

/// Resolves a storage key ("videos/foo.mp4") to a safe absolute path.
fn resolve_storage_key(root: &Path, key: &str) -> Option<PathBuf> {
    let decoded = url_decode(key).replace('\\', "/");
    let rel = Path::new(&decoded);
    // Reject absolute paths and any parent traversal.
    if rel.is_absolute() {
        return None;
    }
    for comp in rel.components() {
        match comp {
            Component::Normal(_) => {}
            _ => return None,
        }
    }
    Some(root.join(rel))
}

// ─────────────────────────────────────────────────────────────────────────────
// Upload sessions
// ─────────────────────────────────────────────────────────────────────────────

#[derive(Clone)]
struct Session {
    id: String,
    user_id: i64,
    original_name: String,
    mime_type: String,
    file_size: u64,
    chunk_size: u64,
    total_chunks: u64,
    received: Vec<u64>,
    created_at: u64,
}

impl Session {
    fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "id": self.id,
            "userId": self.user_id,
            "originalName": self.original_name,
            "mimeType": self.mime_type,
            "fileSize": self.file_size,
            "chunkSize": self.chunk_size,
            "totalChunks": self.total_chunks,
            "received": self.received,
            "createdAt": self.created_at,
            "meta": {}
        })
    }

    fn write_meta(&self, dir: &Path) {
        let path = dir.join(format!("{}.json", self.id));
        if let Ok(text) = serde_json::to_string(&self.to_json()) {
            let _ = fs::write(path, text);
        }
    }

    fn data_path(&self, dir: &Path) -> PathBuf {
        dir.join(format!("{}.data", self.id))
    }
}

struct Engine {
    cfg: Config,
    sessions: Mutex<HashMap<String, Session>>,
    // Tracks how many chunk bytes have been written, for logging.
    bytes_written: AtomicU64,
    started_at: u64,
}

fn random_id() -> String {
    // 16 random bytes -> 32 hex chars, matching the Node implementation's ids.
    let mut seed = Vec::with_capacity(32);
    let a = now_secs();
    let b = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let addr = TcpListener::bind("127.0.0.1:0");
    let entropy = match addr {
        Ok(l) => format!("{:?}", l.local_addr().ok()),
        Err(_) => String::new(),
    };
    seed.push(a as u8);
    seed.push((a >> 8) as u8);
    seed.push((a >> 16) as u8);

    let mut mac = HmacSha256::new_from_slice(b"negartransfer-session-id").expect("hmac");
    mac.update(format!("{}-{}-{}-{}", a, b, entropy, seed.len()).as_bytes());
    mac.update(&b.to_le_bytes());
    let digest = mac.finalize().into_bytes();

    let mut out = String::with_capacity(32);
    for byte in digest.iter().take(16) {
        out.push_str(&format!("{:02x}", byte));
    }
    out
}

impl Engine {
    fn new(cfg: Config) -> Engine {
        Engine {
            cfg,
            sessions: Mutex::new(HashMap::new()),
            bytes_written: AtomicU64::new(0),
            started_at: now_secs(),
        }
    }

    fn touch_cleanup(&self) {
        let dir = self.cfg.chunk_dir.clone();
        let max_age = SESSION_TTL_SECS;
        let _ = fs::read_dir(&dir).map(|entries| {
            for entry in entries.flatten() {
                if let Ok(meta) = entry.metadata() {
                    if let Ok(modified) = meta.modified() {
                        if let Ok(age) = SystemTime::now().duration_since(modified) {
                            if age.as_secs() > max_age {
                                let _ = fs::remove_file(entry.path());
                            }
                        }
                    }
                }
            }
        });
    }
}

// ─────────────────────────────────────────────────────────────────────────────
// Handlers
// ─────────────────────────────────────────────────────────────────────────────

fn handle_upload_init(engine: &Engine, user: &AuthUser, mut req: Request, stream: &mut TcpStream) {
    if !role_may_upload(&user.role) {
        json_response(stream, 403, "Forbidden", serde_json::json!({ "error": "Role may not upload." }));
        return;
    }

    let body = match req.read_body() {
        Ok(b) => b,
        Err(e) => {
            json_response(stream, 400, "Bad Request", serde_json::json!({ "error": e.to_string() }));
            return;
        }
    };

    let parsed: serde_json::Value = match serde_json::from_slice(&body) {
        Ok(v) => v,
        Err(_) => {
            json_response(stream, 400, "Bad Request", serde_json::json!({ "error": "Invalid JSON body." }));
            return;
        }
    };

    let file_name = parsed.get("fileName").and_then(|v| v.as_str()).unwrap_or("").trim().to_string();
    let mime_type = parsed
        .get("mimeType")
        .and_then(|v| v.as_str())
        .unwrap_or("video/mp4")
        .to_string();
    let file_size = parsed.get("fileSize").and_then(|v| v.as_u64()).unwrap_or(0);

    if file_name.is_empty() {
        json_response(stream, 400, "Bad Request", serde_json::json!({ "error": "fileName is required." }));
        return;
    }
    if file_size == 0 || file_size > MAX_FILE_SIZE {
        json_response(stream, 400, "Bad Request", serde_json::json!({ "error": "Invalid file size." }));
        return;
    }

    let chunk_size = parsed
        .get("chunkSize")
        .and_then(|v| v.as_u64())
        .unwrap_or(DEFAULT_CHUNK_SIZE)
        .clamp(MIN_CHUNK_SIZE, MAX_CHUNK_SIZE);

    let total_chunks = file_size.div_ceil(chunk_size);
    let id = random_id();

    // Pre-allocate the destination file so parallel writers can seek into it.
    let data_path = engine.cfg.chunk_dir.join(format!("{}.data", id));
    match OpenOptions::new().create(true).write(true).truncate(true).open(&data_path) {
        Ok(f) => {
            let _ = f.set_len(file_size);
        }
        Err(e) => {
            json_response(stream, 500, "Internal Server Error", serde_json::json!({ "error": e.to_string() }));
            return;
        }
    }

    let session = Session {
        id: id.clone(),
        user_id: user.id,
        original_name: file_name,
        mime_type,
        file_size,
        chunk_size,
        total_chunks,
        received: Vec::new(),
        created_at: now_millis(),
    };
    session.write_meta(&engine.cfg.chunk_dir);
    engine.sessions.lock().unwrap().insert(id.clone(), session);

    json_response(
        stream,
        201,
        "Created",
        serde_json::json!({
            "uploadId": id,
            "chunkSize": chunk_size,
            "totalChunks": total_chunks,
            "received": [],
            "engine": "rust"
        }),
    );
}

fn handle_upload_chunk(
    engine: &Engine,
    user: &AuthUser,
    upload_id: &str,
    index: u64,
    mut req: Request,
    stream: &mut TcpStream,
) {
    let (session, known) = {
        let guard = engine.sessions.lock().unwrap();
        (guard.get(upload_id).cloned(), guard.contains_key(upload_id))
    };

    // Recover a session that exists on disk but not in memory (engine restart).
    let session = match session.or_else(|| load_session_from_disk(&engine.cfg.chunk_dir, upload_id)) {
        Some(s) => s,
        None => {
            json_response(stream, 404, "Not Found", serde_json::json!({ "error": "Upload session not found." }));
            return;
        }
    };

    if session.user_id != user.id && user.role != "SuperAdmin" {
        json_response(stream, 403, "Forbidden", serde_json::json!({ "error": "Upload session belongs to another user." }));
        return;
    }
    if index >= session.total_chunks {
        json_response(stream, 400, "Bad Request", serde_json::json!({ "error": "Chunk index out of range." }));
        return;
    }
    if !known {
        engine.sessions.lock().unwrap().insert(upload_id.to_string(), session.clone());
    }

    let offset = index * session.chunk_size;
    let expected = std::cmp::min(session.chunk_size, session.file_size - offset);

    let data_path = session.data_path(&engine.cfg.chunk_dir);
    let mut file = match OpenOptions::new().read(true).write(true).open(&data_path) {
        Ok(f) => f,
        Err(e) => {
            json_response(stream, 500, "Internal Server Error", serde_json::json!({ "error": e.to_string() }));
            return;
        }
    };

    if file.seek(SeekFrom::Start(offset)).is_err() {
        json_response(stream, 500, "Internal Server Error", serde_json::json!({ "error": "Seek failed." }));
        return;
    }

    let (declared, mut reader) = match req.take_body_reader() {
        Ok(v) => v,
        Err(e) => {
            json_response(stream, 400, "Bad Request", serde_json::json!({ "error": e.to_string() }));
            return;
        }
    };

    // Stream the chunk straight to disk — nothing is buffered in memory.
    let mut buf = vec![0u8; 512 * 1024];
    let mut written: u64 = 0;
    let mut failure: Option<String> = None;
    loop {
        match reader.read(&mut buf) {
            Ok(0) => break,
            Ok(n) => {
                if let Err(e) = file.write_all(&buf[..n]) {
                    failure = Some(e.to_string());
                    break;
                }
                written += n as u64;
            }
            Err(e) => {
                failure = Some(e.to_string());
                break;
            }
        }
    }

    if let Some(err) = failure {
        json_response(stream, 500, "Internal Server Error", serde_json::json!({ "error": err }));
        return;
    }

    if written != expected {
        json_response(
            stream,
            400,
            "Bad Request",
            serde_json::json!({ "error": format!("Invalid chunk size ({} != {}).", written, expected) }),
        );
        return;
    }
    if let Some(d) = declared {
        if d != expected {
            json_response(
                stream,
                400,
                "Bad Request",
                serde_json::json!({ "error": format!("Declared length {} does not match chunk size {}.", d, expected) }),
            );
            return;
        }
    }
    let _ = file.sync_data();
    engine.bytes_written.fetch_add(written, Ordering::Relaxed);

    let (received_count, total) = {
        let mut guard = engine.sessions.lock().unwrap();
        let s = guard.entry(upload_id.to_string()).or_insert_with(|| session.clone());
        if !s.received.contains(&index) {
            s.received.push(index);
            s.received.sort_unstable();
        }
        let snapshot = s.clone();
        drop(guard);
        snapshot.write_meta(&engine.cfg.chunk_dir);
        (snapshot.received.len(), snapshot.total_chunks)
    };

    json_response(
        stream,
        200,
        "OK",
        serde_json::json!({ "ok": true, "received": received_count, "total": total }),
    );
}

fn handle_upload_status(engine: &Engine, user: &AuthUser, upload_id: &str, stream: &mut TcpStream) {
    let session = {
        let guard = engine.sessions.lock().unwrap();
        guard.get(upload_id).cloned()
    }
    .or_else(|| load_session_from_disk(&engine.cfg.chunk_dir, upload_id));

    let session = match session {
        Some(s) => s,
        None => {
            json_response(stream, 404, "Not Found", serde_json::json!({ "error": "Upload session not found." }));
            return;
        }
    };

    if session.user_id != user.id && user.role != "SuperAdmin" {
        json_response(stream, 403, "Forbidden", serde_json::json!({ "error": "Upload session belongs to another user." }));
        return;
    }

    json_response(
        stream,
        200,
        "OK",
        serde_json::json!({
            "uploadId": session.id,
            "chunkSize": session.chunk_size,
            "totalChunks": session.total_chunks,
            "received": session.received,
            "fileSize": session.file_size,
            "originalName": session.original_name,
            "engine": "rust"
        }),
    );
}

fn handle_upload_complete(engine: &Engine, user: &AuthUser, upload_id: &str, stream: &mut TcpStream) {
    let session = {
        let guard = engine.sessions.lock().unwrap();
        guard.get(upload_id).cloned()
    }
    .or_else(|| load_session_from_disk(&engine.cfg.chunk_dir, upload_id));

    let session = match session {
        Some(s) => s,
        None => {
            json_response(stream, 404, "Not Found", serde_json::json!({ "error": "Upload session not found." }));
            return;
        }
    };

    if session.user_id != user.id && user.role != "SuperAdmin" {
        json_response(stream, 403, "Forbidden", serde_json::json!({ "error": "Upload session belongs to another user." }));
        return;
    }

    let missing: Vec<u64> = (0..session.total_chunks)
        .filter(|i| !session.received.contains(i))
        .collect();

    if !missing.is_empty() {
        json_response(
            stream,
            400,
            "Bad Request",
            serde_json::json!({ "error": "Upload is incomplete.", "missing": missing }),
        );
        return;
    }

    let data_path = session.data_path(&engine.cfg.chunk_dir);
    let actual = fs::metadata(&data_path).map(|m| m.len()).unwrap_or(0);
    if actual != session.file_size {
        json_response(
            stream,
            400,
            "Bad Request",
            serde_json::json!({ "error": format!("Final size mismatch ({} != {}).", actual, session.file_size) }),
        );
        return;
    }

    json_response(
        stream,
        200,
        "OK",
        serde_json::json!({
            "ok": true,
            "uploadId": session.id,
            "fileSize": session.file_size,
            "originalName": session.original_name,
            "engine": "rust"
        }),
    );
}

fn load_session_from_disk(dir: &Path, id: &str) -> Option<Session> {
    if id.len() != 32 || !id.chars().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let text = fs::read_to_string(dir.join(format!("{}.json", id))).ok()?;
    let v: serde_json::Value = serde_json::from_str(&text).ok()?;

    let received: Vec<u64> = v
        .get("received")
        .and_then(|r| r.as_array())
        .map(|arr| arr.iter().filter_map(|x| x.as_u64()).collect())
        .unwrap_or_default();

    Some(Session {
        id: v.get("id").and_then(|x| x.as_str())?.to_string(),
        user_id: v.get("userId").and_then(|x| x.as_i64())?,
        original_name: v.get("originalName").and_then(|x| x.as_str()).unwrap_or("upload.bin").to_string(),
        mime_type: v.get("mimeType").and_then(|x| x.as_str()).unwrap_or("application/octet-stream").to_string(),
        file_size: v.get("fileSize").and_then(|x| x.as_u64())?,
        chunk_size: v.get("chunkSize").and_then(|x| x.as_u64())?,
        total_chunks: v.get("totalChunks").and_then(|x| x.as_u64())?,
        received,
        created_at: v.get("createdAt").and_then(|x| x.as_u64()).unwrap_or(0),
    })
}

/// Streams a file with HTTP Range support (206 partial content).
fn handle_download(cfg: &Config, req: &Request, stream: &mut TcpStream) {
    let key = req.query.get("key").cloned().unwrap_or_default();
    let exp: u64 = req.query.get("exp").and_then(|v| v.parse().ok()).unwrap_or(0);
    let sig = req.query.get("sig").cloned().unwrap_or_default();
    let filename = req.query.get("name").cloned().unwrap_or_else(|| "download".to_string());
    let attachment = req.query.get("dl").map(|v| v == "1").unwrap_or(true);

    if !verify_download_signature(cfg, &key, exp, &sig) {
        json_response(stream, 403, "Forbidden", serde_json::json!({ "error": "Invalid or expired transfer signature." }));
        return;
    }

    let path = match resolve_storage_key(&cfg.storage_dir, &key) {
        Some(p) => p,
        None => {
            json_response(stream, 400, "Bad Request", serde_json::json!({ "error": "Invalid storage key." }));
            return;
        }
    };

    let mut file = match File::open(&path) {
        Ok(f) => f,
        Err(_) => {
            json_response(stream, 404, "Not Found", serde_json::json!({ "error": "File not found." }));
            return;
        }
    };

    let file_size = file.metadata().map(|m| m.len()).unwrap_or(0);
    let range_header = req.header("range").map(|s| s.to_string());

    let (start, end) = match parse_range(range_header.as_deref(), file_size) {
        Some(r) => r,
        None => {
            let headers = [
                ("Content-Range", format!("bytes */{}", file_size)),
                ("Accept-Ranges", "bytes".to_string()),
            ];
            let _ = write_response(stream, 416, "Range Not Satisfiable", &headers, b"");
            return;
        }
    };

    let length = end - start + 1;
    let partial = range_header.is_some();

    let disposition = if attachment {
        format!("attachment; filename=\"{}\"", filename.replace('"', ""))
    } else {
        "inline".to_string()
    };

    let mut headers = vec![
        ("Content-Type", "application/octet-stream".to_string()),
        ("Accept-Ranges", "bytes".to_string()),
        ("Content-Disposition", disposition),
        ("Cache-Control", "private, max-age=0".to_string()),
    ];
    if partial {
        headers.push(("Content-Range", format!("bytes {}-{}/{}", start, end, file_size)));
    }

    if file.seek(SeekFrom::Start(start)).is_err() {
        json_response(stream, 500, "Internal Server Error", serde_json::json!({ "error": "Seek failed." }));
        return;
    }

    // Write the status line + headers, then stream the body.
    let mut head = String::new();
    let status = if partial { 206 } else { 200 };
    let reason = if partial { "Partial Content" } else { "OK" };
    head.push_str(&format!("HTTP/1.1 {} {}\r\n", status, reason));
    for (k, v) in &headers {
        head.push_str(&format!("{}: {}\r\n", k, v));
    }
    head.push_str(&format!("Content-Length: {}\r\n", length));
    head.push_str("Connection: close\r\n\r\n");
    if stream.write_all(head.as_bytes()).is_err() {
        return;
    }

    let mut remaining = length;
    let mut buf = vec![0u8; STREAM_BUFFER];
    while remaining > 0 {
        let want = remaining.min(buf.len() as u64) as usize;
        match file.read(&mut buf[..want]) {
            Ok(0) => break,
            Ok(n) => {
                if stream.write_all(&buf[..n]).is_err() {
                    return;
                }
                remaining -= n as u64;
            }
            Err(_) => return,
        }
    }
    let _ = stream.flush();
}

fn parse_range(header: Option<&str>, file_size: u64) -> Option<(u64, u64)> {
    let Some(raw) = header else {
        return if file_size == 0 { Some((0, 0)) } else { Some((0, file_size - 1)) };
    };

    let spec = raw.strip_prefix("bytes=").unwrap_or(raw);
    let (start_s, end_s) = spec.split_once('-')?;

    let (start, end) = if start_s.is_empty() {
        // suffix range: bytes=-N
        let n: u64 = end_s.parse().ok()?;
        if n == 0 || file_size == 0 {
            return None;
        }
        (file_size.saturating_sub(n), file_size - 1)
    } else {
        let start: u64 = start_s.parse().ok()?;
        let end = if end_s.is_empty() {
            file_size.saturating_sub(1)
        } else {
            end_s.parse().ok()?
        };
        (start, end.min(file_size.saturating_sub(1)))
    };

    if start > end || start >= file_size {
        return None;
    }
    Some((start, end))
}

// ─────────────────────────────────────────────────────────────────────────────
// Connection handling
// ─────────────────────────────────────────────────────────────────────────────

fn read_request(mut reader: BufReader<TcpStream>) -> Option<Request> {
    let mut request_line = String::new();
    if reader.read_line(&mut request_line).ok()? == 0 {
        return None;
    }
    let mut parts = request_line.split_whitespace();
    let method = parts.next()?.to_string();
    let target = parts.next()?.to_string();

    let (raw_path, raw_query) = match target.split_once('?') {
        Some((p, q)) => (p.to_string(), q.to_string()),
        None => (target, String::new()),
    };

    let mut headers: HashMap<String, String> = HashMap::new();
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).ok()? == 0 {
            break;
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some((k, v)) = trimmed.split_once(':') {
            headers.insert(k.trim().to_ascii_lowercase(), v.trim().to_string());
        }
    }

    Some(Request {
        method,
        path: raw_path,
        query: parse_query(&raw_query),
        headers,
        reader,
    })
}

fn handle_connection(engine: Arc<Engine>, stream: TcpStream) {
    stream.set_nodelay(true).ok();
    let peer = match stream.try_clone() {
        Ok(p) => p,
        Err(_) => return,
    };

    let req = match read_request(BufReader::new(peer)) {
        Some(r) => r,
        None => return,
    };

    let mut stream = stream;
    let path = req.path.clone();
    let method = req.method.clone();

    // OPTIONS preflight
    if method == "OPTIONS" {
        let _ = write_response(
            &mut stream,
            204,
            "No Content",
            &[("Access-Control-Allow-Methods", "GET,POST,PUT,OPTIONS".to_string())],
            b"",
        );
        return;
    }

    // Health check — no auth required.
    if path == "/health" || path == "/healthz" {
        json_response(
            &mut stream,
            200,
            "OK",
            serde_json::json!({
                "status": "ok",
                "engine": "rust",
                "service": "negartransfer",
                "bytesWritten": engine.bytes_written.load(Ordering::Relaxed),
                "uptimeSeconds": uptime_secs(engine.started_at)
            }),
        );
        return;
    }

    // ── Download (HMAC-signed, no JWT needed) ────────────────────────────────
    if path == "/download" || path == "/transfer/download" {
        handle_download(&engine.cfg, &req, &mut stream);
        return;
    }

    // ── Everything else requires a valid JWT ─────────────────────────────────
    let token = match req.bearer_token() {
        Some(t) => t,
        None => {
            json_response(&mut stream, 401, "Unauthorized", serde_json::json!({ "error": "Authentication required." }));
            return;
        }
    };
    let user = match verify_jwt(&engine.cfg, &token) {
        Some(u) => u,
        None => {
            json_response(&mut stream, 401, "Unauthorized", serde_json::json!({ "error": "Invalid or expired token." }));
            return;
        }
    };

    // Path shapes:
    //   POST /upload/init
    //   PUT  /upload/:id/chunk/:index
    //   GET  /upload/:id
    //   POST /upload/:id/complete
    let segments: Vec<&str> = path.trim_matches('/').split('/').collect();

    // Allow both "/upload/..." and "/transfer/..." prefixes.
    let offset = if segments.first() == Some(&"transfer") { 1 } else { 0 };
    let segs = &segments[offset.min(segments.len())..];

    match (method.as_str(), segs) {
        ("POST", ["upload", "init"]) => handle_upload_init(&engine, &user, req, &mut stream),
        ("GET", ["upload", id]) => handle_upload_status(&engine, &user, id, &mut stream),
        ("POST", ["upload", id, "complete"]) => handle_upload_complete(&engine, &user, id, &mut stream),
        ("PUT", ["upload", id, "chunk", index]) => {
            match index.parse::<u64>() {
                Ok(idx) => handle_upload_chunk(&engine, &user, id, idx, req, &mut stream),
                Err(_) => json_response(
                    &mut stream,
                    400,
                    "Bad Request",
                    serde_json::json!({ "error": "Invalid chunk index." }),
                ),
            }
        }
        _ => json_response(&mut stream, 404, "Not Found", serde_json::json!({ "error": "Unknown route." })),
    }
}

fn main() {
    let cfg = Config::from_env();
    let port = cfg.port;
    let addr = format!("0.0.0.0:{}", port);

    let listener = match TcpListener::bind(&addr) {
        Ok(l) => l,
        Err(e) => {
            eprintln!("[negartransfer] Failed to bind {}: {}", addr, e);
            std::process::exit(1);
        }
    };

    println!("[negartransfer] Rust transfer engine listening on {}", addr);
    println!("[negartransfer] chunk dir: {}", cfg.chunk_dir.display());
    println!("[negartransfer] storage dir: {}", cfg.storage_dir.display());

    let engine = Arc::new(Engine::new(cfg));

    // Periodic cleanup of stale upload sessions.
    {
        let engine = Arc::clone(&engine);
        thread::spawn(move || loop {
            thread::sleep(std::time::Duration::from_secs(3600));
            engine.touch_cleanup();
        });
    }

    for incoming in listener.incoming() {
        match incoming {
            Ok(stream) => {
                let engine = Arc::clone(&engine);
                thread::spawn(move || {
                    if let Err(e) = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                        handle_connection(engine, stream);
                    })) {
                        eprintln!("[negartransfer] connection handler panicked: {:?}", e);
                    }
                });
            }
            Err(e) => eprintln!("[negartransfer] accept error: {}", e),
        }
    }
}

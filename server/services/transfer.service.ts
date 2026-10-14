import { spawn, ChildProcess } from 'child_process';
import http from 'http';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';
import type { Request, Response } from 'express';
import { DATA_DIR, STORAGE_DIR, JWT_SECRET } from '../config.ts';

/**
 * Bridge to the Rust transfer engine (`negartransfer`).
 *
 * The engine owns the byte-heavy work (parallel chunked uploads written
 * straight to their offsets on disk, and ranged downloads streamed with large
 * buffers). Express stays the single public entry point — so the existing
 * VPN / port-forwarding setup keeps working — and proxies `/api/transfer/*`
 * to the engine over loopback with a raw stream pipe.
 *
 * If the binary is missing or the engine fails to start, the app falls back to
 * the original pure-Node upload/download handlers.
 */

const ENGINE_PORT = parseInt(process.env.NEGAR_TRANSFER_PORT || '4310', 10);
const ENGINE_HOST = process.env.NEGAR_TRANSFER_HOST || '127.0.0.1';
const TRANSFER_SECRET = process.env.NEGAR_TRANSFER_SECRET || JWT_SECRET;
const ENABLED = (process.env.NEGAR_TRANSFER_ENABLED || 'true').toLowerCase() !== 'false';

let engineProcess: ChildProcess | null = null;
let engineReady = false;
let engineStarting: Promise<boolean> | null = null;

function candidateBinaries(): string[] {
  const explicit = process.env.NEGAR_TRANSFER_BIN;
  const names = process.platform === 'win32' ? ['negartransfer.exe'] : ['negartransfer'];
  const roots = [
    process.cwd(),
    path.resolve(process.cwd(), '..'),
  ];
  const candidates: string[] = [];
  if (explicit) candidates.push(explicit);
  for (const root of roots) {
    for (const name of names) {
      candidates.push(path.join(root, 'rust', 'negartransfer', 'target', 'release', name));
      candidates.push(path.join(root, 'rust', 'negartransfer', 'target', 'debug', name));
    }
  }
  return candidates;
}

function findBinary(): string | null {
  for (const candidate of candidateBinaries()) {
    try {
      if (fs.existsSync(candidate)) return candidate;
    } catch {
      // ignore
    }
  }
  return null;
}

function healthCheck(timeoutMs = 1200): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.request(
      { host: ENGINE_HOST, port: ENGINE_PORT, path: '/health', method: 'GET', timeout: timeoutMs },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      }
    );
    req.on('timeout', () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
    req.end();
  });
}

/** Starts the engine if needed and waits until it answers /health. */
export async function ensureTransferEngine(): Promise<boolean> {
  if (!ENABLED) return false;
  if (engineReady) return true;
  if (engineStarting) return engineStarting;

  engineStarting = (async () => {
    // An engine may already be running (for example started manually).
    if (await healthCheck()) {
      engineReady = true;
      console.log('[Transfer] Rust engine detected on an existing port.');
      return true;
    }

    const binary = findBinary();
    if (!binary) {
      console.warn(
        '[Transfer] Rust engine binary not found; falling back to the built-in Node upload/download handlers.\n' +
          '           Build it with: cargo build --release --manifest-path rust/negartransfer/Cargo.toml'
      );
      return false;
    }

    engineProcess = spawn(binary, [], {
      env: {
        ...process.env,
        NEGAR_TRANSFER_PORT: String(ENGINE_PORT),
        NEGAR_TRANSFER_SECRET: TRANSFER_SECRET,
        JWT_SECRET,
        NEGAR_DATA_DIR: DATA_DIR,
        NEGAR_STORAGE_DIR: STORAGE_DIR,
        NEGAR_CHUNK_DIR: path.resolve(STORAGE_DIR, 'temp', 'chunked'),
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    engineProcess.stdout?.on('data', (chunk: Buffer) => {
      process.stdout.write(chunk.toString());
    });
    engineProcess.stderr?.on('data', (chunk: Buffer) => {
      process.stderr.write(chunk.toString());
    });
    engineProcess.on('exit', (code) => {
      if (engineReady) {
        console.warn(`[Transfer] Rust engine exited with code ${code}.`);
      }
      engineReady = false;
      engineProcess = null;
    });
    engineProcess.on('error', (err) => {
      console.warn('[Transfer] Failed to launch the Rust engine:', err.message);
      engineProcess = null;
    });

    // Wait (bounded) for the engine to answer.
    for (let i = 0; i < 40; i++) {
      if (await healthCheck()) {
        engineReady = true;
        console.log(`[Transfer] Rust engine is ready on ${ENGINE_HOST}:${ENGINE_PORT}.`);
        return true;
      }
      await new Promise((r) => setTimeout(r, 150));
    }

    console.warn('[Transfer] Rust engine did not become ready in time; using the Node fallback.');
    return false;
  })();

  const result = await engineStarting;
  engineStarting = null;
  return result;
}

export function isTransferEngineReady(): boolean {
  return engineReady;
}

export function stopTransferEngine(): void {
  if (engineProcess) {
    try {
      engineProcess.kill();
    } catch {
      // ignore
    }
    engineProcess = null;
  }
  engineReady = false;
}

/** HMAC signature authorizing a download of a specific storage key. */
export function signDownload(key: string, expiresInSeconds = 300): { exp: number; sig: string } {
  const exp = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const sig = crypto.createHmac('sha256', TRANSFER_SECRET).update(`${key}|${exp}`).digest('hex');
  return { exp, sig };
}

/**
 * Proxies an incoming Express request to the Rust engine, streaming both ways.
 * Used for `/api/transfer/*` (upload traffic).
 */
export function proxyToTransferEngine(req: Request, res: Response): void {
  if (!engineReady) {
    res.status(503).json({ error: 'Transfer engine is unavailable.' });
    return;
  }

  const headers: http.OutgoingHttpHeaders = { ...req.headers, host: `${ENGINE_HOST}:${ENGINE_PORT}` };

  const proxied = http.request(
    {
      host: ENGINE_HOST,
      port: ENGINE_PORT,
      method: req.method,
      // Express strips the '/api/transfer' mount prefix from req.url, which is
      // exactly the path shape the engine expects.
      path: req.url || '/',
      headers,
    },
    (engineRes) => {
      res.writeHead(engineRes.statusCode || 502, engineRes.headers);
      engineRes.pipe(res);
    }
  );

  proxied.on('error', (err) => {
    console.warn('[Transfer] Proxy error:', err.message);
    if (!res.headersSent) {
      res.status(502).json({ error: 'Transfer engine request failed.' });
    }
  });

  req.pipe(proxied);
}

/**
 * Streams a stored file from the Rust engine to the client (downloads and
 * video streaming), preserving Range semantics. Returns false when the engine
 * is unavailable so the caller can fall back to the Node implementation.
 */
export function streamFromTransferEngine(
  req: Request,
  res: Response,
  storageKey: string,
  options: { filename?: string; attachment?: boolean } = {}
): Promise<boolean> {
  return new Promise((resolve) => {
    if (!engineReady) {
      resolve(false);
      return;
    }

    const { exp, sig } = signDownload(storageKey);
    const params = new URLSearchParams({ key: storageKey, exp: String(exp), sig });
    if (options.filename) params.set('name', options.filename);
    params.set('dl', options.attachment === false ? '0' : '1');

    const headers: http.OutgoingHttpHeaders = {};
    if (req.headers.range) headers.range = req.headers.range;

    const upstream = http.request(
      {
        host: ENGINE_HOST,
        port: ENGINE_PORT,
        method: 'GET',
        path: `/download?${params.toString()}`,
        headers,
      },
      (engineRes) => {
        if (!engineRes.statusCode || engineRes.statusCode >= 400) {
          engineRes.resume();
          resolve(false);
          return;
        }
        res.writeHead(engineRes.statusCode, engineRes.headers);
        engineRes.pipe(res);
        resolve(true);
      }
    );

    upstream.on('error', () => resolve(false));
    upstream.end();
  });
}

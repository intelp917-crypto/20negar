import fs from 'fs';
import path from 'path';
import os from 'os';
import { execFileSync } from 'child_process';
import { SSL_DIR } from './config.ts';

const KEY_PATH = path.join(SSL_DIR, 'server.key');
const CERT_PATH = path.join(SSL_DIR, 'server.crt');

/**
 * SAN های گواهی: لوکال‌هاست، IP داخلی، تمام IPv4 های غیر internal و نام هاست.
 * گوایه self-signed است تا بدون دامنه هم سرور روی HTTPS (پورت 443) بالا بیاید.
 * مرورگر یک بار هشدار «اتصال امن نیست» می‌دهد که با یک بار Continue قابل پذیرش است.
 */
function buildSubjectAltName(): string {
  const entries = ['IP:127.0.0.1', 'DNS:localhost'];
  try {
    const hostname = os.hostname();
    if (hostname) entries.push(`DNS:${hostname}`);
  } catch {}

  try {
    const interfaces = os.networkInterfaces();
    for (const list of Object.values(interfaces)) {
      for (const ni of list || []) {
        const family = String((ni as any).family);
        if ((family === 'IPv4' || family === '4') && !ni.internal) {
          entries.push(`IP:${ni.address}`);
        }
      }
    }
  } catch {}

  return Array.from(new Set(entries)).join(',');
}

/**
 * کلید و گواهی TLS را آماده می‌کند. اگر openssl در دسترس نباشد null برمی‌گرداند
 * تا پورت امن با HTTP معمولی بالا بیاید (همچنان قابل دسترسی).
 */
export function ensureTlsMaterial(): { key: Buffer; cert: Buffer } | null {
  try {
    if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
      return { key: fs.readFileSync(KEY_PATH), cert: fs.readFileSync(CERT_PATH) };
    }

    const args = [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-sha256',
      '-days',
      '825',
      '-nodes',
      '-keyout',
      KEY_PATH,
      '-out',
      CERT_PATH,
      '-subj',
      '/CN=20Negar Studio/O=20Negar',
      '-addext',
      `subjectAltName=${buildSubjectAltName()}`,
    ];

    execFileSync('openssl', args, { stdio: 'ignore' });

    if (fs.existsSync(KEY_PATH) && fs.existsSync(CERT_PATH)) {
      console.log(`[TLS] گواهی HTTPS خودامضا ساخته شد: ${CERT_PATH}`);
      return { key: fs.readFileSync(KEY_PATH), cert: fs.readFileSync(CERT_PATH) };
    }
    return null;
  } catch (err: any) {
    console.warn('[TLS] ساخت گواهی HTTPS ممکن نشد (openssl در دسترس نیست):', err?.message || err);
    return null;
  }
}

import { db } from '../db/database.ts';
import { UserRole } from './auth.service.ts';

export interface InternalAccessUser { id: number; role: UserRole; }
export interface InternalAccessConfig {
  enabled: boolean;
  url: string | null;
  lastHealthStatus: 'unknown' | 'healthy' | 'unavailable' | 'invalid';
  lastSuccessfulHealthCheck: string | null;
  instructions: string;
}

const keys = ['internal_access.enabled', 'internal_access.url', 'internal_access.health_status', 'internal_access.last_success', 'internal_access.instructions'];

export function validateInternalUrl(value: string): string {
  const url = new URL(value.trim());
  if (url.protocol !== 'https:') throw new Error('آدرس داخلی باید با HTTPS شروع شود.');
  if (url.username || url.password || url.search || url.hash) throw new Error('آدرس داخلی نباید شامل اطلاعات ورود، query یا fragment باشد.');
  if (url.pathname !== '/' && /\.\.|\\/.test(url.pathname)) throw new Error('مسیر داخلی نامعتبر است.');
  const host = url.hostname.toLowerCase();
  const privateIp = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.)/.test(host);
  const internalName = host === 'localhost' || host.endsWith('.local') || host.endsWith('.lan') || host.endsWith('.internal') || !host.includes('.');
  if (!privateIp && !internalName) throw new Error('میزبان داخلی باید یک IP خصوصی یا نام DNS داخلی باشد.');
  if (url.port && (!/^\d+$/.test(url.port) || Number(url.port) < 1 || Number(url.port) > 65535)) throw new Error('پورت HTTPS نامعتبر است.');
  return url.toString().replace(/\/$/, '');
}

function setting(key: string): string | null {
  return db.queryOne<{ value: string }>('SELECT value FROM app_settings WHERE key = ?', [key])?.value ?? null;
}

function writeSetting(key: string, value: string, actorId: number): void {
  db.run(`INSERT INTO app_settings (key, value, updated_by_id, updated_at) VALUES (?, ?, ?, ?)
          ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_by_id = excluded.updated_by_id, updated_at = excluded.updated_at`, [key, value, actorId, new Date().toISOString()]);
}

export function getInternalAccess(): InternalAccessConfig {
  return {
    enabled: setting('internal_access.enabled') === 'true',
    url: setting('internal_access.url'),
    lastHealthStatus: (setting('internal_access.health_status') as InternalAccessConfig['lastHealthStatus']) || 'unknown',
    lastSuccessfulHealthCheck: setting('internal_access.last_success'),
    instructions: setting('internal_access.instructions') || 'برای دسترسی داخلی، ابتدا به شبکه سازمان متصل شوید و سپس اتصال داخلی را بررسی کنید.',
  };
}

export function updateInternalAccess(actor: InternalAccessUser, input: { enabled: boolean; url: string; instructions?: string }): InternalAccessConfig {
  if (actor.role !== 'SuperAdmin') throw new Error('تنها سوپریوزر می‌تواند دسترسی داخلی را تنظیم کند.');
  const url = validateInternalUrl(input.url);
  writeSetting('internal_access.enabled', input.enabled ? 'true' : 'false', actor.id);
  writeSetting('internal_access.url', url, actor.id);
  writeSetting('internal_access.health_status', 'unknown', actor.id);
  if (input.instructions !== undefined) writeSetting('internal_access.instructions', input.instructions.slice(0, 1000), actor.id);
  return getInternalAccess();
}

export function recordHealth(actor: InternalAccessUser, status: 'healthy' | 'unavailable' | 'invalid'): InternalAccessConfig {
  if (actor.role !== 'SuperAdmin') throw new Error('تنها سوپریوزر می‌تواند وضعیت سلامت را ثبت کند.');
  writeSetting('internal_access.health_status', status, actor.id);
  if (status === 'healthy') writeSetting('internal_access.last_success', new Date().toISOString(), actor.id);
  return getInternalAccess();
}

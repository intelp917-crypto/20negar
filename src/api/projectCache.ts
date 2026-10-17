import { ProjectFolder } from '../types/index.ts';

/**
 * کش فقط در حافظه همین نشست (تا رفرش صفحه).
 * - تا وقتی کاربر وارد یک پوشه نشود، هیچ لیست ویدیویی واکشی یا نگهداری نمی‌شود.
 * - پس از اولین ورود، بازگشت دوباره به همان پوشه بدون درخواست مجدد و فوری است.
 * - هر تغییر (آپلود، حذف، بروزرسانی دستی) کش را باطل می‌کند.
 */
const cache = new Map<string, unknown>();
const inflight = new Map<string, Promise<unknown>>();
let generation = 0;

export function folderCacheKey(userId: number, role: string): string {
  return `folders:${userId}:${role}`;
}

export function videosCacheKey(
  userId: number,
  role: string,
  projectId: number | null,
  filterSignature = ''
): string {
  return `videos:${userId}:${role}:${projectId === null ? 'none' : projectId}:${filterSignature}`;
}

export function cachedLoad<T>(key: string, loader: () => Promise<T>, force = false): Promise<T> {
  if (!force) {
    if (cache.has(key)) return Promise.resolve(cache.get(key) as T);
    const pending = inflight.get(key);
    if (pending) return pending as Promise<T>;
  }

  const requestGeneration = generation;
  const request = loader()
    .then((value) => {
      if (requestGeneration === generation) cache.set(key, value);
      return value;
    })
    .finally(() => {
      if (inflight.get(key) === request) inflight.delete(key);
    });

  inflight.set(key, request as Promise<unknown>);
  return request;
}

export function invalidateProjectCache(): void {
  generation += 1;
  cache.clear();
  inflight.clear();
}

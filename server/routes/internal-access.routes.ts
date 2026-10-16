import { Router, Request, Response } from 'express';
import { authenticate, requireRole } from '../middleware/auth.middleware.ts';
import { getInternalAccess, recordHealth, updateInternalAccess } from '../services/internal-access.service.ts';

const router = Router();

router.get('/', authenticate, (_req: Request, res: Response): void => {
  res.json(getInternalAccess());
});

router.put('/', authenticate, requireRole(['SuperAdmin']), (req: Request, res: Response): void => {
  try { res.json(updateInternalAccess(req.user!, req.body || {})); }
  catch (err: any) { res.status(400).json({ error: err.message || 'خطا در تنظیم دسترسی داخلی.' }); }
});

router.post('/health-check', authenticate, requireRole(['SuperAdmin']), async (req: Request, res: Response): Promise<void> => {
  const config = getInternalAccess();
  if (!config.url) { res.status(400).json({ error: 'آدرس داخلی تنظیم نشده است.' }); return; }
  try {
    const response = await fetch(`${config.url}/api/health`, { signal: AbortSignal.timeout(3000), headers: { Accept: 'application/json' } });
    const body = await response.json().catch(() => null) as any;
    if (!response.ok || body?.service !== '20Negar Studio API') throw new Error('پاسخ سرویس داخلی مورد انتظار نبود.');
    res.json(recordHealth(req.user!, 'healthy'));
  } catch (err: any) {
    res.status(502).json({ ...recordHealth(req.user!, 'unavailable'), error: err.message || 'سرویس داخلی در دسترس نیست.' });
  }
});

export default router;

import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.middleware.ts';
import { pushService } from '../services/push.service.ts';

/**
 * Web Push API — ثبت دستگاه و ارسال اعلان آزمایشی.
 * کلید عمومی VAPID برای ساخت اشتراک در مرورگر لازم است؛ کلید خصوصی هرگز
 * به کلاینت فرستاده نمی‌شود.
 */
const router = Router();
router.use(authenticate);

router.get('/public-key', (_req: Request, res: Response): void => {
  const publicKey = pushService.getPublicKey();
  if (!publicKey) {
    res.status(503).json({ error: 'اعلان‌های پوش روی این سرور فعال نیستند.' });
    return;
  }
  res.setHeader('Cache-Control', 'no-store');
  res.json({ publicKey });
});

router.get('/status', (req: Request, res: Response): void => {
  res.setHeader('Cache-Control', 'no-store');
  res.json({
    available: pushService.isAvailable(),
    devices: pushService.countForUser(req.user!.id),
  });
});

// ثبت یا بازتازه‌سازی اشتراک دستگاه
router.post('/subscribe', (req: Request, res: Response): void => {
  try {
    if (!pushService.isAvailable()) {
      res.status(503).json({ error: 'اعلان‌های پوش روی این سرور فعال نیستند.' });
      return;
    }
    const subscription = req.body?.subscription ?? req.body;
    const accepted = pushService.subscribe(req.user!.id, subscription, req.get('user-agent'));
    if (!accepted) {
      res.status(400).json({ error: 'اطلاعات اشتراک اعلان نامعتبر است.' });
      return;
    }
    res.status(201).json({ success: true, devices: pushService.countForUser(req.user!.id) });
  } catch (err: any) {
    console.error('[PushRoutes] Subscribe error:', err?.message || err);
    res.status(500).json({ error: 'ثبت اشتراک اعلان با خطا مواجه شد.' });
  }
});

router.post('/unsubscribe', (req: Request, res: Response): void => {
  try {
    pushService.unsubscribe(req.user!.id, req.body?.endpoint);
    res.json({ success: true, devices: pushService.countForUser(req.user!.id) });
  } catch (err: any) {
    console.error('[PushRoutes] Unsubscribe error:', err?.message || err);
    res.status(500).json({ error: 'حذف اشتراک اعلان با خطا مواجه شد.' });
  }
});

// ارسال اعلان آزمایشی به همه دستگاه‌های همین کاربر
router.post('/test', async (req: Request, res: Response): Promise<void> => {
  try {
    const result = await pushService.sendTest(req.user!.id);
    if (result.sent === 0) {
      res.status(409).json({
        error: 'هیچ دستگاه فعالی برای این حساب ثبت نشده است؛ ابتدا اعلان‌ها را روی همین دستگاه فعال کنید.',
        ...result,
      });
      return;
    }
    res.json({ success: true, ...result });
  } catch (err: any) {
    console.error('[PushRoutes] Test error:', err?.message || err);
    res.status(500).json({ error: 'ارسال اعلان آزمایشی با خطا مواجه شد.' });
  }
});

export default router;

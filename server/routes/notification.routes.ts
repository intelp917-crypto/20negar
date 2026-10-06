import { Router, Request, Response } from 'express';
import { NotificationService } from '../services/notification.service.ts';
import { authenticate } from '../middleware/auth.middleware.ts';

const router = Router();

// GET /api/notifications - User's notifications
router.get('/', authenticate, (req: Request, res: Response): void => {
  try {
    const notifications = NotificationService.getUserNotifications(req.user!.id);
    res.json(notifications);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve notifications.' });
  }
});

// PUT /api/notifications/:id/read - Mark one as read
router.put('/:id/read', authenticate, (req: Request, res: Response): void => {
  try {
    const id = parseInt(req.params.id, 10);
    NotificationService.markAsRead(id, req.user!.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to update notification.' });
  }
});

// PUT /api/notifications/read-all - Mark all as read
router.put('/read-all', authenticate, (req: Request, res: Response): void => {
  try {
    NotificationService.markAllAsRead(req.user!.id);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to mark all as read.' });
  }
});

export default router;

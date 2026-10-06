import { Router, Request, Response } from 'express';
import { AuditService } from '../services/audit.service.ts';
import { authenticate, requireRole } from '../middleware/auth.middleware.ts';

const router = Router();

// GET /api/audit-logs - Accessible by Admin
router.get('/', authenticate, requireRole(['Admin']), (req: Request, res: Response): void => {
  try {
    const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : 100;
    const actionFilter = req.query.action ? (req.query.action as string) : undefined;
    const logs = AuditService.getLogs(limit, actionFilter);
    res.json(logs);
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve audit logs.' });
  }
});

export default router;

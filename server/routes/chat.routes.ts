import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.middleware.ts';
import { db } from '../db/database.ts';

const router = Router();

router.get('/messages', authenticate, (_req: Request, res: Response): void => {
  const rows = db.query<any>(
    `SELECT m.id, m.sender_id as senderId, u.display_name as senderName,
            m.message, m.created_at as createdAt
       FROM chat_messages m JOIN users u ON u.id = m.sender_id
      ORDER BY m.id DESC LIMIT 100`
  );
  res.json(rows.reverse());
});

router.post('/messages', authenticate, (req: Request, res: Response): void => {
  const message = String(req.body?.message || '').trim();
  if (!message) { res.status(400).json({ error: 'متن پیام خالی است.' }); return; }
  if (message.length > 2000) { res.status(400).json({ error: 'طول پیام نباید بیشتر از ۲۰۰۰ نویسه باشد.' }); return; }
  const now = new Date().toISOString();
  const result = db.run('INSERT INTO chat_messages (sender_id, message, created_at) VALUES (?, ?, ?)', [req.user!.id, message, now]);
  const created = db.queryOne<any>(
    `SELECT m.id, m.sender_id as senderId, u.display_name as senderName,
            m.message, m.created_at as createdAt
       FROM chat_messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?`,
    [result.lastInsertRowid]
  );
  res.status(201).json(created);
});

export default router;

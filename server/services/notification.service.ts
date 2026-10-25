import { db } from '../db/database.ts';
import { pushService } from './push.service.ts';

export interface NotificationDto {
  id: number;
  userId: number;
  title: string;
  message: string;
  type: 'info' | 'success' | 'warning' | 'error';
  isRead: boolean;
  link: string | null;
  createdAt: string;
}

export class NotificationService {
  public static create(
    userId: number,
    title: string,
    message: string,
    type: 'info' | 'success' | 'warning' | 'error' = 'info',
    link: string | null = null
  ): void {
    try {
      const now = new Date().toISOString();
      db.run(
        `INSERT INTO notifications (user_id, title, message, type, is_read, link, created_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
        [userId, title, message, type, link, now]
      );

      // اعلان درون‌برنامه‌ای ثبت شد؛ همان لحظه به دستگاه‌های ثبت‌شده هم پوش می‌شود.
      // ارسال به‌صورت غیرمسدودکننده انجام می‌شود تا گردش‌کار ویدیو معطل شبکه نشود.
      void pushService
        .sendToUser(userId, {
          title,
          body: message,
          url: link || '/',
          type,
          tag: `20negar-notification-${userId}`,
        })
        .catch((err: any) => console.warn('[NotificationService] Push delivery failed:', err?.message || err));
    } catch (err) {
      console.error('[NotificationService] Failed to create notification:', err);
    }
  }

  public static notifyAllAdmins(
    title: string,
    message: string,
    type: 'info' | 'success' | 'warning' | 'error' = 'info',
    link: string | null = null
  ): void {
    const admins = db.query<{ id: number }>('SELECT id FROM users WHERE role = ? AND is_active = 1', ['Admin']);
    for (const admin of admins) {
      this.create(admin.id, title, message, type, link);
    }
  }

  public static getUserNotifications(userId: number, limit: number = 50): NotificationDto[] {
    const records = db.query<any>(
      `SELECT id, user_id as userId, title, message, type, is_read as isRead, link, created_at as createdAt
       FROM notifications
       WHERE user_id = ?
       ORDER BY id DESC
       LIMIT ?`,
      [userId, limit]
    );
    return records.map((r) => ({
      ...r,
      isRead: Boolean(r.isRead),
    }));
  }

  public static markAsRead(id: number, userId: number): void {
    db.run('UPDATE notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [id, userId]);
  }

  public static markAllAsRead(userId: number): void {
    db.run('UPDATE notifications SET is_read = 1 WHERE user_id = ?', [userId]);
  }
}

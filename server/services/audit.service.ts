import { db } from '../db/database.ts';

export interface AuditLogDto {
  id: number;
  userId: number | null;
  username?: string;
  userRole?: string;
  action: string;
  entityType: string;
  entityId: number | null;
  description: string;
  ipAddress: string | null;
  createdAt: string;
}

export class AuditService {
  public static log(
    userId: number | null,
    action: string,
    entityType: string,
    entityId: number | null,
    description: string,
    ipAddress: string | null = null
  ): void {
    try {
      const now = new Date().toISOString();
      db.run(
        `INSERT INTO audit_logs (user_id, action, entity_type, entity_id, description, ip_address, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId, action, entityType, entityId, description, ipAddress || '127.0.0.1', now]
      );
    } catch (err) {
      console.error('[AuditService] Failed to record audit log:', err);
    }
  }

  public static getLogs(limit: number = 100, actionFilter?: string): AuditLogDto[] {
    let sql = `
      SELECT 
        a.id, a.user_id as userId, u.username, u.role as userRole,
        a.action, a.entity_type as entityType, a.entity_id as entityId,
        a.description, a.ip_address as ipAddress, a.created_at as createdAt
      FROM audit_logs a
      LEFT JOIN users u ON a.user_id = u.id
    `;
    const params: any[] = [];
    if (actionFilter) {
      sql += ` WHERE a.action LIKE ?`;
      params.push(`%${actionFilter}%`);
    }
    sql += ` ORDER BY a.id DESC LIMIT ?`;
    params.push(limit);

    return db.query<AuditLogDto>(sql, params);
  }
}

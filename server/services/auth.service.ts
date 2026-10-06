import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { db } from '../db/database.ts';
import { JWT_SECRET, JWT_EXPIRES_IN } from '../config.ts';

export type UserRole = 'SuperAdmin' | 'Admin' | 'Editor' | 'Supervisor';

export interface UserEntity {
  id: number;
  username: string;
  password_hash: string;
  role: UserRole;
  display_name: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface UserDto {
  id: number;
  username: string;
  role: UserRole;
  displayName: string;
  isActive: boolean;
  createdAt: string;
}

export class AuthService {
  public static async hashPassword(password: string): Promise<string> {
    return bcrypt.hash(password, 10);
  }

  public static async comparePassword(plain: string, hash: string): Promise<boolean> {
    return bcrypt.compare(plain, hash);
  }

  public static generateToken(user: UserEntity): string {
    const payload = {
      id: user.id,
      username: user.username,
      role: user.role,
      displayName: user.display_name,
    };
    return jwt.sign(payload, JWT_SECRET, { expiresIn: JWT_EXPIRES_IN });
  }

  public static verifyToken(token: string): { id: number; username: string; role: UserRole; displayName: string } | null {
    try {
      return jwt.verify(token, JWT_SECRET) as any;
    } catch {
      return null;
    }
  }

  public static toDto(user: UserEntity): UserDto {
    return {
      id: user.id,
      username: user.username,
      role: user.role,
      displayName: user.display_name,
      isActive: Boolean(user.is_active),
      createdAt: user.created_at,
    };
  }

  public static findByUsername(username: string): UserEntity | null {
    return db.queryOne<UserEntity>('SELECT * FROM users WHERE username = ? AND is_active = 1', [username]);
  }

  public static findById(id: number): UserEntity | null {
    return db.queryOne<UserEntity>('SELECT * FROM users WHERE id = ?', [id]);
  }

  public static getAllUsers(): UserDto[] {
    const users = db.query<UserEntity>('SELECT * FROM users ORDER BY id ASC');
    return users.map(this.toDto);
  }

  public static getUsersByRole(role: UserRole): UserDto[] {
    const users = db.query<UserEntity>('SELECT * FROM users WHERE role = ? AND is_active = 1 ORDER BY display_name ASC', [role]);
    return users.map(this.toDto);
  }

  // SuperAdmin user management methods:
  public static async createUser(data: {
    username: string;
    password: string;
    role: UserRole;
    displayName: string;
  }): Promise<UserDto> {
    const existing = db.queryOne('SELECT id FROM users WHERE username = ?', [data.username.trim()]);
    if (existing) {
      throw new Error('نام کاربری مورد نظر از قبل در سیستم ثبت شده است.');
    }

    const hash = await this.hashPassword(data.password);
    const now = new Date().toISOString();

    const res = db.run(
      `INSERT INTO users (username, password_hash, role, display_name, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, 1, ?, ?)`,
      [data.username.trim(), hash, data.role, data.displayName.trim(), now, now]
    );

    const user = this.findById(res.lastInsertRowid)!;
    return this.toDto(user);
  }

  public static updateUser(
    id: number,
    data: {
      displayName?: string;
      role?: UserRole;
      isActive?: boolean;
    }
  ): UserDto {
    const user = this.findById(id);
    if (!user) throw new Error('کاربر مورد نظر یافت نشد.');

    const now = new Date().toISOString();
    const displayName = data.displayName !== undefined ? data.displayName.trim() : user.display_name;
    const role = data.role !== undefined ? data.role : user.role;
    const isActive = data.isActive !== undefined ? (data.isActive ? 1 : 0) : user.is_active;

    db.run(
      `UPDATE users SET display_name = ?, role = ?, is_active = ?, updated_at = ? WHERE id = ?`,
      [displayName, role, isActive, now, id]
    );

    const updated = this.findById(id)!;
    return this.toDto(updated);
  }

  public static async resetPassword(id: number, newPassword: string): Promise<void> {
    const user = this.findById(id);
    if (!user) throw new Error('کاربر مورد نظر یافت نشد.');

    const hash = await this.hashPassword(newPassword);
    const now = new Date().toISOString();
    db.run(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`, [hash, now, id]);
  }

  public static deleteUser(id: number): void {
    const user = this.findById(id);
    if (!user) throw new Error('کاربر مورد نظر یافت نشد.');
    if (user.role === 'SuperAdmin') {
      throw new Error('حساب سوپریوزر اصلی سیستم قابل حذف نیست.');
    }

    // Check if user is associated with any videos
    const vidCount = db.queryOne<{ count: number }>(
      'SELECT COUNT(*) as count FROM videos WHERE editor_id = ? OR supervisor_id = ?',
      [id, id]
    )?.count || 0;

    if (vidCount > 0) {
      // Deactivate instead of hard delete to preserve relational integrity
      db.run('UPDATE users SET is_active = 0 WHERE id = ?', [id]);
    } else {
      db.run('DELETE FROM users WHERE id = ?', [id]);
    }
  }
}

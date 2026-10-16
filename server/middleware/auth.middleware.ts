import { Request, Response, NextFunction } from 'express';
import { AuthService, UserRole } from '../services/auth.service.ts';

export interface AuthenticatedUser {
  id: number;
  username: string;
  role: UserRole;
  displayName: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: AuthenticatedUser;
    }
  }
}

export function authenticate(req: Request, res: Response, next: NextFunction): void {
  let token: string | undefined;

  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith('Bearer ')) {
    token = authHeader.split(' ')[1];
  } else if (req.query.token && typeof req.query.token === 'string') {
    // Kept temporarily for browser media elements that cannot attach headers.
    // Replace with short-lived, scoped media URLs before removing this legacy path.
    token = req.query.token;
  }

  if (!token) {
    res.status(401).json({ error: 'احراز هویت الزامی است. توکن یافت نشد.' });
    return;
  }

  const payload = AuthService.verifyToken(token);
  if (!payload) {
    res.status(401).json({ error: 'توکن نامعتبر یا منقضی شده است.' });
    return;
  }

  // JWT claims are only an identity hint. Re-read the account so role changes
  // and deactivation take effect immediately instead of waiting for expiry.
  const currentUser = AuthService.findById(payload.id);
  if (!currentUser || !currentUser.is_active) {
    res.status(401).json({ error: 'حساب کاربری غیرفعال یا حذف شده است.' });
    return;
  }

  req.user = {
    id: currentUser.id,
    username: currentUser.username,
    role: currentUser.role,
    displayName: currentUser.display_name,
  };
  next();
}

export function requireRole(allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'احراز هویت الزامی است.' });
      return;
    }

    // SuperAdmin has root privileges across all panel endpoints
    if (req.user.role === 'SuperAdmin') {
      return next();
    }

    if (!allowedRoles.includes(req.user.role)) {
      res.status(403).json({
        error: `دسترسی غیرمجاز. نقش '${req.user.role}' دسترسی به این بخش را ندارد.`,
      });
      return;
    }

    next();
  };
}

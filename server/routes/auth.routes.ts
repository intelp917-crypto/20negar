import { Router, Request, Response } from 'express';
import { AuthService } from '../services/auth.service.ts';
import { AuditService } from '../services/audit.service.ts';
import { authenticate } from '../middleware/auth.middleware.ts';

const router = Router();

router.post('/login', async (req: Request, res: Response): Promise<void> => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      res.status(400).json({ error: 'Username and password are required.' });
      return;
    }

    const user = AuthService.findByUsername(username.trim());
    if (!user) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    const isMatch = await AuthService.comparePassword(password, user.password_hash);
    if (!isMatch) {
      res.status(401).json({ error: 'Invalid username or password.' });
      return;
    }

    const token = AuthService.generateToken(user);
    const userDto = AuthService.toDto(user);

    // Record login audit
    AuditService.log(
      user.id,
      'User Login',
      'User',
      user.id,
      `${user.role} "${user.username}" logged in successfully`,
      req.ip || '127.0.0.1'
    );

    res.json({
      token,
      user: userDto,
    });
  } catch (err: any) {
    console.error('[AuthRoutes] Login error:', err);
    res.status(500).json({ error: 'Internal server error during authentication.' });
  }
});

router.get('/me', authenticate, (req: Request, res: Response): void => {
  try {
    const user = AuthService.findById(req.user!.id);
    if (!user) {
      res.status(404).json({ error: 'User not found.' });
      return;
    }
    res.json(AuthService.toDto(user));
  } catch (err: any) {
    res.status(500).json({ error: 'Failed to retrieve profile.' });
  }
});

router.post('/logout', authenticate, (req: Request, res: Response): void => {
  try {
    if (req.user) {
      AuditService.log(
        req.user.id,
        'User Logout',
        'User',
        req.user.id,
        `${req.user.role} "${req.user.username}" logged out`,
        req.ip || '127.0.0.1'
      );
    }
    res.json({ message: 'Logged out successfully.' });
  } catch (err) {
    res.status(500).json({ error: 'Logout failed.' });
  }
});

export default router;

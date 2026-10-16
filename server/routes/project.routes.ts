import { Router, Request, Response } from 'express';
import { authenticate } from '../middleware/auth.middleware.ts';
import { addMember, createProject, getProject, listProjects } from '../services/project.service.ts';

const router = Router();
router.use(authenticate);

router.get('/', (req: Request, res: Response): void => {
  res.json(listProjects(req.user!));
});

router.get('/:id', (req: Request, res: Response): void => {
  const project = getProject(req.user!, Number(req.params.id));
  if (!project) { res.status(404).json({ error: 'پروژه یافت نشد.' }); return; }
  res.json(project);
});

router.post('/', (req: Request, res: Response): void => {
  try { res.status(201).json(createProject(req.user!, req.body || {})); }
  catch (err: any) { res.status(400).json({ error: err.message || 'خطا در ایجاد پروژه.' }); }
});

router.post('/:id/members', (req: Request, res: Response): void => {
  try {
    addMember(req.user!, Number(req.params.id), Number(req.body?.userId), req.body?.accessLevel || 'member');
    res.status(204).end();
  } catch (err: any) { res.status(403).json({ error: err.message || 'خطا در عضویت پروژه.' }); }
});

export default router;

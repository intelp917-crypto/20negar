import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { PORT } from './server/config.ts';
import { db } from './server/db/database.ts';
import { runMigrations } from './server/db/schema.ts';
import { seedDatabase } from './server/db/seed.ts';
import { TranscoderService } from './server/services/transcoder.service.ts';

import authRoutes from './server/routes/auth.routes.ts';
import userRoutes from './server/routes/user.routes.ts';
import videoRoutes from './server/routes/video.routes.ts';
import notificationRoutes from './server/routes/notification.routes.ts';
import auditRoutes from './server/routes/audit.routes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();

  // Basic security and parsing middlewares
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // Disable x-powered-by
  app.disable('x-powered-by');

  // Initialize Relational Database & Background Transcoder
  console.log('[Startup] Initializing Relational Database...');
  await db.initialize();
  runMigrations();
  await seedDatabase();
  console.log('[Startup] Relational Database initialized & migrations applied.');

  // Start background worker
  TranscoderService.startWorker();

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api', userRoutes); // support GET /api/editors, /api/supervisors
  app.use('/api/videos', videoRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/audit-logs', auditRoutes);

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: 'CineFlow Studio API', time: new Date().toISOString() });
  });

  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    // Development mode: Mount Vite middleware
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
    console.log('[Vite] Middleware mounted in development mode.');
  } else {
    // Production mode: Serve static files from dist
    const distPath = path.resolve(__dirname, 'dist');
    if (fs.existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get('*', (_req, res) => {
        res.sendFile(path.resolve(distPath, 'index.html'));
      });
    } else {
      console.warn('[Warning] dist directory not found. Please run "npm run build".');
    }
  }

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`🎬 CineFlow Video Management System is running!`);
    console.log(`📡 URL: http://localhost:${PORT}`);
    console.log(`👥 Seed Users:`);
    console.log(`   - Admin:      admin1      / admin1`);
    console.log(`   - Editor:     editor1     / editor1`);
    console.log(`   - Supervisor: supervisor1 / supervisor1`);
    console.log(`=======================================================`);
  });

  // Graceful shutdown
  const shutdown = () => {
    console.log('[Server] Gracefully shutting down...');
    TranscoderService.stopWorker();
    db.persistImmediate();
    server.close(() => {
      console.log('[Server] Closed all connections.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

startServer().catch((err) => {
  console.error('[Fatal Error] Failed to start server:', err);
  process.exit(1);
});

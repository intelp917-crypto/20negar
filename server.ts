import express from 'express';
import http from 'http';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import { PORT, ENABLE_STANDARD_PORTS, HTTP_PORT, SECURE_PORT } from './server/config.ts';
import { ensureTlsMaterial } from './server/tls.ts';
import { UpdateService } from './server/services/update.service.ts';
import { db } from './server/db/database.ts';
import { runMigrations } from './server/db/schema.ts';
import { seedDatabase } from './server/db/seed.ts';
import { TranscoderService } from './server/services/transcoder.service.ts';

import authRoutes from './server/routes/auth.routes.ts';
import userRoutes from './server/routes/user.routes.ts';
import videoRoutes from './server/routes/video.routes.ts';
import notificationRoutes from './server/routes/notification.routes.ts';
import auditRoutes from './server/routes/audit.routes.ts';
import uploadRoutes from './server/routes/upload.routes.ts';

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
  app.use('/api/chunked-uploads', uploadRoutes);

  // Health check
  app.get('/api/health', (_req, res) => {
    res.json({ status: 'ok', service: '20Negar Studio API', time: new Date().toISOString() });
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

  const extraServers: http.Server[] = [];

  const describeListenError = (port: number, label: string, err: NodeJS.ErrnoException): string => {
    if (err.code === 'EADDRINUSE') {
      return `[Server] پورت ${port} (${label}) توسط برنامه دیگری اشغال است — این پورت رد شد.`;
    }
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      return (
        `[Server] دسترسی به پورت ${port} (${label}) رد شد. ` +
        `(ویندوز: معمولاً سرویس دیگری مثل IIS/SQL Reporting این پورت را گرفته است.)\n` +
        `         برای باز کردن پورت در فایروال ویندوز:\n` +
        `         netsh advfirewall firewall add rule name="20Negar ${port}" dir=in action=allow protocol=TCP localport=${port}`
      );
    }
    return `[Server] خطای گوش دادن روی پورت ${port} (${label}): ${err.message}`;
  };

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`🎬 20Negar Video Management System is running!`);
    console.log(`📡 URL: http://localhost:${PORT}`);
    console.log(`👥 Seed Users:`);
    console.log(`   - Admin:      admin1      / admin1`);
    console.log(`   - Editor:     editor1     / editor1`);
    console.log(`   - Supervisor: supervisor1 / supervisor1`);
    console.log(`=======================================================`);

    // پورت‌های استاندارد 80/443: VPN ها معمولاً فقط ترافیک این پورت‌ها را عبور می‌دهند،
    // بنابراین با روشن بودن VPN هم سایت قابل دسترسی می‌ماند.
    if (ENABLE_STANDARD_PORTS) {
      if (HTTP_PORT !== PORT) {
        const httpServer = http.createServer(app);
        httpServer.on('error', (err: NodeJS.ErrnoException) => console.warn(describeListenError(HTTP_PORT, 'HTTP', err)));
        httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
          console.log(`[Server] ✅ پورت استاندارد HTTP  ${HTTP_PORT} فعال شد (دسترسی با VPN)`);
        });
        extraServers.push(httpServer);
      }

      if (SECURE_PORT !== PORT && SECURE_PORT !== HTTP_PORT) {
        const tlsMaterial = ensureTlsMaterial();
        const secureServer = tlsMaterial ? https.createServer(tlsMaterial, app) : http.createServer(app);
        secureServer.on('error', (err: NodeJS.ErrnoException) => console.warn(describeListenError(SECURE_PORT, 'HTTPS', err)));
        secureServer.listen(SECURE_PORT, '0.0.0.0', () => {
          console.log(
            `[Server] ✅ پورت استاندارد ${SECURE_PORT} ${tlsMaterial ? 'HTTPS' : 'HTTP'} فعال شد (دسترسی با VPN)` +
              (tlsMaterial ? ` — گواهی خودامضا؛ مرورگر یک بار هشدار می‌دهد.` : '')
          );
        });
        extraServers.push(secureServer);
      }
    }
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error(describeListenError(PORT, 'main', err));
    console.error('[Server] راه‌اندازی سرور اصلی ناموفق بود.');
    process.exit(1);
  });

  // ری‌استارت پس از بروزرسانی اجباری (فیچر ۲)
  UpdateService.setRestarter(() => {
    console.log('[Update] در حال بستن سرور فعلی و اجرای نسخه بروزرسانی‌شده...');
    try {
      for (const s of extraServers) s.close();
      server.close();
    } catch {}
    setTimeout(() => {
      UpdateService.spawnSelf();
      process.exit(0);
    }, 400);
  });

  // بروزرسانی خودکار هنگام راه‌اندازی (فیچر ۲ — حالت اول)
  if ((process.env.UPDATE_ON_STARTUP || 'true').toLowerCase() !== 'false') {
    try {
      const startupUpdate = await UpdateService.applyUpdate({ npmInstall: true });
      if (startupUpdate.changed) {
        if (process.env.FREEBUFF_UPDATE_RESTARTED === '1') {
          console.warn('[Update] بروزرسانی اعمال شد اما ری‌استارت خودکار تکرار نمی‌شود. لطفاً سرور را دستی ری‌استارت کنید.');
        } else {
          console.log(`[Update] بروزرسانی اعمال شد (${startupUpdate.filesChanged} فایل). ری‌استارت در ۳ ثانیه دیگر...`);
          setTimeout(() => {
            UpdateService.spawnSelf();
            process.exit(0);
          }, 3000);
        }
      } else if (startupUpdate.error) {
        console.warn(`[Update] بروزرسانی خودکار انجام نشد: ${startupUpdate.error}`);
      } else {
        console.log('[Update] نسخه وب‌اپ با ریپوزیتوری GitHub هم‌سان است.');
      }
    } catch (err: any) {
      console.warn('[Update] خطای بروزرسانی خودکار:', err?.message || err);
    }
  }

  // Graceful shutdown
  const shutdown = () => {
    console.log('[Server] Gracefully shutting down...');
    TranscoderService.stopWorker();
    db.persistImmediate();
    for (const s of extraServers) {
      try {
        s.close();
      } catch {}
    }
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

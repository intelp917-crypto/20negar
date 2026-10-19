import express from 'express';
import http from 'http';
import https from 'https';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';
import os from 'os';
import crypto from 'crypto';
import {
  PORT,
  ENABLE_STANDARD_PORTS,
  HTTP_PORT,
  SECURE_PORT,
  CORS_ORIGINS,
  DATA_DIR,
  STORAGE_DIR,
  PRIVATE_VIDEOS_DIR,
  DB_FILE_PATH,
  TRANSCODER_ENABLED,
  ACME_WEBROOT_DIR,
} from './server/config.ts';
import { ensureTlsMaterial } from './server/tls.ts';
import { UpdateService } from './server/services/update.service.ts';
import { db } from './server/db/database.ts';
import { runMigrations } from './server/db/schema.ts';
import { seedDatabase } from './server/db/seed.ts';
import { TranscoderService } from './server/services/transcoder.service.ts';
import {
  ensureTransferEngine,
  proxyToTransferEngine,
  stopTransferEngine,
} from './server/services/transfer.service.ts';

import authRoutes from './server/routes/auth.routes.ts';
import userRoutes from './server/routes/user.routes.ts';
import videoRoutes from './server/routes/video.routes.ts';
import notificationRoutes from './server/routes/notification.routes.ts';
import auditRoutes from './server/routes/audit.routes.ts';
import projectRoutes from './server/routes/project.routes.ts';
import internalAccessRoutes from './server/routes/internal-access.routes.ts';
import uploadRoutes from './server/routes/upload.routes.ts';
import tusRoutes from './server/routes/tus.routes.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();

  // VPN, Reverse Proxy & Port Forwarding support
  const trustProxy = /^(1|true|yes)$/i.test((process.env.TRUST_PROXY || '').trim());
  app.set('trust proxy', trustProxy);

  // Disable x-powered-by
  app.disable('x-powered-by');

  // CORS is explicit for cross-origin LAN transfer candidates. Same-origin public-IP
  // access does not need CORS at all; reflecting arbitrary origins with credentials is
  // unsafe and also produces an invalid `*` response when Origin is absent.
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    const requestOrigin = `${req.protocol}://${req.get('host')}`;
    const allowed = origin && (CORS_ORIGINS.includes(origin) || origin === requestOrigin);
    if (allowed) {
      res.header('Access-Control-Allow-Origin', origin);
      res.header('Vary', 'Origin');
      res.header('Access-Control-Allow-Credentials', 'true');
    }
    res.header('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, PATCH, OPTIONS');
    res.header(
      'Access-Control-Allow-Headers',
      'Origin, X-Requested-With, Content-Type, Accept, Authorization, X-Upload-Meta, Range, ' +
        'Tus-Resumable, Tus-Version, Tus-Extension, Tus-Max-Size, Upload-Length, Upload-Offset, ' +
        'Upload-Metadata, Upload-Concat, Upload-Defer-Length, Location'
    );
    res.header(
      'Access-Control-Expose-Headers',
      'Content-Range, Accept-Ranges, Content-Length, Content-Type, Location, Tus-Resumable, Upload-Offset, Upload-Length'
    );
    if (req.method === 'OPTIONS') {
      res.sendStatus(200);
      return;
    }
    next();
  });

  // Rust transfer engine proxy. Mounted before the body parsers on purpose:
  // upload chunks are streamed straight through, never buffered by Express.
  app.use('/api/transfer', proxyToTransferEngine);

  // Basic security and parsing middlewares
  app.use(express.json({ limit: '50mb' }));
  app.use(express.urlencoded({ extended: true, limit: '50mb' }));

  // The desktop manager reads these lines back to prove which paths the JS
  // server actually booted with, so a path change is verifiable end to end.
  console.log(`[Config] Data directory: ${DATA_DIR}`);
  console.log(`[Config] Storage root: ${STORAGE_DIR}`);
  console.log(`[Config] Videos root: ${PRIVATE_VIDEOS_DIR}`);
  console.log(`[Config] Database file: ${DB_FILE_PATH}`);

  // Initialize Relational Database & Background Transcoder
  console.log('[Startup] Initializing Relational Database...');
  await db.initialize();
  runMigrations();
  await seedDatabase();
  console.log('[Startup] Relational Database initialized & migrations applied.');

  // FFmpeg is never part of the automatic startup path. Uploaded files are kept
  // byte-for-byte and streamed directly; a transcode job only runs when it was
  // queued explicitly, or when the operator opted in with NEGAR_TRANSCODER_ENABLED.
  if (TRANSCODER_ENABLED) {
    TranscoderService.startWorker();
  } else {
    console.log('[Transcoder] Automatic FFmpeg processing is disabled (set NEGAR_TRANSCODER_ENABLED=true to enable).');
  }

  // Start the Rust upload/download engine (non-fatal if it is unavailable).
  try {
    const engineUp = await ensureTransferEngine();
    if (!engineUp) {
      console.warn('[Transfer] Continuing with the built-in Node upload/download handlers.');
    }
  } catch (err: any) {
    console.warn('[Transfer] Engine startup error:', err?.message || err);
  }

  // ACME HTTP-01 challenge files, published by the desktop manager when it
  // requests or renews a Let's Encrypt certificate. The path is fixed by the
  // ACME specification and holds nothing else.
  app.use(
    '/.well-known/acme-challenge',
    express.static(path.join(ACME_WEBROOT_DIR, '.well-known', 'acme-challenge'),
      { dotfiles: 'allow', index: false, fallthrough: false })
  );

  // API Routes
  app.use('/api/auth', authRoutes);
  app.use('/api/users', userRoutes);
  app.use('/api', userRoutes); // support GET /api/editors, /api/supervisors
  app.use('/api/videos', videoRoutes);
  app.use('/api/notifications', notificationRoutes);
  app.use('/api/audit-logs', auditRoutes);
  app.use('/api/projects', projectRoutes);
  app.use('/api/internal-access', internalAccessRoutes);
  app.use('/api/chunked-uploads', uploadRoutes);
  // آپلود TUS (پروتکل استاندارد ازسره‌گیر — سریع و مقاوم در برابر قطعی)
  app.use('/api/tus', tusRoutes);

  // Health check
  const instanceId = crypto.randomBytes(32).toString('hex');
  app.get('/api/health', (_req, res) => {
    const protocol = _req.protocol;
    const localTransferOrigins = new Set<string>();
    for (const addresses of Object.values(os.networkInterfaces())) {
      for (const address of addresses || []) {
        if (address.family === 'IPv4' && !address.internal) {
          const privateAddress = /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address.address);
          if (!privateAddress) continue;
          const port = protocol === 'https' ? SECURE_PORT : PORT;
          localTransferOrigins.add(`${protocol}://${address.address}:${port}`);
        }
      }
    }
    res.json({
      status: 'ok',
      instanceId,
      service: '20Negar Studio API',
      time: new Date().toISOString(),
      // The client may probe these only after the public route is reachable. This
      // avoids declaring the app offline when NAT loopback is unavailable.
      transferRoutes: Array.from(localTransferOrigins).map((origin) => `${origin}/api/transfer`),
    });
  });

  const isProduction = process.env.NODE_ENV === 'production';

  if (!isProduction) {
    // Development mode: Mount Vite middleware
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true, allowedHosts: true, cors: true },
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
      return `[Server] Port ${port} (${label}) is already in use by another process — skipping this port.`;
    }
    if (err.code === 'EACCES' || err.code === 'EPERM') {
      return (
        `[Server] Permission denied for port ${port} (${label}). ` +
        `(On Windows another service such as IIS/SQL Reporting usually owns it.)\n` +
        `         To open the port in the Windows firewall:\n` +
        `         netsh advfirewall firewall add rule name="20Negar ${port}" dir=in action=allow protocol=TCP localport=${port}`
      );
    }
    return `[Server] Failed to listen on port ${port} (${label}): ${err.message}`;
  };

  const server = app.listen(PORT, '0.0.0.0', () => {
    console.log(`=======================================================`);
    console.log(`20Negar Video Management System is running.`);
    console.log(`URL: http://localhost:${PORT}`);
    console.log(`=======================================================`);

        const lanAddresses = Object.values(os.networkInterfaces())
      .flat()
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry) && entry!.family === 'IPv4' && !entry!.internal)
      .map((entry) => entry.address);
    if (lanAddresses.length > 0) {
      console.log('[Network] LAN addresses available for router port forwarding:');
      for (const address of lanAddresses) console.log(`  http://${address}:${PORT}`);
      console.log(
        '[Network] For internet access: forward this port in your router, set VPN to Bypass LAN mode, and test from outside.'
      );
    }
    if (PORT < 1024) {
      console.warn(`[Network] Port ${PORT} is a privileged port and requires Administrator access on Windows.`);
    }

    // Standard ports 80/443: VPNs usually only pass traffic on these ports,
    // so the site stays reachable while a VPN is active.
    if (ENABLE_STANDARD_PORTS) {
      if (HTTP_PORT !== PORT) {
        const httpServer = http.createServer(app);
        httpServer.on('error', (err: NodeJS.ErrnoException) => console.warn(describeListenError(HTTP_PORT, 'HTTP', err)));
        httpServer.listen(HTTP_PORT, '0.0.0.0', () => {
          console.log(`[Server] Standard HTTP port ${HTTP_PORT} is active (VPN reachable).`);
        });
        extraServers.push(httpServer);
      }

      if (SECURE_PORT !== PORT && SECURE_PORT !== HTTP_PORT) {
        const tlsMaterial = ensureTlsMaterial();
        if (!tlsMaterial) {
          console.warn('[TLS] HTTPS listener skipped: no TLS certificate is available. Configure TLS_KEY_PATH and TLS_CERT_PATH.');
          return;
        }
        const secureServer = https.createServer(tlsMaterial, app);
        secureServer.on('error', (err: NodeJS.ErrnoException) => console.warn(describeListenError(SECURE_PORT, 'HTTPS', err)));
        secureServer.listen(SECURE_PORT, '0.0.0.0', () => {
          console.log(
            `[Server] Standard ${SECURE_PORT} ${tlsMaterial ? 'HTTPS' : 'HTTP'} port is active (VPN reachable).` +
              (process.env.TLS_CERT_PATH ? '' : ' Development certificate: Android PWA installation requires a trusted certificate matching the URL.')
          );
        });
        extraServers.push(secureServer);
      }
    }
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    console.error(describeListenError(PORT, 'main', err));
    console.error('[Server] Failed to start the main server.');
    process.exit(1);
  });

  // Restart after a forced update.
  UpdateService.setRestarter(() => {
    console.log('[Update] Closing the current server and starting the updated version...');
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
        if (process.env.NEGAR_UPDATE_RESTARTED === '1') {
          console.warn('[Update] Update applied, but the automatic restart will not repeat. Please restart the server manually.');
        } else {
          console.log(`[Update] Update applied (${startupUpdate.filesChanged} files). Restarting in 3 seconds...`);
          setTimeout(() => {
            UpdateService.spawnSelf();
            process.exit(0);
          }, 3000);
        }
      } else if (startupUpdate.error) {
        console.warn(`[Update] Automatic update did not complete: ${startupUpdate.error}`);
      } else {
        console.log('[Update] The web app is in sync with the GitHub repository.');
      }
    } catch (err: any) {
      console.warn('[Update] Automatic update error:', err?.message || err);
    }
  }

  // Graceful shutdown
  const shutdown = () => {
    console.log('[Server] Gracefully shutting down...');
    TranscoderService.stopWorker();
    stopTransferEngine();
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

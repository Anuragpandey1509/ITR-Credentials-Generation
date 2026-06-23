import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import helmet from 'helmet';
import http from 'http';
import { connectDb, closeDb } from './db/client';
import { jobsRouter } from './routes/jobs';
import { webhookRouter } from './routes/webhook';
import { sseRouter } from './routes/sse';
import { otpRouter } from './routes/otp';
import { metricsRouter } from './routes/metrics';
import { eventsRouter } from './routes/events';
import { pollRouter } from './routes/poll';
import { config } from './config';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// App factory
// ---------------------------------------------------------------------------

export function createApp() {
  const app = express();

  // --- Security & parsing ---
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: '*', exposedHeaders: ['X-Request-Id'] }));
  app.use(express.json({ limit: '2mb' }));

  // --- Correlation ID echo ---
  app.use((req: Request, res: Response, next: NextFunction) => {
    const reqId = (req.headers['x-request-id'] as string) ?? '';
    if (reqId) res.setHeader('X-Request-Id', reqId);
    next();
  });

  // --- Health (no auth) ---
  app.get('/health', (_req, res) => res.json({ status: 'ok', ts: new Date().toISOString() }));

  // --- Routes ---
  app.use('/jobs',         jobsRouter);
  app.use('/jobs',         sseRouter);
  app.use('/jobs',         otpRouter);
  app.use('/jobs',         eventsRouter);
  app.use('/jobs',         pollRouter);
  app.use('/webhook',      webhookRouter);
  app.use('/metrics',      metricsRouter);

  // --- 404 ---
  app.use((_req, res) => res.status(404).json({ error: 'Not found' }));

  // --- Global error handler ---
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    logger.error({ err }, 'Unhandled error');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

// ---------------------------------------------------------------------------
// Main — start server + graceful shutdown
// ---------------------------------------------------------------------------

async function main() {
  await connectDb();

  const app = createApp();
  const server = http.createServer(app);

  server.listen(config.port, () => {
    logger.info({ port: config.port, env: config.nodeEnv }, 'Service listening');
  });

  // --- Graceful shutdown ---
  let shuttingDown = false;

  async function shutdown(signal: string) {
    if (shuttingDown) return;
    shuttingDown = true;
    logger.info({ signal }, 'Graceful shutdown initiated');

    server.close(async () => {
      logger.info('HTTP server closed');
      await closeDb();
      logger.info('Shutdown complete');
      process.exit(0);
    });

    // Force quit after 10s
    setTimeout(() => {
      logger.error('Forced shutdown after timeout');
      process.exit(1);
    }, 10_000);
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));

  process.on('uncaughtException', (err) => {
    logger.error({ err }, 'Uncaught exception — shutting down');
    shutdown('uncaughtException');
  });

  process.on('unhandledRejection', (reason) => {
    logger.error({ reason }, 'Unhandled rejection — shutting down');
    shutdown('unhandledRejection');
  });
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});

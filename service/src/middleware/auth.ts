import { Request, Response, NextFunction } from 'express';
import { config } from '../config';

// ---------------------------------------------------------------------------
// Auth middleware
// ---------------------------------------------------------------------------

/**
 * Validates `Authorization: Bearer <token>` on mutating/read routes.
 */
export function requireBearer(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers['authorization'] ?? '';
  const token = header.startsWith('Bearer ') ? header.slice(7) : '';

  if (!token || token !== config.auth.bearerToken) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

/**
 * Validates `X-Webhook-Secret` header on the webhook ingest route.
 */
export function requireWebhookSecret(req: Request, res: Response, next: NextFunction): void {
  const secret = req.headers['x-webhook-secret'] ?? '';

  if (!secret || secret !== config.auth.webhookSecret) {
    res.status(401).json({ error: 'Invalid webhook secret' });
    return;
  }
  next();
}

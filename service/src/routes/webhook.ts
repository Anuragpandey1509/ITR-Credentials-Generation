import { Router, Request, Response, NextFunction } from 'express';
import type { WebhookEventPayload } from '@itr/shared';
import { handleWebhookEvent } from '../domain/job';
import { nextEventSeq } from '../repository/job-repo';
import { requireWebhookSecret } from '../middleware/auth';
import { logger } from '../logger';

export const webhookRouter = Router();

// ---------------------------------------------------------------------------
// POST /webhook/events
// Authenticated with the WEBHOOK_SECRET header (not the bearer token).
// The bot pushes one payload per event / phase change.
// ---------------------------------------------------------------------------

webhookRouter.post(
  '/events',
  requireWebhookSecret,
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const payload = req.body as WebhookEventPayload;

      if (!payload?.event?.jobId) {
        return res.status(400).json({ error: 'Missing event.jobId' });
      }

      // Assign seq from the authoritative counter (prevents race conditions
      // if bot retries — seq is assigned server-side, not bot-side)
      const seq = await nextEventSeq(payload.event.jobId);
      payload.event.seq = seq;

      logger.debug(
        { jobId: payload.event.jobId, seq, step: payload.event.step },
        'Webhook event received'
      );

      await handleWebhookEvent(
        payload.event,
        payload.phaseTransition,
        payload.outcome,
        payload.credentials
      );

      // Echo correlation id
      res.setHeader('X-Request-Id', req.headers['x-request-id'] ?? '');
      return res.status(204).send();
    } catch (err) {
      return next(err);
    }
  }
);

webhookRouter.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, 'Webhook route error');
  return res.status(500).json({ error: 'Internal server error' });
});

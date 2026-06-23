import { Router, Request, Response } from 'express';
import { getEventsAfterSeq } from '../repository/event-repo';
import { getJobById } from '../repository/job-repo';
import { fanOut } from '../sse/fan-out';
import { config } from '../config';
import { logger } from '../logger';

export const sseRouter = Router();

// ---------------------------------------------------------------------------
// GET /jobs/:id/stream
//
// SSE stream for a single job's events.
//
// Reconnect protocol:
//   - Client sends `Last-Event-ID` header (set automatically by browser EventSource)
//   - We replay all events with seq > Last-Event-ID from Mongo
//   - Then subscribe to live tail from ring buffer
//   - SSE `id:` field = event seq (enables gapless resume)
//
// No auth on this endpoint (per assignment: "don't over-build it").
// In production, add a short-lived signed token.
// ---------------------------------------------------------------------------

sseRouter.get('/:id/stream', async (req: Request, res: Response) => {
  const jobId = req.params['id']!;

  // Verify job exists
  const job = await getJobById(jobId);
  if (!job) {
    res.status(404).json({ error: 'Job not found' });
    return;
  }

  // Parse Last-Event-ID for replay (browser sends this automatically on reconnect)
  const lastEventIdHeader = req.headers['last-event-id'];
  const afterSeq = lastEventIdHeader ? parseInt(lastEventIdHeader as string, 10) : 0;

  // SSE headers
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no'); // disable nginx buffering
  res.flushHeaders();

  logger.debug({ jobId, afterSeq }, 'SSE client connected');

  // --- Replay backlog from Mongo ---
  try {
    const missed = await getEventsAfterSeq(jobId, afterSeq);
    for (const evt of missed) {
      res.write(`id:${evt.seq}\ndata:${JSON.stringify(evt)}\n\n`);
    }
    logger.debug({ jobId, replayed: missed.length }, 'SSE backlog replayed');
  } catch (err) {
    logger.error({ err, jobId }, 'SSE replay error');
  }

  // --- Subscribe to live tail ---
  const unsubscribe = fanOut.subscribe(jobId, res, afterSeq);

  // --- Heartbeat to keep connection alive through proxies ---
  const heartbeat = setInterval(() => {
    try {
      res.write(': heartbeat\n\n');
    } catch {
      clearInterval(heartbeat);
    }
  }, config.sseHeartbeatMs);

  // --- Cleanup on client disconnect ---
  req.on('close', () => {
    clearInterval(heartbeat);
    unsubscribe();
    logger.debug({ jobId }, 'SSE client disconnected');
  });
});

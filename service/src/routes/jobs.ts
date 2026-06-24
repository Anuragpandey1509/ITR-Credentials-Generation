import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { startJob, cancelJob, ValidationError, NotFoundError } from '../domain/job';
import * as jobRepo from '../repository/job-repo';
import { requireBearer } from '../middleware/auth';
import { logger } from '../logger';

export const jobsRouter = Router();

// ---------------------------------------------------------------------------
// POST /jobs — start a new run
// ---------------------------------------------------------------------------

jobsRouter.post(
  '/',
  requireBearer,
  body('pan')
    .isString()
    .trim()
    .matches(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i)
    .withMessage('PAN must be 5 alpha + 4 digits + 1 alpha (e.g. ABCDE1234F)'),
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    try {
      const pan: string = (req.body.pan as string).toUpperCase();
      const job = await startJob(pan);
      res.setHeader('X-Request-Id', req.headers['x-request-id'] ?? job.jobId);
      return res.status(202).json(job);
    } catch (err) {
      return next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// GET /jobs — list all runs (paginated, filterable)
// ---------------------------------------------------------------------------

jobsRouter.get('/', requireBearer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { phase, outcome, limit, page } = req.query as Record<string, string>;
    const parsedLimit = limit ? parseInt(limit, 10) : 5;
    const parsedPage = page ? parseInt(page, 10) : 1;
    const { jobs, total } = await jobRepo.listJobs({
      phase: phase as never,
      outcome: outcome as never,
      limit: parsedLimit,
      page: parsedPage,
    });
    res.setHeader('X-Request-Id', req.headers['x-request-id'] ?? '');
    return res.json({ jobs, total, page: parsedPage, limit: parsedLimit, count: jobs.length });
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /jobs/:id — single run status
// ---------------------------------------------------------------------------

jobsRouter.get('/:id', requireBearer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = await jobRepo.getJobById(req.params['id']!);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    return res.json(job);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// POST /jobs/:id/cancel
// ---------------------------------------------------------------------------

jobsRouter.post('/:id/cancel', requireBearer, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const job = await cancelJob(req.params['id']!);
    if (!job) return res.status(404).json({ error: 'Job not found' });
    return res.json(job);
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// Global error handler for this router
// ---------------------------------------------------------------------------

jobsRouter.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, 'Jobs route error');
  if (err instanceof ValidationError) return res.status(400).json({ error: err.message });
  if (err instanceof NotFoundError)   return res.status(404).json({ error: err.message });
  return res.status(500).json({ error: 'Internal server error' });
});

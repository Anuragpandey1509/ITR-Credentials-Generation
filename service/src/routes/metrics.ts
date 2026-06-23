import { Router, Request, Response } from 'express';
import { getMetricsCounts, getDurationPercentiles } from '../repository/job-repo';
import type { MetricsResponse } from '@itr/shared';

export const metricsRouter = Router();

// ---------------------------------------------------------------------------
// GET /metrics — public endpoint (no auth, health-check friendly)
// ---------------------------------------------------------------------------

metricsRouter.get('/', async (_req: Request, res: Response) => {
  const [counts, percentiles] = await Promise.all([
    getMetricsCounts(),
    getDurationPercentiles(),
  ]);

  const successRate =
    counts.total > 0 ? Math.round((counts.success / counts.total) * 100) : 0;

  const payload: MetricsResponse = {
    totalRuns:      counts.total,
    successCount:   counts.success,
    failureCount:   counts.failure,
    cancelledCount: counts.cancelled,
    successRate,
    p50DurationMs:  percentiles.p50,
    p99DurationMs:  percentiles.p99,
    activeRuns:     counts.active,
  };

  return res.json(payload);
});

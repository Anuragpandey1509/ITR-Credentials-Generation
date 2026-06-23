import { Router, Request, Response, NextFunction } from 'express';
import { body, validationResult } from 'express-validator';
import { storeOtp, storeCaptcha } from '../repository/job-repo';
import { getJobById } from '../repository/job-repo';
import { requireBearer } from '../middleware/auth';
import { logger } from '../logger';

export const otpRouter = Router();

// ---------------------------------------------------------------------------
// POST /jobs/:id/otp
// Operator submits the OTP received on their phone.
// Bot is long-polling consumeOtp() and will pick this up.
// ---------------------------------------------------------------------------

otpRouter.post(
  '/:id/otp',
  requireBearer,
  body('otp').isString().trim().isLength({ min: 4, max: 8 }).withMessage('OTP must be 4–8 characters'),
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    try {
      const jobId = req.params['id']!;
      const job = await getJobById(jobId);
      if (!job) return res.status(404).json({ error: 'Job not found' });

      if (job.phase !== 'WAITING_FOR_OTP') {
        return res.status(409).json({
          error: `Job is not waiting for OTP (current phase: ${job.phase})`,
        });
      }

      const stored = await storeOtp(jobId, req.body.otp as string);
      if (!stored) return res.status(500).json({ error: 'Failed to store OTP' });

      logger.info({ jobId }, 'OTP stored — bot will pick up');
      return res.status(204).send();
    } catch (err) {
      return next(err);
    }
  }
);

// ---------------------------------------------------------------------------
// POST /jobs/:id/captcha
// Operator submits the CAPTCHA solution shown in the UI.
// ---------------------------------------------------------------------------

otpRouter.post(
  '/:id/captcha',
  requireBearer,
  body('captcha').isString().trim().isLength({ min: 1, max: 20 }),
  async (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ error: 'Validation failed', details: errors.array() });
    }

    try {
      const jobId = req.params['id']!;
      const job = await getJobById(jobId);
      if (!job) return res.status(404).json({ error: 'Job not found' });

      if (job.phase !== 'CAPTCHA') {
        return res.status(409).json({
          error: `Job is not waiting for CAPTCHA (current phase: ${job.phase})`,
        });
      }

      const stored = await storeCaptcha(jobId, req.body.captcha as string);
      if (!stored) return res.status(500).json({ error: 'Failed to store CAPTCHA' });

      logger.info({ jobId }, 'CAPTCHA solution stored');
      return res.status(204).send();
    } catch (err) {
      return next(err);
    }
  }
);

otpRouter.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  logger.error({ err }, 'OTP route error');
  return res.status(500).json({ error: 'Internal server error' });
});

import { Router, Request, Response, NextFunction } from 'express';
import { consumeOtp, consumeCaptcha } from '../repository/job-repo';
import { requireWebhookSecret } from '../middleware/auth';

export const pollRouter = Router();

// ---------------------------------------------------------------------------
// GET /jobs/:id/otp-poll — bot polls this to get the OTP submitted by operator
// Auth: webhook secret (only the bot should call this)
// ---------------------------------------------------------------------------

pollRouter.get('/:id/otp-poll', requireWebhookSecret, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const otp = await consumeOtp(req.params['id']!);
    if (otp) {
      return res.json({ otp });
    }
    return res.status(204).send(); // Not ready yet
  } catch (err) {
    return next(err);
  }
});

// ---------------------------------------------------------------------------
// GET /jobs/:id/captcha-poll — bot polls this for CAPTCHA solution
// ---------------------------------------------------------------------------

pollRouter.get('/:id/captcha-poll', requireWebhookSecret, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const captcha = await consumeCaptcha(req.params['id']!);
    if (captcha) {
      return res.json({ captcha });
    }
    return res.status(204).send();
  } catch (err) {
    return next(err);
  }
});

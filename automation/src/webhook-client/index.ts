import type { JobEvent, WebhookEventPayload, Phase, Level, Outcome } from '@itr/shared';
import { config } from '../config';

// ---------------------------------------------------------------------------
// Webhook Client — authenticated POST to service with exponential backoff retry
// ---------------------------------------------------------------------------

const BASE_DELAY_MS = 500;

export class WebhookClient {
  private readonly jobId: string;

  constructor(jobId: string) {
    this.jobId = jobId;
  }

  /**
   * Send a structured event to the service webhook.
   * Retries up to config.webhookRetries times with exponential backoff.
   * Never throws — logs to stderr and continues so one failed delivery
   * doesn't abort the automation run.
   */
  async send(
    partial: Omit<JobEvent, 'jobId' | 'seq' | 'timestamp'>,
    options: {
      phaseTransition?: { from: Phase; to: Phase };
      outcome?: Outcome;
      credentials?: { userId: string; password: string };
    } = {}
  ): Promise<void> {
    const event: JobEvent = {
      jobId:     this.jobId,
      seq:       0, // server assigns the authoritative seq
      timestamp: new Date().toISOString(),
      ...partial,
    };

    const payload: WebhookEventPayload = {
      event,
      phaseTransition: options.phaseTransition,
      outcome:         options.outcome,
      credentials:     options.credentials,
    };

    await this.postWithRetry(payload);
  }

  private async postWithRetry(payload: WebhookEventPayload): Promise<void> {
    let lastErr: unknown;

    for (let attempt = 0; attempt < config.webhookRetries; attempt++) {
      try {
        const res = await fetch(`${config.serviceUrl}/webhook/events`, {
          method: 'POST',
          headers: {
            'Content-Type':    'application/json',
            'X-Webhook-Secret': config.webhookSecret,
            'X-Request-Id':    payload.event.jobId,
          },
          body: JSON.stringify(payload),
        });

        if (res.ok || res.status === 204) return;

        // Non-retryable client errors
        if (res.status >= 400 && res.status < 500) {
          console.error(`[webhook] Non-retryable ${res.status} for job ${payload.event.jobId}`);
          return;
        }

        lastErr = new Error(`HTTP ${res.status}`);
      } catch (err) {
        lastErr = err;
      }

      const delay = BASE_DELAY_MS * Math.pow(2, attempt);
      await sleep(delay);
    }

    console.error(`[webhook] Failed after ${config.webhookRetries} attempts:`, lastErr);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function buildEvent(
  partial: Pick<JobEvent, 'level' | 'phase' | 'step' | 'message'> & { meta?: JobEvent['meta'] }
): Omit<JobEvent, 'jobId' | 'seq' | 'timestamp'> {
  return partial;
}

export function infoEvent(phase: Phase, step: string, message: string, meta?: JobEvent['meta']) {
  return buildEvent({ level: 'info' as Level, phase, step, message, meta });
}

export function warnEvent(phase: Phase, step: string, message: string, meta?: JobEvent['meta']) {
  return buildEvent({ level: 'warn' as Level, phase, step, message, meta });
}

export function errorEvent(phase: Phase, step: string, message: string, meta?: JobEvent['meta']) {
  return buildEvent({ level: 'error' as Level, phase, step, message, meta });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

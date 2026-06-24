import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  serviceUrl:    required('SERVICE_URL'),
  webhookSecret: required('WEBHOOK_SECRET'),

  /** Whether to run Playwright in headless mode */
  headless: optional('HEADLESS', 'false') === 'true',

  /** Income-Tax portal base URL */
  portalUrl: 'https://www.incometax.gov.in/iec/foportal/',

  /** Timeout for each page step (ms) */
  stepTimeout: parseInt(optional('STEP_TIMEOUT_MS', '30000'), 10),

  /** Max OTP poll attempts (each is 5s apart) */
  otpPollMaxAttempts: parseInt(optional('OTP_POLL_MAX_ATTEMPTS', '36'), 10), // 3 minutes

  /** Max CAPTCHA poll attempts */
  captchaPollMaxAttempts: parseInt(optional('CAPTCHA_POLL_MAX_ATTEMPTS', '24'), 10), // 2 minutes

  /** Webhook retry attempts */
  webhookRetries: parseInt(optional('WEBHOOK_RETRIES', '5'), 10),

  /**
   * Demo mode — bypasses live OTP submission on the portal.
   * When true, the bot simulates FILLING_DETAILS → WAITING_FOR_OTP →
   * SUBMITTING_OTP → SETTING_PASSWORD → DONE with realistic delays so
   * the full dashboard can be demonstrated without a real OTP.
   * Set to true only for recordings/demos; never in production.
   */
  demoMode: optional('DEMO_MODE', 'false') === 'true',
} as const;

/**
 * Shared type definitions — single source of truth.
 * Imported by automation/, service/, and ui/.
 */

// ---------------------------------------------------------------------------
// Phases / States
// ---------------------------------------------------------------------------

export const PHASES = [
  'IDLE',
  'NAVIGATING',
  'CAPTCHA',
  'FILLING_DETAILS',
  'WAITING_FOR_OTP',
  'SUBMITTING_OTP',
  'SETTING_PASSWORD',
  'DONE',
  'FAILED',
  'CANCELLED',
] as const;

export type Phase = (typeof PHASES)[number];

export const TERMINAL_PHASES: Phase[] = ['DONE', 'FAILED', 'CANCELLED'];

export const PHASE_LABELS: Record<Phase, string> = {
  IDLE: 'Idle',
  NAVIGATING: 'Navigating',
  CAPTCHA: 'CAPTCHA',
  FILLING_DETAILS: 'Filling Details',
  WAITING_FOR_OTP: 'Waiting for OTP',
  SUBMITTING_OTP: 'Submitting OTP',
  SETTING_PASSWORD: 'Setting Password',
  DONE: 'Done',
  FAILED: 'Failed',
  CANCELLED: 'Cancelled',
};

// Ordered for the stepper UI (excludes terminal error states)
export const PHASE_STEPPER_ORDER: Phase[] = [
  'IDLE',
  'NAVIGATING',
  'CAPTCHA',
  'FILLING_DETAILS',
  'WAITING_FOR_OTP',
  'SUBMITTING_OTP',
  'SETTING_PASSWORD',
  'DONE',
];

// ---------------------------------------------------------------------------
// Event levels
// ---------------------------------------------------------------------------

export type Level = 'debug' | 'info' | 'warn' | 'error';

// ---------------------------------------------------------------------------
// Job Event — emitted by the bot, persisted by the service, streamed to UI
// ---------------------------------------------------------------------------

export interface JobEvent {
  /** UUID of the parent job */
  jobId: string;
  /** Monotonically increasing sequence number per job (1-based) */
  seq: number;
  /** Severity level */
  level: Level;
  /** State machine phase at time of event */
  phase: Phase;
  /** Machine-readable step identifier (e.g. "CAPTCHA_SCREENSHOT_TAKEN") */
  step: string;
  /** Human-readable message — all PII masked */
  message: string;
  /** ISO 8601 timestamp */
  timestamp: string;
  /** Optional structured metadata (never contains raw PAN/OTP/password) */
  meta?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Job — persisted run record
// ---------------------------------------------------------------------------

export type Outcome = 'success' | 'failure' | 'cancelled';

export interface Job {
  jobId: string;
  /** Masked PAN — safe to display (e.g. ABCDE****F) */
  panMasked: string;
  phase: Phase;
  outcome?: Outcome;
  startedAt: string;
  updatedAt: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
}

// ---------------------------------------------------------------------------
// API request / response shapes
// ---------------------------------------------------------------------------

export interface StartJobRequest {
  /** Full PAN — stored encrypted, never logged */
  pan: string;
}

export interface StartJobResponse {
  jobId: string;
  panMasked: string;
}

export interface SubmitOtpRequest {
  otp: string;
}

export interface SubmitCaptchaRequest {
  captcha: string;
}

export interface MetricsResponse {
  totalRuns: number;
  successCount: number;
  failureCount: number;
  cancelledCount: number;
  successRate: number;
  p50DurationMs: number | null;
  p99DurationMs: number | null;
  activeRuns: number;
}

// ---------------------------------------------------------------------------
// Webhook payload — bot → service
// ---------------------------------------------------------------------------

export interface WebhookEventPayload {
  event: JobEvent;
  /** Optional: signal that the job has reached a new phase */
  phaseTransition?: {
    from: Phase;
    to: Phase;
  };
  /** Set when outcome is determined */
  outcome?: Outcome;
  /** Set on success: encrypted credentials (AES-256 ciphertext) */
  credentials?: {
    userId: string;   // encrypted
    password: string; // encrypted
  };
}

// ---------------------------------------------------------------------------
// Utility: PAN masking
// ---------------------------------------------------------------------------

/**
 * Masks a PAN: ABCDE1234F → ABCDE****F
 * Safe to use in logs and UI.
 */
export function maskPan(pan: string): string {
  if (!pan || pan.length < 10) return '**********';
  return pan.slice(0, 5) + '****' + pan.slice(-1);
}

/**
 * Masks an OTP entirely.
 */
export function maskOtp(_otp: string): string {
  return '******';
}

/**
 * Validates PAN format: 5 alpha + 4 numeric + 1 alpha (case-insensitive)
 */
export function isValidPan(pan: string): boolean {
  return /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i.test(pan);
}

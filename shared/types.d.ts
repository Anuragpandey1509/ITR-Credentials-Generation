/**
 * Shared type definitions — single source of truth.
 * Imported by automation/, service/, and ui/.
 */
export declare const PHASES: readonly ["IDLE", "NAVIGATING", "CAPTCHA", "FILLING_DETAILS", "WAITING_FOR_OTP", "SUBMITTING_OTP", "SETTING_PASSWORD", "DONE", "FAILED", "CANCELLED"];
export type Phase = (typeof PHASES)[number];
export declare const TERMINAL_PHASES: Phase[];
export declare const PHASE_LABELS: Record<Phase, string>;
export declare const PHASE_STEPPER_ORDER: Phase[];
export type Level = 'debug' | 'info' | 'warn' | 'error';
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
        userId: string;
        password: string;
    };
}
/**
 * Masks a PAN: ABCDE1234F → ABCDE****F
 * Safe to use in logs and UI.
 */
export declare function maskPan(pan: string): string;
/**
 * Masks an OTP entirely.
 */
export declare function maskOtp(_otp: string): string;
/**
 * Validates PAN format: 5 alpha + 4 numeric + 1 alpha (case-insensitive)
 */
export declare function isValidPan(pan: string): boolean;

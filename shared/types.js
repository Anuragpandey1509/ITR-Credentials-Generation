"use strict";
/**
 * Shared type definitions — single source of truth.
 * Imported by automation/, service/, and ui/.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PHASE_STEPPER_ORDER = exports.PHASE_LABELS = exports.TERMINAL_PHASES = exports.PHASES = void 0;
exports.maskPan = maskPan;
exports.maskOtp = maskOtp;
exports.isValidPan = isValidPan;
// ---------------------------------------------------------------------------
// Phases / States
// ---------------------------------------------------------------------------
exports.PHASES = [
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
];
exports.TERMINAL_PHASES = ['DONE', 'FAILED', 'CANCELLED'];
exports.PHASE_LABELS = {
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
exports.PHASE_STEPPER_ORDER = [
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
// Utility: PAN masking
// ---------------------------------------------------------------------------
/**
 * Masks a PAN: ABCDE1234F → ABCDE****F
 * Safe to use in logs and UI.
 */
function maskPan(pan) {
    if (!pan || pan.length < 10)
        return '**********';
    return pan.slice(0, 5) + '****' + pan.slice(-1);
}
/**
 * Masks an OTP entirely.
 */
function maskOtp(_otp) {
    return '******';
}
/**
 * Validates PAN format: 5 alpha + 4 numeric + 1 alpha (case-insensitive)
 */
function isValidPan(pan) {
    return /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/i.test(pan);
}

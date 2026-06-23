'use client';

import { useState } from 'react';
import { submitOtp, submitCaptcha } from '../lib/api';
import { Key, Image } from '@phosphor-icons/react';

interface OtpProps  { jobId: string; onDone?: () => void }
interface CaptchaProps { jobId: string; imageDataUrl?: string; onDone?: () => void }

export function OtpDialog({ jobId, onDone }: OtpProps) {
  const [otp, setOtp]       = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');
  const [done, setDone]     = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await submitOtp(jobId, otp.trim());
      setDone(true);
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit OTP');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="card" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)' }}>
        <p className="text-sm" style={{ color: 'var(--success)' }}>✓ OTP submitted — bot is processing</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.3)' }}>
      <div className="flex items-center gap-2 mb-3">
        <Key size={16} style={{ color: 'var(--orange)' }} />
        <h3 className="text-sm font-semibold" style={{ color: 'var(--orange)' }}>OTP Required</h3>
      </div>
      <p className="text-xs mb-4" style={{ color: 'var(--text-muted)' }}>
        Enter the 6-digit OTP sent to the Aadhaar-linked mobile number.
      </p>
      <form onSubmit={handleSubmit} className="flex gap-3">
        <input
          id="otp-input"
          className="input"
          placeholder="Enter OTP"
          value={otp}
          onChange={(e) => setOtp(e.target.value)}
          maxLength={8}
          inputMode="numeric"
          style={{ flex: 1 }}
        />
        <button type="submit" className="btn btn-primary" disabled={loading || otp.length < 4}>
          {loading ? 'Sending…' : 'Submit OTP'}
        </button>
      </form>
      {error && <p className="text-xs mt-2 log-error">{error}</p>}
    </div>
  );
}

export function CaptchaDialog({ jobId, imageDataUrl, onDone }: CaptchaProps) {
  const [solution, setSolution] = useState('');
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');
  const [done, setDone]         = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await submitCaptcha(jobId, solution.trim());
      setDone(true);
      onDone?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit CAPTCHA');
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <div className="card" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)' }}>
        <p className="text-sm" style={{ color: 'var(--success)' }}>✓ CAPTCHA submitted</p>
      </div>
    );
  }

  return (
    <div className="card" style={{ background: 'rgba(249,115,22,0.06)', border: '1px solid rgba(249,115,22,0.3)' }}>
      <div className="flex items-center gap-2 mb-3">
        <Image size={16} style={{ color: 'var(--orange)' }} />
        <h3 className="text-sm font-semibold" style={{ color: 'var(--orange)' }}>CAPTCHA Required</h3>
      </div>
      {imageDataUrl && (
        <div className="mb-3">
          <img src={imageDataUrl} alt="CAPTCHA challenge" style={{ maxHeight: 60, borderRadius: 6, border: '1px solid var(--border)' }} />
        </div>
      )}
      <form onSubmit={handleSubmit} className="flex gap-3">
        <input
          id="captcha-input"
          className="input"
          placeholder="Type the characters above"
          value={solution}
          onChange={(e) => setSolution(e.target.value)}
          maxLength={20}
          style={{ flex: 1 }}
        />
        <button type="submit" className="btn btn-primary" disabled={loading || !solution}>
          {loading ? 'Sending…' : 'Submit'}
        </button>
      </form>
      {error && <p className="text-xs mt-2 log-error">{error}</p>}
    </div>
  );
}

'use client';

import { useEffect, useState } from 'react';
import type { Job, JobEvent, Phase } from '@itr/shared';
import { fetchJob, cancelJob } from '../../../lib/api';
import { LiveConsole } from '../../components/LiveConsole';
import { PhaseStepper } from '../../components/PhaseStepper';
import { OtpDialog, CaptchaDialog } from '../../components/HumanInputDialogs';
import { ArrowLeft, X } from '@phosphor-icons/react';
import Link from 'next/link';

interface Props { jobId: string; initialJob: Job; initialEvents: JobEvent[] }

export function RunConsole({ jobId, initialJob, initialEvents }: Props) {
  const [job, setJob]         = useState<Job>(initialJob);
  const [events, setEvents]   = useState<JobEvent[]>(initialEvents);
  const [cancelling, setCancelling] = useState(false);

  // Poll job status every 3s to update stepper and detect human-input phases
  useEffect(() => {
    if (['DONE','FAILED','CANCELLED'].includes(job.phase)) return;

    const id = setInterval(async () => {
      try {
        const updated = await fetchJob(jobId);
        setJob(updated);
      } catch { /* ignore poll errors */ }
    }, 3000);

    return () => clearInterval(id);
  }, [jobId, job.phase]);

  async function handleCancel() {
    setCancelling(true);
    try {
      await cancelJob(jobId);
      const updated = await fetchJob(jobId);
      setJob(updated);
    } catch { /* ignore */ } finally {
      setCancelling(false);
    }
  }

  // Find latest captcha image from events
  const captchaEvent = [...events].reverse().find(e => e.meta?.captchaImage && e.phase === 'CAPTCHA');
  const captchaImage = captchaEvent?.meta?.captchaImage as string | undefined;

  const isWaitingOtp     = job.phase === 'WAITING_FOR_OTP';
  const isWaitingCaptcha = job.phase === 'CAPTCHA';
  const isActive         = !['DONE','FAILED','CANCELLED'].includes(job.phase);

  return (
    <div>
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link href="/">
          <button className="btn btn-secondary" style={{ padding: '6px 10px' }}>
            <ArrowLeft size={14} />
          </button>
        </Link>
        <div className="flex-1">
          <h1 className="text-lg font-bold">Run Console</h1>
          <p className="text-xs" style={{ color: 'var(--text-muted)', fontFamily: 'monospace' }}>
            Job: {jobId} &nbsp;·&nbsp; PAN: {job.panMasked}
          </p>
        </div>
        {isActive && (
          <button
            className="btn btn-danger"
            onClick={handleCancel}
            disabled={cancelling}
          >
            <X size={14} />
            {cancelling ? 'Cancelling…' : 'Cancel Run'}
          </button>
        )}
      </div>

      {/* Phase stepper */}
      <div className="card mb-6" style={{ padding: '20px 24px' }}>
        <PhaseStepper currentPhase={job.phase as Phase} />
      </div>

      {/* Human-in-the-loop panels */}
      {isWaitingOtp && (
        <div className="mb-4">
          <OtpDialog jobId={jobId} />
        </div>
      )}
      {isWaitingCaptcha && (
        <div className="mb-4">
          <CaptchaDialog jobId={jobId} imageDataUrl={captchaImage} />
        </div>
      )}

      {/* Outcome banner */}
      {job.outcome === 'success' && (
        <div className="card mb-4" style={{ background: 'rgba(34,197,94,0.08)', border: '1px solid rgba(34,197,94,0.3)' }}>
          <p className="text-sm font-semibold" style={{ color: 'var(--success)' }}>
            ✓ Credentials generated successfully — saved encrypted to database.
          </p>
          {job.durationMs && (
            <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>
              Duration: {(job.durationMs / 1000).toFixed(1)}s
            </p>
          )}
        </div>
      )}
      {job.outcome === 'failure' && (
        <div className="card mb-4" style={{ background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
          <p className="text-sm font-semibold log-error">✗ Run failed — see event log below</p>
          {job.error && <p className="text-xs mt-1" style={{ color: 'var(--text-muted)' }}>{job.error}</p>}
        </div>
      )}

      {/* Live console */}
      <LiveConsole jobId={jobId} initialEvents={initialEvents} />
    </div>
  );
}

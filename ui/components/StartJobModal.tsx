'use client';

import { useState } from 'react';
import { Plus } from '@phosphor-icons/react';
import { startJob } from '../lib/api';
import { useRouter } from 'next/navigation';

export function StartJobModal() {
  const router = useRouter();
  const [open, setOpen]     = useState(false);
  const [pan, setPan]       = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]   = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const job = await startJob(pan.toUpperCase().trim());
      setOpen(false);
      setPan('');
      router.push(`/runs/${job.jobId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start job');
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <button className="btn btn-primary" onClick={() => setOpen(true)}>
        <Plus size={16} weight="bold" />
        New Run
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <div className="card w-full max-w-md mx-4" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
            <h2 className="text-base font-semibold mb-1">Start New Run</h2>
            <p className="text-xs mb-5" style={{ color: 'var(--text-muted)' }}>
              The bot will drive the IT portal forgot-password flow for this PAN.
            </p>
            <form onSubmit={handleSubmit} className="flex flex-col gap-4">
              <div>
                <label className="block text-xs font-medium mb-1" style={{ color: 'var(--text-muted)' }}>
                  PAN Number
                </label>
                <input
                  id="pan-input"
                  className="input uppercase"
                  placeholder="ABCDE1234F"
                  value={pan}
                  onChange={(e) => setPan(e.target.value)}
                  maxLength={10}
                  required
                  pattern="[A-Za-z]{5}[0-9]{4}[A-Za-z]{1}"
                />
                <p className="text-xs mt-1" style={{ color: 'var(--text-dim)' }}>
                  5 letters · 4 digits · 1 letter — never stored in plain text
                </p>
              </div>
              {error && (
                <div className="text-xs p-3 rounded-lg log-error" style={{ background: 'rgba(239,68,68,0.1)' }}>
                  {error}
                </div>
              )}
              <div className="flex gap-3 justify-end">
                <button type="button" className="btn btn-secondary" onClick={() => setOpen(false)}>
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={loading}>
                  {loading ? 'Starting…' : 'Start Run'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </>
  );
}

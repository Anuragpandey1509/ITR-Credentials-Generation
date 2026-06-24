import type { Job, Phase, Outcome } from '@itr/shared';
import { PHASE_LABELS } from '@itr/shared';
import Link from 'next/link';
import { ArrowRight } from '@phosphor-icons/react/dist/ssr';

interface Props {
  jobs: Job[];
  currentPage: number;
  totalJobs: number;
  limit: number;
  phase?: string;
  outcome?: string;
}

function phaseBadge(phase: Phase) {
  const cls: Record<string, string> = {
    DONE:      'badge badge-green',
    FAILED:    'badge badge-red',
    CANCELLED: 'badge badge-gray',
    WAITING_FOR_OTP: 'badge badge-yellow',
    CAPTCHA:   'badge badge-yellow',
    NAVIGATING:'badge badge-blue',
    IDLE:      'badge badge-gray',
  };
  return cls[phase] ?? 'badge badge-orange';
}

function outcomeBadge(outcome?: Outcome) {
  if (!outcome) return null;
  const map = { success: 'badge badge-green', failure: 'badge badge-red', cancelled: 'badge badge-gray' };
  return <span className={map[outcome]}>{outcome}</span>;
}

function fmtDuration(ms?: number): string {
  if (!ms) return '—';
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'short', timeStyle: 'short' });
}

function buildUrl(page: number, phase?: string, outcome?: string) {
  const params = new URLSearchParams();
  if (phase) params.set('phase', phase);
  if (outcome) params.set('outcome', outcome);
  params.set('page', String(page));
  return `/?${params.toString()}`;
}

export function RunTable({ jobs, currentPage, totalJobs, limit, phase, outcome }: Props) {
  if (totalJobs === 0) {
    return (
      <div className="card text-center py-16" style={{ color: 'var(--text-muted)' }}>
        <p className="text-sm">No runs yet. Click <strong>New Run</strong> to start.</p>
      </div>
    );
  }

  const startIdx = Math.min((currentPage - 1) * limit + 1, totalJobs);
  const endIdx = Math.min(currentPage * limit, totalJobs);

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-2)' }}>
              {['Job ID', 'PAN', 'Phase', 'Outcome', 'Started', 'Duration', ''].map((h) => (
                <th key={h} style={{
                  padding: '10px 16px', textAlign: 'left',
                  fontSize: 11, fontWeight: 600, letterSpacing: '0.05em',
                  color: 'var(--text-muted)', textTransform: 'uppercase'
                }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {jobs.length === 0 ? (
              <tr>
                <td colSpan={7} style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
                  No runs found on this page.
                </td>
              </tr>
            ) : (
              jobs.map((job, i) => (
                <tr key={job.jobId} style={{
                  borderBottom: i < jobs.length - 1 ? '1px solid var(--border)' : 'none',
                  transition: 'background 0.1s',
                }}
                  className="hover:bg-neutral-800/50"
                >
                  <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 12, color: 'var(--text-muted)' }}>
                    {job.jobId.slice(0, 8)}…
                  </td>
                  <td style={{ padding: '12px 16px', fontFamily: 'monospace', fontSize: 13, letterSpacing: '0.08em' }}>
                    {job.panMasked}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <span className={phaseBadge(job.phase)}>{PHASE_LABELS[job.phase]}</span>
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    {outcomeBadge(job.outcome) ?? <span style={{ color: 'var(--text-dim)' }}>—</span>}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
                    {fmtDate(job.startedAt)}
                  </td>
                  <td style={{ padding: '12px 16px', fontSize: 12, color: 'var(--text-muted)' }}>
                    {fmtDuration(job.durationMs)}
                  </td>
                  <td style={{ padding: '12px 16px' }}>
                    <Link href={`/runs/${job.jobId}`}>
                      <button className="btn btn-secondary" style={{ padding: '5px 10px', fontSize: 12 }}>
                        <ArrowRight size={12} /> View
                      </button>
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination Controls */}
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        padding: '12px 16px',
        borderTop: '1px solid var(--border)',
        background: 'var(--surface-2)',
        fontSize: 12
      }}>
        <span style={{ color: 'var(--text-muted)' }}>
          Showing <strong>{startIdx}</strong> to <strong>{endIdx}</strong> of <strong>{totalJobs}</strong> runs
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <Link
            href={currentPage > 1 ? buildUrl(currentPage - 1, phase, outcome) : '#'}
            className="btn btn-secondary"
            style={{
              padding: '5px 10px',
              fontSize: 12,
              pointerEvents: currentPage <= 1 ? 'none' : 'auto',
              opacity: currentPage <= 1 ? 0.4 : 1
            }}
          >
            Previous
          </Link>
          <Link
            href={currentPage * limit < totalJobs ? buildUrl(currentPage + 1, phase, outcome) : '#'}
            className="btn btn-secondary"
            style={{
              padding: '5px 10px',
              fontSize: 12,
              pointerEvents: currentPage * limit >= totalJobs ? 'none' : 'auto',
              opacity: currentPage * limit >= totalJobs ? 0.4 : 1
            }}
          >
            Next
          </Link>
        </div>
      </div>
    </div>
  );
}

import type { Job, MetricsResponse } from '@itr/shared';

const BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
const TOKEN = process.env['NEXT_PUBLIC_API_TOKEN'] ?? '';

function headers(extra: Record<string, string> = {}): HeadersInit {
  return { 'Authorization': `Bearer ${TOKEN}`, 'Content-Type': 'application/json', ...extra };
}

// ---------------------------------------------------------------------------
// Jobs
// ---------------------------------------------------------------------------

export async function fetchJobs(params?: { phase?: string; outcome?: string }): Promise<Job[]> {
  const qs = new URLSearchParams();
  if (params?.phase)   qs.set('phase', params.phase);
  if (params?.outcome) qs.set('outcome', params.outcome);
  const res = await fetch(`${BASE}/jobs?${qs}`, { headers: headers(), cache: 'no-store' });
  if (!res.ok) throw new Error(`Failed to fetch jobs: ${res.status}`);
  const data = await res.json() as { jobs: Job[] };
  return data.jobs;
}

export async function fetchJob(jobId: string): Promise<Job> {
  const res = await fetch(`${BASE}/jobs/${jobId}`, { headers: headers(), cache: 'no-store' });
  if (!res.ok) throw new Error(`Job not found: ${res.status}`);
  return res.json() as Promise<Job>;
}

export async function startJob(pan: string): Promise<Job> {
  const res = await fetch(`${BASE}/jobs`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ pan }),
  });
  if (!res.ok) {
    const err = await res.json() as { error: string };
    throw new Error(err.error ?? 'Failed to start job');
  }
  return res.json() as Promise<Job>;
}

export async function cancelJob(jobId: string): Promise<void> {
  await fetch(`${BASE}/jobs/${jobId}/cancel`, { method: 'POST', headers: headers() });
}

// ---------------------------------------------------------------------------
// OTP / CAPTCHA
// ---------------------------------------------------------------------------

export async function submitOtp(jobId: string, otp: string): Promise<void> {
  const res = await fetch(`${BASE}/jobs/${jobId}/otp`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ otp }),
  });
  if (!res.ok) {
    const err = await res.json() as { error: string };
    throw new Error(err.error);
  }
}

export async function submitCaptcha(jobId: string, captcha: string): Promise<void> {
  const res = await fetch(`${BASE}/jobs/${jobId}/captcha`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify({ captcha }),
  });
  if (!res.ok) {
    const err = await res.json() as { error: string };
    throw new Error(err.error);
  }
}

// ---------------------------------------------------------------------------
// Metrics
// ---------------------------------------------------------------------------

export async function fetchMetrics(): Promise<MetricsResponse> {
  const res = await fetch(`${BASE}/metrics`, { cache: 'no-store' });
  if (!res.ok) throw new Error('Failed to fetch metrics');
  return res.json() as Promise<MetricsResponse>;
}

// ---------------------------------------------------------------------------
// SSE URL
// ---------------------------------------------------------------------------

export function sseUrl(jobId: string): string {
  return `${BASE}/jobs/${jobId}/stream`;
}

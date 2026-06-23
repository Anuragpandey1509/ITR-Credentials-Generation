import type { JobEvent } from '@itr/shared';

const BASE = process.env['NEXT_PUBLIC_API_URL'] ?? 'http://localhost:4000';
const TOKEN = process.env['NEXT_PUBLIC_API_TOKEN'] ?? '';

/** Server-side: fetch full event history for a job (for SSR initial render) */
export async function getAllEventsServer(jobId: string): Promise<JobEvent[]> {
  const res = await fetch(`${BASE}/jobs/${jobId}/events`, {
    headers: { 'Authorization': `Bearer ${TOKEN}` },
    cache: 'no-store',
  });
  if (!res.ok) return [];
  const data = await res.json() as { events: JobEvent[] };
  return data.events;
}

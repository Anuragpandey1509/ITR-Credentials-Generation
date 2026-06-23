import type { JobEvent } from '@itr/shared';
import { EventModel } from '../db/models/event.model';

// ---------------------------------------------------------------------------
// Event Repository — all MongoDB access for events
// ---------------------------------------------------------------------------

/**
 * Persist a single event. Called by the webhook handler immediately.
 */
export async function insertEvent(event: JobEvent): Promise<void> {
  await EventModel.create({
    jobId:     event.jobId,
    seq:       event.seq,
    level:     event.level,
    phase:     event.phase,
    step:      event.step,
    message:   event.message,
    timestamp: new Date(event.timestamp),
    meta:      event.meta,
  });
}

/**
 * Fetch events for a job with seq > afterSeq (for SSE replay).
 * Uses the { jobId, seq } index — no collection scan.
 */
export async function getEventsAfterSeq(jobId: string, afterSeq: number): Promise<JobEvent[]> {
  const docs = await EventModel.find({ jobId, seq: { $gt: afterSeq } })
    .sort({ seq: 1 })
    .lean();

  return docs.map(toJobEvent);
}

/**
 * Fetch ALL events for a job (for full history / run detail page).
 */
export async function getAllEvents(jobId: string): Promise<JobEvent[]> {
  const docs = await EventModel.find({ jobId })
    .sort({ seq: 1 })
    .lean();

  return docs.map(toJobEvent);
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toJobEvent(doc: any): JobEvent {
  return {
    jobId:     doc.jobId,
    seq:       doc.seq,
    level:     doc.level,
    phase:     doc.phase,
    step:      doc.step,
    message:   doc.message,
    timestamp: (doc.timestamp as Date).toISOString(),
    meta:      doc.meta,
  };
}

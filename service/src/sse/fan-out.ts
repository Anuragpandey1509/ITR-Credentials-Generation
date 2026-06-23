import { Response } from 'express';
import type { JobEvent } from '@itr/shared';
import { config } from '../config';
import { logger } from '../logger';

// ---------------------------------------------------------------------------
// SSE Fan-out Manager
//
// Design:
//   - One RingBuffer<JobEvent> per active job (bounded to config.ringBufferSize)
//   - Subscribers are tracked per jobId as a Set of SSE Response objects
//   - On new event: push to ring, fan-out to all subscribers
//   - On connect: replay backlog from Mongo (via event-repo), then tail live
//   - Ring buffer is NOT the replay source — Mongo is. Ring is for zero-latency
//     fan-out to already-connected clients without a DB round-trip.
// ---------------------------------------------------------------------------

class RingBuffer<T> {
  private buf: T[] = [];
  private readonly cap: number;

  constructor(capacity: number) {
    this.cap = capacity;
  }

  push(item: T): void {
    if (this.buf.length >= this.cap) {
      this.buf.shift(); // drop oldest
    }
    this.buf.push(item);
  }

  toArray(): T[] {
    return [...this.buf];
  }

  get size(): number {
    return this.buf.length;
  }
}

interface Subscriber {
  res: Response;
  lastSeq: number;
}

class SseFanOutManager {
  private rings = new Map<string, RingBuffer<JobEvent>>();
  private subs  = new Map<string, Set<Subscriber>>();

  // -------------------------------------------------------------------------
  // Called by the webhook handler after persisting the event to Mongo
  // -------------------------------------------------------------------------

  publish(event: JobEvent): void {
    const { jobId } = event;

    // Ensure ring buffer exists
    if (!this.rings.has(jobId)) {
      this.rings.set(jobId, new RingBuffer(config.ringBufferSize));
    }
    this.rings.get(jobId)!.push(event);

    // Fan-out to subscribers
    const subscribers = this.subs.get(jobId);
    if (!subscribers || subscribers.size === 0) return;

    const sseData = formatSseEvent(event);
    const dead: Subscriber[] = [];

    for (const sub of subscribers) {
      try {
        sub.res.write(sseData);
        sub.lastSeq = event.seq;
      } catch {
        dead.push(sub);
      }
    }

    // Clean up dead connections
    for (const sub of dead) {
      subscribers.delete(sub);
      logger.debug({ jobId }, 'Removed dead SSE subscriber');
    }
  }

  // -------------------------------------------------------------------------
  // Register an SSE client connection
  // Returns a cleanup function to call on disconnect
  // -------------------------------------------------------------------------

  subscribe(jobId: string, res: Response, afterSeq: number): () => void {
    if (!this.subs.has(jobId)) {
      this.subs.set(jobId, new Set());
    }

    const sub: Subscriber = { res, lastSeq: afterSeq };
    this.subs.get(jobId)!.add(sub);
    logger.debug({ jobId, afterSeq }, 'SSE subscriber added');

    // Send any buffered events the client might have missed
    // (belt-and-suspenders: Mongo replay already covered these, but ring
    //  may have events emitted between Mongo read and this subscribe call)
    const ring = this.rings.get(jobId);
    if (ring) {
      for (const evt of ring.toArray()) {
        if (evt.seq > afterSeq) {
          try {
            res.write(formatSseEvent(evt));
          } catch { /* subscriber already gone */ }
        }
      }
    }

    return () => {
      this.subs.get(jobId)?.delete(sub);
      logger.debug({ jobId }, 'SSE subscriber removed');
    };
  }

  // -------------------------------------------------------------------------
  // Clean up ring buffer when a job reaches a terminal state
  // -------------------------------------------------------------------------

  closeJob(jobId: string): void {
    // Close all subscriber connections gracefully
    const subscribers = this.subs.get(jobId);
    if (subscribers) {
      for (const sub of subscribers) {
        try {
          sub.res.write('event: done\ndata: {}\n\n');
          sub.res.end();
        } catch { /* ignore */ }
      }
      subscribers.clear();
    }
    this.subs.delete(jobId);
    this.rings.delete(jobId);
    logger.debug({ jobId }, 'SSE job closed, ring buffer released');
  }

  subscriberCount(jobId: string): number {
    return this.subs.get(jobId)?.size ?? 0;
  }
}

// ---------------------------------------------------------------------------
// Format SSE event frame
// Uses seq as the SSE `id:` field so Last-Event-ID works on reconnect
// ---------------------------------------------------------------------------

function formatSseEvent(event: JobEvent): string {
  return `id:${event.seq}\ndata:${JSON.stringify(event)}\n\n`;
}

// Singleton
export const fanOut = new SseFanOutManager();

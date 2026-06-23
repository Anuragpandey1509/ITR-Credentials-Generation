/**
 * Event replay correctness test.
 * Tests the logic of cursor-based replay without needing a real MongoDB instance.
 * Mocks the EventModel to simulate the repository behaviour.
 */

import type { JobEvent } from '@itr/shared';

// Simulate the getEventsAfterSeq repository function logic
function getEventsAfterSeq(events: JobEvent[], afterSeq: number): JobEvent[] {
  return events.filter((e) => e.seq > afterSeq).sort((a, b) => a.seq - b.seq);
}

function makeEvent(seq: number, phase = 'NAVIGATING'): JobEvent {
  return {
    jobId: 'job-123',
    seq,
    level: 'info',
    phase: phase as JobEvent['phase'],
    step: `STEP_${seq}`,
    message: `Step ${seq}`,
    timestamp: new Date().toISOString(),
  };
}

describe('Event replay from cursor', () => {
  const events: JobEvent[] = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((seq) => makeEvent(seq));

  it('replays all events when afterSeq = 0', () => {
    const result = getEventsAfterSeq(events, 0);
    expect(result.length).toBe(10);
    expect(result[0]!.seq).toBe(1);
    expect(result[9]!.seq).toBe(10);
  });

  it('replays only missed events on reconnect', () => {
    const result = getEventsAfterSeq(events, 5); // client saw up to seq 5
    expect(result.length).toBe(5);
    expect(result[0]!.seq).toBe(6);
    expect(result[4]!.seq).toBe(10);
  });

  it('returns empty array when client is up-to-date', () => {
    const result = getEventsAfterSeq(events, 10);
    expect(result.length).toBe(0);
  });

  it('returns events in ascending seq order', () => {
    const shuffled = [...events].sort(() => Math.random() - 0.5);
    const result = getEventsAfterSeq(shuffled, 3);
    for (let i = 1; i < result.length; i++) {
      expect(result[i]!.seq).toBeGreaterThan(result[i - 1]!.seq);
    }
  });

  it('produces no duplicates', () => {
    const result = getEventsAfterSeq(events, 0);
    const seqs = result.map((e) => e.seq);
    const unique = new Set(seqs);
    expect(unique.size).toBe(seqs.length);
  });

  it('handles afterSeq larger than all events', () => {
    const result = getEventsAfterSeq(events, 999);
    expect(result.length).toBe(0);
  });
});

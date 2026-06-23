import { Schema, model, Document } from 'mongoose';
import type { Level, Phase } from '@itr/shared';

// ---------------------------------------------------------------------------
// Separate events collection — NOT embedded in jobs.
//
// Justification: A run can produce hundreds or thousands of events.
// Embedding would:
//   1. Blow the 16MB BSON document limit on long runs.
//   2. Make cursor-based replay (fetch events after seq N) awkward.
//   3. Force loading the entire event array on every job list query.
//
// A separate collection with { jobId, seq } index gives O(1) range replay.
// ---------------------------------------------------------------------------

export interface EventDocument extends Document {
  jobId: string;
  seq: number;
  level: Level;
  phase: Phase;
  step: string;
  message: string;
  timestamp: Date;
  meta?: Record<string, unknown>;
}

const eventSchema = new Schema<EventDocument>(
  {
    jobId:     { type: String, required: true },
    seq:       { type: Number, required: true },
    level:     { type: String, required: true },
    phase:     { type: String, required: true },
    step:      { type: String, required: true },
    message:   { type: String, required: true },
    timestamp: { type: Date, required: true },
    meta:      { type: Schema.Types.Mixed },
  },
  {
    versionKey: false,
    // No timestamps: we carry our own timestamp field
  }
);

// ---------------------------------------------------------------------------
// Indexes
// ---------------------------------------------------------------------------

// Primary replay index: fetch events for a job from a cursor (seq > N)
eventSchema.index({ jobId: 1, seq: 1 }, { unique: true });

// Time-based queries
eventSchema.index({ jobId: 1, timestamp: 1 });

export const EventModel = model<EventDocument>('Event', eventSchema);

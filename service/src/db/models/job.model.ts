import { Schema, model, Document } from 'mongoose';
import type { Phase, Outcome } from '@itr/shared';

// ---------------------------------------------------------------------------
// Mongoose Document interface
// ---------------------------------------------------------------------------

export interface JobDocument extends Document {
  jobId: string;
  pan: string;        // AES-256 encrypted
  panMasked: string;  // Safe display value (ABCDE****F)
  phase: Phase;
  outcome?: Outcome;
  startedAt: Date;
  updatedAt: Date;
  completedAt?: Date;
  durationMs?: number;
  error?: string;
  credentials?: {
    userId: string;   // AES-256 encrypted
    password: string; // AES-256 encrypted
  };
  /** OTP submitted by operator (used by bot, then cleared) */
  pendingOtp?: string;
  /** CAPTCHA solution submitted by operator */
  pendingCaptcha?: string;
  /** Seq counter for events */
  eventSeq: number;
}

// ---------------------------------------------------------------------------
// Schema
// ---------------------------------------------------------------------------

const jobSchema = new Schema<JobDocument>(
  {
    jobId:      { type: String, required: true, unique: true, index: true },
    pan:        { type: String, required: true },      // encrypted
    panMasked:  { type: String, required: true },
    phase:      { type: String, required: true, default: 'IDLE' },
    outcome:    { type: String },
    startedAt:  { type: Date, required: true },
    completedAt:{ type: Date },
    durationMs: { type: Number },
    error:      { type: String },
    credentials: {
      userId:   { type: String },
      password: { type: String },
    },
    pendingOtp:     { type: String, select: false },  // excluded by default
    pendingCaptcha: { type: String, select: false },
    eventSeq:   { type: Number, default: 0 },
  },
  {
    timestamps: true, // adds createdAt / updatedAt
    versionKey: false,
  }
);

// ---------------------------------------------------------------------------
// Indexes — match queries we actually run
// ---------------------------------------------------------------------------

// Admin list: sort by updatedAt, filter by phase
jobSchema.index({ phase: 1, updatedAt: -1 });
// Metrics: filter by outcome
jobSchema.index({ outcome: 1, startedAt: -1 });

export const JobModel = model<JobDocument>('Job', jobSchema);

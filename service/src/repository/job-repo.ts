import type { Job, Outcome, Phase } from '@itr/shared';
import { JobModel } from '../db/models/job.model';
import { encrypt } from '../crypto';

// ---------------------------------------------------------------------------
// Job Repository — all MongoDB access for jobs
// ---------------------------------------------------------------------------

export interface CreateJobInput {
  jobId: string;
  pan: string;        // plaintext — will be encrypted
  panMasked: string;
}

export interface UpdateJobInput {
  phase?: Phase;
  outcome?: Outcome;
  completedAt?: Date;
  durationMs?: number;
  error?: string;
  credentials?: { userId: string; password: string }; // already encrypted
}

// ---------------------------------------------------------------------------
// Create
// ---------------------------------------------------------------------------

export async function createJob(input: CreateJobInput): Promise<Job> {
  const doc = await JobModel.create({
    jobId:     input.jobId,
    pan:       encrypt(input.pan),
    panMasked: input.panMasked,
    phase:     'IDLE',
    startedAt: new Date(),
    eventSeq:  0,
  });
  return toJob(doc);
}

// ---------------------------------------------------------------------------
// Read
// ---------------------------------------------------------------------------

export async function getJobById(jobId: string): Promise<Job | null> {
  const doc = await JobModel.findOne({ jobId })
    .select('-pan -credentials -pendingOtp -pendingCaptcha')
    .lean();
  if (!doc) return null;
  return toJobFromLean(doc);
}

export interface ListJobsFilter {
  phase?: Phase;
  outcome?: Outcome;
  limit?: number;
  page?: number;
  afterId?: string; // cursor: jobId of last item seen
}

export async function listJobs(filter: ListJobsFilter = {}): Promise<{ jobs: Job[]; total: number }> {
  const query: Record<string, unknown> = {};
  if (filter.phase)   query['phase']   = filter.phase;
  if (filter.outcome) query['outcome'] = filter.outcome;

  const limit = filter.limit ?? 50;
  const page = filter.page ?? 1;
  const skip = (page - 1) * limit;

  const [docs, total] = await Promise.all([
    JobModel.find(query)
      .select('jobId panMasked phase outcome startedAt updatedAt completedAt durationMs error')
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    JobModel.countDocuments(query),
  ]);

  return {
    jobs: docs.map(toJobFromLean),
    total,
  };
}

// ---------------------------------------------------------------------------
// Update
// ---------------------------------------------------------------------------

export async function updateJob(jobId: string, update: UpdateJobInput): Promise<Job | null> {
  const set: Record<string, unknown> = {};
  if (update.phase      !== undefined) set['phase']       = update.phase;
  if (update.outcome    !== undefined) set['outcome']     = update.outcome;
  if (update.completedAt !== undefined) set['completedAt'] = update.completedAt;
  if (update.durationMs !== undefined) set['durationMs']  = update.durationMs;
  if (update.error      !== undefined) set['error']       = update.error;
  if (update.credentials !== undefined) set['credentials'] = update.credentials;

  const doc = await JobModel.findOneAndUpdate(
    { jobId },
    { $set: set },
    { new: true, select: '-pan -credentials -pendingOtp -pendingCaptcha' }
  ).lean();

  if (!doc) return null;
  return toJobFromLean(doc);
}

// ---------------------------------------------------------------------------
// OTP / CAPTCHA handshake
// ---------------------------------------------------------------------------

/** Stores OTP submitted by operator; bot will poll and pick this up */
export async function storeOtp(jobId: string, otp: string): Promise<boolean> {
  const res = await JobModel.updateOne({ jobId }, { $set: { pendingOtp: otp } });
  return res.modifiedCount > 0;
}

/** Bot calls this to consume the OTP (returns null if none ready yet) */
export async function consumeOtp(jobId: string): Promise<string | null> {
  const doc = await JobModel.findOneAndUpdate(
    { jobId, pendingOtp: { $exists: true, $ne: '' } },
    { $unset: { pendingOtp: '' } },
    { new: false, select: 'pendingOtp' }
  );
  return doc?.get('pendingOtp') ?? null;
}

/** Stores CAPTCHA solution submitted by operator */
export async function storeCaptcha(jobId: string, captcha: string): Promise<boolean> {
  const res = await JobModel.updateOne({ jobId }, { $set: { pendingCaptcha: captcha } });
  return res.modifiedCount > 0;
}

/** Bot calls this to consume the CAPTCHA solution */
export async function consumeCaptcha(jobId: string): Promise<string | null> {
  const doc = await JobModel.findOneAndUpdate(
    { jobId, pendingCaptcha: { $exists: true, $ne: '' } },
    { $unset: { pendingCaptcha: '' } },
    { new: false, select: 'pendingCaptcha' }
  );
  return doc?.get('pendingCaptcha') ?? null;
}

/** Atomically increment eventSeq and return the new value */
export async function nextEventSeq(jobId: string): Promise<number> {
  const doc = await JobModel.findOneAndUpdate(
    { jobId },
    { $inc: { eventSeq: 1 } },
    { new: true, select: 'eventSeq' }
  );
  return doc?.get('eventSeq') ?? 1;
}

// ---------------------------------------------------------------------------
// Metrics helpers
// ---------------------------------------------------------------------------

export async function getMetricsCounts(): Promise<{
  total: number;
  success: number;
  failure: number;
  cancelled: number;
  active: number;
}> {
  const [total, success, failure, cancelled, active] = await Promise.all([
    JobModel.countDocuments(),
    JobModel.countDocuments({ outcome: 'success' }),
    JobModel.countDocuments({ outcome: 'failure' }),
    JobModel.countDocuments({ outcome: 'cancelled' }),
    JobModel.countDocuments({ outcome: { $exists: false } }),
  ]);
  return { total, success, failure, cancelled, active };
}

export async function getDurationPercentiles(): Promise<{ p50: number | null; p99: number | null }> {
  const docs = await JobModel.find({ durationMs: { $exists: true } })
    .select('durationMs')
    .sort({ durationMs: 1 })
    .lean();

  const durations = docs.map((d) => (d as any)['durationMs'] as number);
  const p50 = durations[Math.floor(durations.length * 0.5)] ?? null;
  const p99 = durations[Math.floor(durations.length * 0.99)] ?? null;
  return { p50, p99 };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toJobFromLean(doc: any): Job {
  return {
    jobId:       doc.jobId,
    panMasked:   doc.panMasked,
    phase:       doc.phase,
    outcome:     doc.outcome,
    startedAt:   (doc.startedAt as Date).toISOString(),
    updatedAt:   (doc.updatedAt as Date).toISOString(),
    completedAt: doc.completedAt ? (doc.completedAt as Date).toISOString() : undefined,
    durationMs:  doc.durationMs,
    error:       doc.error,
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toJob(doc: any): Job {
  return toJobFromLean(doc);
}

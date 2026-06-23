import { spawn, ChildProcess } from 'child_process';
import path from 'path';
import { v4 as uuid } from 'uuid';
import type { Job, Phase, Outcome } from '@itr/shared';
import { maskPan, isValidPan } from '@itr/shared';
import * as jobRepo from '../repository/job-repo';
import { fanOut } from '../sse/fan-out';
import { logger } from '../logger';
import { config } from '../config';

// ---------------------------------------------------------------------------
// Domain: Job lifecycle
// This module owns starting, cancelling, and completing jobs.
// Route handlers call into here — no business logic lives in routes.
// ---------------------------------------------------------------------------

const activeProcesses = new Map<string, ChildProcess>();

// ---------------------------------------------------------------------------
// Start a new job
// ---------------------------------------------------------------------------

export async function startJob(pan: string): Promise<Job> {
  if (!isValidPan(pan)) {
    throw new ValidationError('Invalid PAN format. Expected: 5 alpha + 4 digits + 1 alpha');
  }

  const jobId = uuid();
  const panMasked = maskPan(pan);

  const job = await jobRepo.createJob({ jobId, pan, panMasked });
  logger.info({ jobId, panMasked }, 'Job created');

  // Spawn automation process
  spawnBot(jobId, pan);

  return job;
}

// ---------------------------------------------------------------------------
// Cancel a running job
// ---------------------------------------------------------------------------

export async function cancelJob(jobId: string): Promise<Job | null> {
  const job = await jobRepo.getJobById(jobId);
  if (!job) return null;

  const terminal: Phase[] = ['DONE', 'FAILED', 'CANCELLED'];
  if (terminal.includes(job.phase)) {
    return job; // already done
  }

  // Kill the bot process
  const proc = activeProcesses.get(jobId);
  if (proc) {
    proc.kill('SIGTERM');
    activeProcesses.delete(jobId);
  }

  const updated = await jobRepo.updateJob(jobId, {
    phase: 'CANCELLED',
    outcome: 'cancelled',
    completedAt: new Date(),
    durationMs: Date.now() - new Date(job.startedAt).getTime(),
  });

  fanOut.closeJob(jobId);
  logger.info({ jobId }, 'Job cancelled');
  return updated;
}

// ---------------------------------------------------------------------------
// Handle incoming webhook event from bot
// ---------------------------------------------------------------------------

export async function handleWebhookEvent(
  event: import('@itr/shared').JobEvent,
  phaseTransition?: { from: Phase; to: Phase },
  outcome?: Outcome,
  credentials?: { userId: string; password: string }
): Promise<void> {
  // Persist event
  await import('../repository/event-repo').then((m) => m.insertEvent(event));

  // Fan-out to SSE subscribers
  fanOut.publish(event);

  // Update job if phase or outcome changed
  const update: Parameters<typeof jobRepo.updateJob>[1] = {};

  if (phaseTransition) {
    update.phase = phaseTransition.to;
    logger.info({ jobId: event.jobId, from: phaseTransition.from, to: phaseTransition.to }, 'Phase transition');
  }

  if (outcome) {
    update.outcome = outcome;
    update.completedAt = new Date();
    const job = await jobRepo.getJobById(event.jobId);
    if (job) {
      update.durationMs = Date.now() - new Date(job.startedAt).getTime();
    }
    if (credentials) {
      update.credentials = credentials; // already encrypted by bot
    }
    // Close SSE stream after a short delay so last events flush
    setTimeout(() => fanOut.closeJob(event.jobId), 2000);
    logger.info({ jobId: event.jobId, outcome }, 'Job completed');
  }

  if (Object.keys(update).length > 0) {
    await jobRepo.updateJob(event.jobId, update);
  }
}

// ---------------------------------------------------------------------------
// Spawn bot process
// ---------------------------------------------------------------------------

function spawnBot(jobId: string, pan: string): void {
  const automationEntry = path.resolve(__dirname, '../../../automation/dist/index.js');

  const child = spawn(
    'node',
    [automationEntry, '--jobId', jobId, '--pan', pan],
    {
      env: {
        ...process.env,
        JOB_ID: jobId,
        SERVICE_URL: config.nodeEnv === 'production'
          ? (process.env['SERVICE_URL'] ?? 'http://localhost:4000')
          : (process.env['SERVICE_URL'] ?? 'http://localhost:4000'),
        WEBHOOK_SECRET: config.auth.webhookSecret,
      },
      detached: false,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  activeProcesses.set(jobId, child);

  child.stdout?.on('data', (d: Buffer) =>
    logger.debug({ jobId }, `bot stdout: ${d.toString().trim()}`)
  );
  child.stderr?.on('data', (d: Buffer) =>
    logger.warn({ jobId }, `bot stderr: ${d.toString().trim()}`)
  );

  child.on('exit', (code) => {
    activeProcesses.delete(jobId);
    logger.info({ jobId, code }, 'Bot process exited');
  });

  child.on('error', (err) => {
    activeProcesses.delete(jobId);
    logger.error({ jobId, err }, 'Bot process error');
  });
}

// ---------------------------------------------------------------------------
// Custom error types
// ---------------------------------------------------------------------------

export class ValidationError extends Error {
  readonly statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends Error {
  readonly statusCode = 404;
  constructor(message: string) {
    super(message);
    this.name = 'NotFoundError';
  }
}

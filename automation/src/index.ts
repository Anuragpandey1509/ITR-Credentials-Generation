import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

import { run } from './runner';
import { logger } from './logger';

// ---------------------------------------------------------------------------
// Entry point — accepts jobId + pan from environment or CLI args
// ---------------------------------------------------------------------------

function parseArgs(): { jobId: string; pan: string } {
  const args = process.argv.slice(2);
  let jobId = process.env['JOB_ID'] ?? '';
  let pan   = process.env['PAN']    ?? '';

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--jobId' && args[i + 1]) jobId = args[i + 1]!;
    if (args[i] === '--pan'   && args[i + 1]) pan   = args[i + 1]!;
  }

  if (!jobId) throw new Error('--jobId is required');
  if (!pan)   throw new Error('--pan is required');

  return { jobId, pan };
}

async function main() {
  const { jobId, pan } = parseArgs();
  logger.info({ jobId }, 'Automation starting');

  try {
    await run(jobId, pan);
    logger.info({ jobId }, 'Automation finished');
    process.exit(0);
  } catch (err) {
    logger.error({ jobId, err }, 'Automation crashed');
    process.exit(1);
  }
}

main();

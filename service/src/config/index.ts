import * as dotenv from 'dotenv';
import path from 'path';

dotenv.config({ path: path.resolve(__dirname, '../../.env') });

function required(key: string): string {
  const val = process.env[key];
  if (!val) throw new Error(`Missing required environment variable: ${key}`);
  return val;
}

function optional(key: string, fallback: string): string {
  return process.env[key] ?? fallback;
}

export const config = {
  port: parseInt(optional('PORT', '4000'), 10),
  nodeEnv: optional('NODE_ENV', 'development'),

  mongodb: {
    uri: required('MONGODB_URI'),
    dbName: optional('MONGODB_DB', 'itr-credentials'),
  },

  auth: {
    /** Bearer token for mutating dashboard/service routes */
    bearerToken: required('API_BEARER_TOKEN'),
    /** Shared secret for bot → service webhook */
    webhookSecret: required('WEBHOOK_SECRET'),
  },

  crypto: {
    /** 32-byte hex key for AES-256 encryption of credentials */
    encryptionKey: required('ENCRYPTION_KEY'),
  },

  /** Maximum in-memory ring buffer size per job */
  ringBufferSize: parseInt(optional('RING_BUFFER_SIZE', '500'), 10),

  /** SSE heartbeat interval (ms) */
  sseHeartbeatMs: parseInt(optional('SSE_HEARTBEAT_MS', '15000'), 10),
} as const;

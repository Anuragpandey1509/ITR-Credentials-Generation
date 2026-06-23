import mongoose from 'mongoose';
import { config } from '../config';
import { logger } from '../logger';

let isConnected = false;

export async function connectDb(): Promise<void> {
  if (isConnected) return;

  mongoose.connection.on('connected', () => logger.info('MongoDB connected'));
  mongoose.connection.on('error', (err) => logger.error({ err }, 'MongoDB error'));
  mongoose.connection.on('disconnected', () => logger.warn('MongoDB disconnected'));

  await mongoose.connect(config.mongodb.uri, {
    dbName: config.mongodb.dbName,
  });

  isConnected = true;
}

export async function closeDb(): Promise<void> {
  await mongoose.connection.close();
  isConnected = false;
  logger.info('MongoDB connection closed');
}

export { mongoose };

import mongoose from 'mongoose';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

mongoose.set('strictQuery', true);

export async function connectDatabase(uri = env.MONGODB_URI) {
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 5000, socketTimeoutMS: 45_000, maxPoolSize: 20 });
  logger.info({ event: 'db.connected' }, 'MongoDB connected');
  // Post-startup connection events: logged (never with the URI/credentials) so operators see
  // network partitions/replica-set failovers instead of silent request failures.
  mongoose.connection.on('error', (err) => logger.error({ event: 'db.error', err: err.message }, 'MongoDB connection error'));
  mongoose.connection.on('disconnected', () => logger.warn({ event: 'db.disconnected' }, 'MongoDB disconnected'));
  mongoose.connection.on('reconnected', () => logger.info({ event: 'db.reconnected' }, 'MongoDB reconnected'));
  return mongoose.connection;
}

export const disconnectDatabase = () => mongoose.disconnect();
export const isDatabaseReady = () => mongoose.connection.readyState === 1;

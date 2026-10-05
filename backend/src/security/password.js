import bcrypt from 'bcryptjs';
import { env } from '../config/env.js';

export const hashPassword = (plain) => bcrypt.hash(plain, env.BCRYPT_COST);
export const verifyPassword = (plain, hash) => bcrypt.compare(plain, hash);
/** Used to equalise response timing when the account does not exist. */
export const DUMMY_HASH = bcrypt.hashSync('timing-equaliser-not-a-real-password', 4);

// Password hashing via Node's built-in crypto.scrypt — zero external dependency,
// no native build step (safe on Vercel serverless), sufficient for a 5-10 user
// internal tool (not a consumer-scale auth surface).
import { scrypt, randomBytes, timingSafeEqual } from 'crypto';
import { promisify } from 'util';

const scryptAsync = promisify(scrypt);
const KEY_LEN = 64;

/**
 * @param {string} password
 * @returns {Promise<string>} "${saltHex}:${derivedKeyHex}"
 */
export async function hashPassword(password) {
  const salt = randomBytes(16).toString('hex');
  const derivedKey = await scryptAsync(password, salt, KEY_LEN);
  return `${salt}:${derivedKey.toString('hex')}`;
}

/**
 * @param {string} password
 * @param {string} hashString - "${saltHex}:${derivedKeyHex}"
 * @returns {Promise<boolean>}
 */
export async function verifyPassword(password, hashString) {
  try {
    const [salt, keyHex] = String(hashString || '').split(':');
    if (!salt || !keyHex) return false;
    const keyBuf = Buffer.from(keyHex, 'hex');
    if (keyBuf.length !== KEY_LEN) return false;
    const derivedKey = await scryptAsync(password, salt, KEY_LEN);
    return timingSafeEqual(keyBuf, derivedKey);
  } catch (err) {
    console.error('[password] verifyPassword failed:', err.message);
    return false;
  }
}

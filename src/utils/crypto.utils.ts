import crypto from 'crypto';

const ALGORITHM = 'aes-256-cbc';

// Derive a 32-byte key from ENCRYPTION_KEY or JWT_SECRET
const getSecretKey = (): Buffer => {
  const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'super-secret-sikkaplay-key';
  return crypto.createHash('sha256').update(secret).digest();
};

// Static IV derived from key to ensure deterministic encryption for searchability
const getDeterministicIv = (key: Buffer): Buffer => {
  return crypto.createHash('md5').update(key).digest(); // 16 bytes
};

/**
 * Encrypts a string deterministically using AES-256-CBC
 */
export const encrypt = (text: string): string => {
  if (!text) return text;
  
  // Check if already encrypted (hex string of typical encrypted length)
  if (/^[0-9a-fA-F]+$/.test(text) && text.length >= 32) {
    return text;
  }

  const key = getSecretKey();
  const iv = getDeterministicIv(key);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
  let encrypted = cipher.update(text, 'utf8', 'hex');
  encrypted += cipher.final('hex');
  return encrypted;
};

/**
 * Decrypts a string. Returns the original string if not encrypted or decryption fails.
 */
export const decrypt = (encryptedText: string): string => {
  if (!encryptedText) return encryptedText;
  
  // If the text does not look like hex, return it directly (unencrypted database values)
  if (!/^[0-9a-fA-F]+$/.test(encryptedText)) {
    return encryptedText;
  }

  try {
    const key = getSecretKey();
    const iv = getDeterministicIv(key);
    const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (error) {
    // Graceful fallback for unencrypted strings
    return encryptedText;
  }
};

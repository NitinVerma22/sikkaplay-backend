"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.decrypt = exports.encrypt = void 0;
const crypto_1 = __importDefault(require("crypto"));
const ALGORITHM = 'aes-256-cbc';
// Derive a 32-byte key from ENCRYPTION_KEY or JWT_SECRET
const getSecretKey = () => {
    const secret = process.env.ENCRYPTION_KEY || process.env.JWT_SECRET || 'super-secret-sikkaplay-key';
    return crypto_1.default.createHash('sha256').update(secret).digest();
};
// Static IV derived from key to ensure deterministic encryption for searchability
const getDeterministicIv = (key) => {
    return crypto_1.default.createHash('md5').update(key).digest(); // 16 bytes
};
/**
 * Encrypts a string deterministically using AES-256-CBC
 */
const encrypt = (text) => {
    if (!text)
        return text;
    // Check if already encrypted (hex string of typical encrypted length)
    if (/^[0-9a-fA-F]+$/.test(text) && text.length >= 32) {
        return text;
    }
    const key = getSecretKey();
    const iv = getDeterministicIv(key);
    const cipher = crypto_1.default.createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return encrypted;
};
exports.encrypt = encrypt;
/**
 * Decrypts a string. Returns the original string if not encrypted or decryption fails.
 */
const decrypt = (encryptedText) => {
    if (!encryptedText)
        return encryptedText;
    // If the text does not look like hex, return it directly (unencrypted database values)
    if (!/^[0-9a-fA-F]+$/.test(encryptedText)) {
        return encryptedText;
    }
    try {
        const key = getSecretKey();
        const iv = getDeterministicIv(key);
        const decipher = crypto_1.default.createDecipheriv(ALGORITHM, key, iv);
        let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        return decrypted;
    }
    catch (error) {
        // Graceful fallback for unencrypted strings
        return encryptedText;
    }
};
exports.decrypt = decrypt;

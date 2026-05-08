/**
 * Credentials encryption (AES-256-GCM).
 *
 * Third-party OAuth tokens and API secrets for Meta, Google Ads, TikTok, Shopee, Lazada, etc.
 * are persisted on `Connection.credentials` via `encrypt(JSON.stringify(...))` so secrets are
 * ciphertext-at-rest. Legacy plaintext rows are still readable via `safeDecrypt`.
 */
import crypto from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const AUTH_TAG_LENGTH = 16;

function getKey(): Buffer {
  const key = process.env.ENCRYPTION_KEY;
  if (!key) {
    throw new Error(
      "ENCRYPTION_KEY environment variable is not set. Generate one with: openssl rand -hex 32"
    );
  }
  return Buffer.from(key, "hex");
}

/**
 * Encrypts a plaintext string using AES-256-GCM.
 * Returns a string in the format: iv:authTag:ciphertext (all hex-encoded).
 */
export function encrypt(text: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, key, iv);

  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");

  const authTag = cipher.getAuthTag();

  return `${iv.toString("hex")}:${authTag.toString("hex")}:${encrypted}`;
}

/**
 * Decrypts a string produced by encrypt().
 * Expects input in the format: iv:authTag:ciphertext (all hex-encoded).
 */
export function decrypt(encrypted: string): string {
  const key = getKey();
  const parts = encrypted.split(":");

  if (parts.length !== 3) {
    throw new Error("Invalid encrypted format. Expected iv:authTag:ciphertext");
  }

  const iv = Buffer.from(parts[0], "hex");
  const authTag = Buffer.from(parts[1], "hex");
  const ciphertext = parts[2];

  const decipher = crypto.createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);

  let decrypted = decipher.update(ciphertext, "hex", "utf8");
  decrypted += decipher.final("utf8");

  return decrypted;
}

/**
 * Checks if a string looks like it's already encrypted (iv:authTag:ciphertext format).
 * Used during migration to avoid double-encrypting.
 */
export function isEncrypted(value: string): boolean {
  const parts = value.split(":");
  if (parts.length !== 3) return false;
  // Check if all parts are valid hex strings
  return parts.every((part) => /^[0-9a-f]+$/i.test(part));
}

/**
 * Safely decrypts credentials — if the value is not encrypted (e.g., legacy plain JSON),
 * returns it as-is. This allows gradual migration.
 */
export function safeDecrypt(value: string): string {
  if (!isEncrypted(value)) {
    return value; // Legacy plain-text — return as-is
  }
  try {
    return decrypt(value);
  } catch {
    // If decryption fails, assume it's plain text
    return value;
  }
}

import crypto from "node:crypto";
import fs from "node:fs";

const [mode, inputPath, outputPath] = process.argv.slice(2);
const rawKey = process.env.DR_BACKUP_ENCRYPTION_KEY?.trim() ?? "";
if (!/^[0-9a-f]{64}$/i.test(rawKey)) {
  throw new Error("DR_BACKUP_ENCRYPTION_KEY must be exactly 64 hexadecimal characters");
}
if (!inputPath || !outputPath || !["encrypt", "decrypt"].includes(mode)) {
  throw new Error("Usage: node scripts/dr-backup-crypto.mjs <encrypt|decrypt> <input> <output>");
}

const key = Buffer.from(rawKey, "hex");
const MAGIC = Buffer.from("MCDR1", "utf8");

if (mode === "encrypt") {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const plaintext = fs.readFileSync(inputPath);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  fs.writeFileSync(outputPath, Buffer.concat([MAGIC, iv, tag, ciphertext]), { mode: 0o600 });
} else {
  const payload = fs.readFileSync(inputPath);
  if (payload.length < MAGIC.length + 12 + 16 || !payload.subarray(0, MAGIC.length).equals(MAGIC)) {
    throw new Error("Invalid Monstera DR backup envelope");
  }
  const iv = payload.subarray(MAGIC.length, MAGIC.length + 12);
  const tag = payload.subarray(MAGIC.length + 12, MAGIC.length + 28);
  const ciphertext = payload.subarray(MAGIC.length + 28);
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  fs.writeFileSync(outputPath, plaintext, { mode: 0o600 });
}

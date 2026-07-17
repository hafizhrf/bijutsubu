import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { env } from "../config/env.js";

/**
 * At-rest encryption for external data-source passwords (AES-256-GCM).
 * The key comes from SOURCE_CREDENTIAL_ENC_KEY, falling back to a key derived
 * from JWT_SECRET so self-hosted setups boot without extra config. Payload
 * format: base64("v1:" is implied by field layout) — iv.tag.ciphertext, all
 * base64url, dot-separated. Plaintext credentials must never be logged or
 * returned by any endpoint.
 */

const KEY = createHash("sha256")
  .update(env.SOURCE_CREDENTIAL_ENC_KEY ?? `bijustubu-source-vault:${env.JWT_SECRET}`)
  .digest();

export function encryptCredential(plaintext: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", KEY, iv);
  const encrypted = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64url")}.${tag.toString("base64url")}.${encrypted.toString("base64url")}`;
}

export function decryptCredential(payload: string): string {
  const [iv, tag, data] = payload.split(".");
  if (!iv || !tag || !data) throw new Error("malformed credential payload");
  const decipher = createDecipheriv("aes-256-gcm", KEY, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(data, "base64url")), decipher.final()]).toString(
    "utf8",
  );
}

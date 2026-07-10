#!/usr/bin/env node
/**
 * Generate the DEANOS_PASSWORD_HASH value for .env.
 * Usage: npm run hash-password -- 'your-password-here'
 */
import { randomBytes, scryptSync } from "node:crypto";

const password = process.argv[2];
if (!password || password.length < 8) {
  console.error("Usage: npm run hash-password -- 'your-password' (min 8 characters)");
  process.exit(1);
}

const salt = randomBytes(16);
const hash = scryptSync(password, salt, 64);
console.log(`scrypt:${salt.toString("base64")}:${hash.toString("base64")}`);

#!/usr/bin/env node
/**
 * hash-password.js
 * --------------------------------------------------------------------------
 * Helper for generating a bcrypt hash to paste into config.json under
 * `auth.passwordHash`. Run with:
 *   node scripts/hash-password.js "your-password"
 * --------------------------------------------------------------------------
 */
import bcrypt from 'bcryptjs';

const pw = process.argv[2];
if (!pw) {
  console.error('Usage: node scripts/hash-password.js <password>');
  process.exit(1);
}
const hash = bcrypt.hashSync(pw, 10);
console.log(hash);

#!/usr/bin/env node
'use strict';
const { generateKeyPairSync } = require('crypto');
const { existsSync, mkdirSync, writeFileSync } = require('fs');
const { join } = require('path');

const keysDir = join(process.cwd(), 'keys');
if (!existsSync(keysDir)) mkdirSync(keysDir, { recursive: true });

const { privateKey, publicKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding:  { type: 'spki',  format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});

writeFileSync(join(keysDir, 'private.pem'), privateKey, { mode: 0o600 });
writeFileSync(join(keysDir, 'public.pem'),  publicKey);

console.log('RSA-2048 key pair generated:');
console.log('  Private key: keys/private.pem');
console.log('  Public key:  keys/public.pem');
console.log('');
console.log('Copy public key to your main app .env:');
console.log('  LICENSE_PUBLIC_KEY_DEV="$(cat keys/public.pem)"');

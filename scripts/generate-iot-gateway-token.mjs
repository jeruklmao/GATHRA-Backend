#!/usr/bin/env node
import { createHash, randomBytes } from 'node:crypto';

const token = randomBytes(32).toString('base64url');
const digest = createHash('sha256').update(token, 'utf8').digest('hex');

console.log(`Gateway token (provision once; never commit): ${token}`);
console.log(`IOT_GATEWAY_TOKEN_SHA256=${digest}`);

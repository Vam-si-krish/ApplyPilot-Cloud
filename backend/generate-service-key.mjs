import crypto from 'node:crypto';

let secret = '';
for await (const chunk of process.stdin) secret += chunk;
secret = secret.trim();
if (secret.length < 32) throw new Error('JWT secret must be at least 32 characters');
const encode = (value) => Buffer.from(JSON.stringify(value)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const header = encode({ alg: 'HS256', typ: 'JWT' });
const payload = encode({ role: process.env.DB_ROLE || 'jobpilot_multi_app', iat: now, exp: now + 315360000 });
const signature = crypto.createHmac('sha256', secret).update(`${header}.${payload}`).digest('base64url');
process.stdout.write(`${header}.${payload}.${signature}`);

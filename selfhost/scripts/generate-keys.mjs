#!/usr/bin/env node
// Fills <generated>/empty secrets in selfhost/.env (creating it from
// .env.example if missing). Zero dependencies. Idempotent: existing real
// values are never overwritten — delete a line's value to regenerate it.
//
// ANON_KEY / SERVICE_ROLE_KEY are HS256 JWTs signed with JWT_SECRET, the same
// shape Supabase uses ({role, iss: "supabase"}, 10-year expiry).

import { randomBytes, createHmac } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync, copyFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const envPath = join(root, '.env');
if (!existsSync(envPath)) copyFileSync(join(root, '.env.example'), envPath);

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const alnum = (n) => {
  // URL/connection-string safe: letters+digits only (these end up inside
  // postgres:// URLs in the compose file).
  let out = '';
  while (out.length < n) out += randomBytes(32).toString('base64url').replace(/[-_]/g, '');
  return out.slice(0, n);
};
const signJwt = (payload, secret) => {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const sig = createHmac('sha256', secret).update(`${head}.${body}`).digest('base64url');
  return `${head}.${body}.${sig}`;
};

let env = readFileSync(envPath, 'utf8');
const get = (k) => env.match(new RegExp(`^${k}=(.*)$`, 'm'))?.[1] ?? '';
const set = (k, v) => {
  if (new RegExp(`^${k}=`, 'm').test(env)) env = env.replace(new RegExp(`^${k}=.*$`, 'm'), `${k}=${v}`);
  else env += `\n${k}=${v}`;
};
const missing = (k) => { const v = get(k); return !v || v === '<generated>'; };

const changed = [];
if (missing('POSTGRES_PASSWORD')) { set('POSTGRES_PASSWORD', alnum(32)); changed.push('POSTGRES_PASSWORD'); }
if (missing('JWT_SECRET')) { set('JWT_SECRET', alnum(48)); changed.push('JWT_SECRET'); }
if (missing('PG_META_CRYPTO_KEY')) { set('PG_META_CRYPTO_KEY', alnum(32)); changed.push('PG_META_CRYPTO_KEY'); }

// (Re)issue the two API JWTs whenever they're missing OR the secret changed.
const secret = get('JWT_SECRET');
const iat = Math.floor(Date.now() / 1000);
const exp = iat + 10 * 365 * 24 * 3600;
const stale = (k, role) => {
  if (missing(k)) return true;
  try {
    const [h, b, s] = get(k).split('.');
    const resigned = createHmac('sha256', secret).update(`${h}.${b}`).digest('base64url');
    return s !== resigned || JSON.parse(Buffer.from(b, 'base64url')).role !== role;
  } catch { return true; }
};
if (stale('ANON_KEY', 'anon')) { set('ANON_KEY', signJwt({ role: 'anon', iss: 'supabase', iat, exp }, secret)); changed.push('ANON_KEY'); }
if (stale('SERVICE_ROLE_KEY', 'service_role')) { set('SERVICE_ROLE_KEY', signJwt({ role: 'service_role', iss: 'supabase', iat, exp }, secret)); changed.push('SERVICE_ROLE_KEY'); }

writeFileSync(envPath, env);
console.log(changed.length ? `generated: ${changed.join(', ')}` : 'nothing to generate — .env already complete');

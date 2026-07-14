import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createClient } from '@supabase/supabase-js';
import ws from 'ws';
import { startServer } from './server.mjs';

const clientOptions = {
  auth: { persistSession: false, autoRefreshToken: false },
  realtime: { transport: ws },
  global: { headers: { 'x-jobpilot-user-id': '00000000-0000-4000-8000-000000000002' } },
};

test('Supabase REST client is authenticated and proxied to PostgREST', async (t) => {
  let received = null;
  const upstream = http.createServer((req, res) => {
    received = { url: req.url, apikey: req.headers.apikey, authorization: req.headers.authorization };
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify([{ id: 1 }]));
  });
  upstream.listen(0, '127.0.0.1');
  await new Promise((resolve) => upstream.once('listening', resolve));
  const server = startServer({
    port: 0,
    dataRoot: await fs.mkdtemp(path.join(os.tmpdir(), 'jobpilot-rest-')),
    serviceKey: 'test-service-key',
    jwtSecret: 'test-jwt-secret-at-least-thirty-two-characters',
    signingSecret: 'test-signing-secret',
    restTarget: `http://127.0.0.1:${upstream.address().port}`,
  });
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await new Promise((resolve) => upstream.close(resolve));
  });

  const client = createClient(
    `http://127.0.0.1:${server.address().port}/jobpilot`,
    'test-service-key',
    clientOptions,
  );
  const result = await client.from('profile').select('*').eq('id', 1);
  assert.equal(result.error, null);
  assert.deepEqual(result.data, [{ id: 1 }]);
  const proxiedUrl = new URL(received.url, 'http://postgrest.local');
  assert.equal(proxiedUrl.pathname, '/profile');
  assert.equal(proxiedUrl.searchParams.get('id'), 'eq.1');
  assert.equal(proxiedUrl.searchParams.get('select'), '*');
  assert.equal(received.apikey, 'test-service-key');
  const claims = JSON.parse(Buffer.from(received.authorization.split('.')[1], 'base64url').toString());
  assert.equal(claims.scope, 'user');
  assert.equal(claims.user_id, '00000000-0000-4000-8000-000000000002');
});

test('storage upload and signed download stay private', async (t) => {
  const dataRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'jobpilot-backend-'));
  const server = startServer({
    port: 0,
    dataRoot,
    serviceKey: 'test-service-key',
    jwtSecret: 'test-jwt-secret-at-least-thirty-two-characters',
    signingSecret: 'test-signing-secret',
    restTarget: 'http://127.0.0.1:1',
  });
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(async () => {
    await new Promise((resolve) => server.close(resolve));
    await fs.rm(dataRoot, { recursive: true, force: true });
  });
  const base = `http://127.0.0.1:${server.address().port}/jobpilot/storage/v1`;

  const denied = await fetch(`${base}/object/resumes/example.pdf`, { method: 'POST', body: 'private' });
  assert.equal(denied.status, 401);

  const missingUser = await fetch(`${base}/object/resumes/example.pdf`, {
    method: 'POST',
    headers: { apikey: 'test-service-key', 'content-type': 'application/pdf' },
    body: 'private',
  });
  assert.equal(missingUser.status, 400);

  const uploaded = await fetch(`${base}/object/resumes/example.pdf`, {
    method: 'POST',
    headers: {
      apikey: 'test-service-key',
      'content-type': 'application/pdf',
      'x-upsert': 'true',
      'x-jobpilot-user-id': '00000000-0000-4000-8000-000000000002',
    },
    body: 'private-pdf',
  });
  assert.equal(uploaded.status, 200);

  const signed = await fetch(`${base}/object/sign/resumes/example.pdf`, {
    method: 'POST',
    headers: {
      apikey: 'test-service-key',
      'content-type': 'application/json',
      'x-jobpilot-user-id': '00000000-0000-4000-8000-000000000002',
    },
    body: JSON.stringify({ expiresIn: 60 }),
  });
  assert.equal(signed.status, 200);
  const { signedURL } = await signed.json();
  const downloaded = await fetch(`${base}${signedURL}`);
  assert.equal(downloaded.status, 200);
  assert.equal(await downloaded.text(), 'private-pdf');

  const client = createClient(
    `http://127.0.0.1:${server.address().port}/jobpilot`,
    'test-service-key',
    clientOptions,
  );
  const sdkUpload = await client.storage.from('resumes').upload('sdk.pdf', Buffer.from('sdk-pdf'), {
    contentType: 'application/pdf',
    upsert: true,
  });
  assert.equal(sdkUpload.error, null);
  const sdkSigned = await client.storage.from('resumes').createSignedUrl('sdk.pdf', 60);
  assert.equal(sdkSigned.error, null);
  const sdkDownload = await fetch(sdkSigned.data.signedUrl);
  assert.equal(await sdkDownload.text(), 'sdk-pdf');

  // The same logical path belongs to a different physical namespace for another user.
  const otherClient = createClient(
    `http://127.0.0.1:${server.address().port}/jobpilot`,
    'test-service-key',
    {
      ...clientOptions,
      global: { headers: { 'x-jobpilot-user-id': '00000000-0000-4000-8000-000000000003' } },
    },
  );
  const beforeUpload = await otherClient.storage.from('resumes').createSignedUrl('sdk.pdf', 60);
  assert.notEqual(beforeUpload.error, null);
  assert.equal((await otherClient.storage.from('resumes').upload('sdk.pdf', Buffer.from('other-user-pdf'))).error, null);
  const otherSigned = await otherClient.storage.from('resumes').createSignedUrl('sdk.pdf', 60);
  assert.equal(otherSigned.error, null);
  assert.equal(await fetch(otherSigned.data.signedUrl).then((response) => response.text()), 'other-user-pdf');
  assert.equal(await fetch(sdkSigned.data.signedUrl).then((response) => response.text()), 'sdk-pdf');
});

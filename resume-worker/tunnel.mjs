/**
 * Self-updating Cloudflare quick tunnel for the résumé worker (ADR 0032).
 *
 * The deployed app reaches this local worker over a Cloudflare quick tunnel, whose
 * public URL is RANDOM and changes on every (re)start. Previously that URL had to be
 * hand-pasted into the app's Settings, so any tunnel restart silently broke résumé
 * generation (502). This wrapper removes the manual step entirely:
 *
 *   1. start `cloudflared tunnel --url http://localhost:<PORT>`
 *   2. read the `https://<random>.trycloudflare.com` URL it prints
 *   3. write it straight into the app's `settings.resume_worker_url` (Supabase),
 *      which the app prefers over its env var — so it takes effect immediately
 *   4. keep the tunnel alive; if cloudflared dies, restart it and re-publish the URL
 *
 * Run it under launchd (./install-tunnel-service.sh) so it survives reboots/crashes.
 * Credentials come from the worker's own .env (SUPABASE_URL + SERVICE_ROLE_KEY).
 */
import 'dotenv/config';
import { spawn } from 'node:child_process';

const PORT = process.env.PORT || 8787;
const LOCAL = `http://localhost:${PORT}`;
const SUPABASE_URL = (process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
// --config /dev/null so a stray ~/.cloudflared/config.yml can't hijack quick-tunnel routing.
const CF_ARGS = ['tunnel', '--url', LOCAL, '--config', '/dev/null'];
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

const log = (...a) => console.log(new Date().toISOString(), ...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

if (!SUPABASE_URL || !SERVICE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env — cannot publish the tunnel URL.');
  process.exit(1);
}

/** Write the current tunnel URL into the app's settings row (retries on transient failure). */
async function publishUrl(url, attempt = 1) {
  try {
    const res = await fetch(`${SUPABASE_URL}/rest/v1/settings?id=eq.1`, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/json',
        apikey: SERVICE_KEY,
        Authorization: `Bearer ${SERVICE_KEY}`,
        Prefer: 'return=minimal',
      },
      body: JSON.stringify({ resume_worker_url: url }),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
    log(`✓ published settings.resume_worker_url → ${url}`);
  } catch (e) {
    if (attempt < 5) {
      await sleep(2000 * attempt);
      return publishUrl(url, attempt + 1);
    }
    log(`✗ failed to publish URL after ${attempt} attempts: ${e instanceof Error ? e.message : String(e)}`);
  }
}

let currentUrl = null;

function start() {
  log(`starting cloudflared quick tunnel → ${LOCAL}`);
  const cf = spawn('cloudflared', CF_ARGS, { stdio: ['ignore', 'pipe', 'pipe'] });

  const scan = (buf) => {
    const s = buf.toString();
    process.stdout.write(s); // passthrough to the log file
    const m = s.match(URL_RE);
    if (m && m[0] !== currentUrl) {
      currentUrl = m[0];
      publishUrl(currentUrl);
    }
  };
  cf.stdout.on('data', scan);
  cf.stderr.on('data', scan);

  cf.on('exit', (code) => {
    log(`cloudflared exited (code ${code}); restarting in 3s`);
    currentUrl = null;
    setTimeout(start, 3000);
  });
}

start();

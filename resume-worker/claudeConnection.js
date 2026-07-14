/**
 * Per-user Claude subscription login broker.
 *
 * The website never receives a Claude password or browser cookie. It starts the
 * official `claude auth login --claudeai` PKCE flow on the worker, opens the
 * authorization URL in the user's browser, and forwards the one-time code back
 * to that same CLI process. Claude Code persists refresh credentials in an
 * isolated CLAUDE_CONFIG_DIR owned by that ApplyPilot user.
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(here, '..', 'backend', 'data', 'claude-users');
const LOGIN_TTL_MS = 10 * 60_000;
const START_TIMEOUT_MS = 20_000;
const COMPLETE_TIMEOUT_MS = 60_000;
const pending = new Map();

export function claudeUserConfigDir(userId, env = process.env) {
  if (typeof userId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error('A valid ApplyPilot user ID is required for Claude credentials');
  }
  const root = (env.CLAUDE_USER_CONFIG_ROOT || '').trim() || DEFAULT_ROOT;
  return join(root, userId.toLowerCase());
}

export function extractClaudeAuthorizationUrl(value) {
  // Terminal hyperlink wrappers use ESC/BEL controls, both excluded here. The
  // first match is the URL target even when the terminal also prints its label.
  return String(value).match(/https:\/\/claude\.com\/cai\/oauth\/authorize\?[^\x00-\x20\x7f]+/)?.[0] || null;
}

function cliPath(env = process.env) {
  return (env.CLAUDE_CLI_PATH || '').trim() || 'claude';
}

function userClaudeEnv(userId, env = process.env) {
  const next = { ...env };
  delete next.ANTHROPIC_API_KEY;
  delete next.ANTHROPIC_AUTH_TOKEN;
  delete next.CLAUDE_CODE_OAUTH_TOKEN;
  next.CLAUDE_CONFIG_DIR = claudeUserConfigDir(userId, env);
  // The authorization URL is returned to the user's browser. Do not open an
  // unrelated browser window on the server laptop as a side effect.
  next.BROWSER = '/usr/bin/false';
  return next;
}

export function normalizeClaudeStatus(raw = {}) {
  const method = typeof raw.authMethod === 'string' ? raw.authMethod : 'none';
  return {
    connected: raw.loggedIn === true && (method === 'claude.ai' || method === 'oauth'),
    authMethod: method,
    subscriptionType: typeof raw.subscriptionType === 'string' ? raw.subscriptionType : null,
    email: typeof raw.email === 'string' ? raw.email : null,
  };
}

export async function claudeConnectionStatus(userId) {
  const dir = claudeUserConfigDir(userId);
  if (!existsSync(dir)) return normalizeClaudeStatus();
  try {
    const { stdout } = await execFileAsync(cliPath(), ['auth', 'status', '--json'], {
      env: userClaudeEnv(userId),
      timeout: 15_000,
      maxBuffer: 128 * 1024,
    });
    return normalizeClaudeStatus(JSON.parse(stdout));
  } catch {
    return normalizeClaudeStatus();
  }
}

function stopPending(userId, reason = 'cancelled') {
  const active = pending.get(userId);
  if (!active) return;
  clearTimeout(active.expiryTimer);
  pending.delete(userId);
  active.reason = reason;
  if (!active.child.killed) active.child.kill('SIGTERM');
}

export async function startClaudeConnection(userId) {
  const status = await claudeConnectionStatus(userId);
  if (status.connected) return { ...status, alreadyConnected: true };

  stopPending(userId, 'restarted');
  const configDir = claudeUserConfigDir(userId);
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  await chmod(configDir, 0o700);

  const child = spawn(cliPath(), ['auth', 'login', '--claudeai'], {
    env: userClaudeEnv(userId),
    stdio: ['pipe', 'pipe', 'pipe'],
  });
  let output = '';
  let settled = false;
  let resolveUrl;
  let rejectUrl;
  const urlPromise = new Promise((resolve, reject) => {
    resolveUrl = resolve;
    rejectUrl = reject;
  });
  const active = { child, output, expiryTimer: null, reason: null, exited: false, exitCode: null };
  pending.set(userId, active);

  const capture = (chunk) => {
    output = (output + String(chunk)).slice(-16_000);
    active.output = output;
    const url = extractClaudeAuthorizationUrl(output);
    if (url && !settled) {
      settled = true;
      resolveUrl(url);
    }
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.once('error', (error) => {
    if (!settled) {
      settled = true;
      rejectUrl(error);
    }
    stopPending(userId, 'spawn failed');
  });
  child.once('exit', (code) => {
    active.exited = true;
    active.exitCode = code;
    if (!settled) {
      settled = true;
      rejectUrl(new Error(`Claude login exited before authorization started (${code ?? 'signal'})`));
    }
  });

  const startTimer = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectUrl(new Error('Claude login did not produce an authorization URL'));
      stopPending(userId, 'start timeout');
    }
  }, START_TIMEOUT_MS);

  try {
    const authorizationUrl = await urlPromise;
    clearTimeout(startTimer);
    active.expiryTimer = setTimeout(() => stopPending(userId, 'expired'), LOGIN_TTL_MS);
    return { connected: false, authorizationUrl, expiresInSeconds: LOGIN_TTL_MS / 1000 };
  } catch (error) {
    clearTimeout(startTimer);
    throw error;
  }
}

export async function completeClaudeConnection(userId, code) {
  const active = pending.get(userId);
  if (!active) throw new Error('No Claude login is waiting. Start the connection again.');
  if (active.exited) {
    pending.delete(userId);
    throw new Error('The Claude login is no longer waiting. Start the connection again.');
  }
  const value = typeof code === 'string' ? code.trim() : '';
  if (!value || value.length > 4096 || /[\r\n]/.test(value)) {
    throw new Error('Paste the one-time authorization code from Anthropic.');
  }

  const completion = new Promise((resolve, reject) => {
    let finished = false;
    const finish = (work) => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      clearTimeout(active.expiryTimer);
      pending.delete(userId);
      work();
    };
    const timer = setTimeout(() => {
      stopPending(userId, 'completion timeout');
      finish(() => reject(new Error('Claude login timed out. Start the connection again.')));
    }, COMPLETE_TIMEOUT_MS);
    active.child.once('exit', (exitCode) => {
      finish(() => {
        if (exitCode === 0) resolve();
        else reject(new Error('Anthropic rejected or cancelled the authorization code.'));
      });
    });
    active.child.once('error', (error) => {
      finish(() => reject(error));
    });
    try {
      active.child.stdin.write(`${value}\n`);
      active.child.stdin.end();
    } catch (error) {
      stopPending(userId, 'input failed');
      finish(() => reject(error));
    }
  });
  await completion;

  const status = await claudeConnectionStatus(userId);
  if (!status.connected) throw new Error('Claude login finished, but no subscription session was saved.');
  return status;
}

export async function disconnectClaudeConnection(userId) {
  stopPending(userId, 'disconnected');
  // Removing only this UUID-namespaced directory cannot affect another user or
  // the server owner's legacy/default Claude login.
  await rm(claudeUserConfigDir(userId), { recursive: true, force: true });
  return normalizeClaudeStatus();
}

/**
 * Per-user ChatGPT/Codex subscription login broker.
 *
 * Codex's official device-auth flow is designed for a headless machine: the worker
 * starts `codex login --device-auth`, returns OpenAI's URL + one-time code to the
 * authenticated website user, and the CLI polls until OpenAI finishes the login.
 * Credentials are forced into a UUID-scoped CODEX_HOME using file storage so the OS
 * keychain cannot accidentally merge two ApplyPilot users.
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import { chmod, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const DEFAULT_ROOT = join(here, '..', 'backend', 'data', 'chatgpt-users');
const DEFAULT_CLI = join(here, 'node_modules', '.bin', 'codex');
const LOGIN_TTL_MS = 15 * 60_000;
const START_TIMEOUT_MS = 20_000;
const pending = new Map();
const FILE_AUTH_ARGS = ['-c', 'cli_auth_credentials_store="file"'];

export function chatgptUserConfigDir(userId, env = process.env) {
  if (typeof userId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId)) {
    throw new Error('A valid ApplyPilot user ID is required for ChatGPT credentials');
  }
  const root = (env.CHATGPT_USER_CONFIG_ROOT || '').trim() || DEFAULT_ROOT;
  return join(root, userId.toLowerCase());
}

function cliPath(env = process.env) {
  return (env.CHATGPT_CODEX_CLI_PATH || '').trim() || DEFAULT_CLI;
}

export function userChatGPTEnv(userId, env = process.env) {
  const next = { ...env };
  for (const key of ['OPENAI_API_KEY', 'CODEX_API_KEY', 'OPENAI_BASE_URL', 'OPENAI_API_BASE', 'CODEX_ACCESS_TOKEN']) {
    delete next[key];
  }
  next.CODEX_HOME = chatgptUserConfigDir(userId, env);
  next.BROWSER = '/usr/bin/false';
  return next;
}

function plain(value) {
  return String(value).replace(/\x1b\[[0-9;]*m/g, '');
}

export function extractChatGPTDeviceLogin(value) {
  const text = plain(value);
  const authorizationUrl = text.match(/https:\/\/auth\.openai\.com\/codex\/device\b[^\s]*/i)?.[0] || null;
  const code = text.match(/one-time code[\s\S]{0,240}?\b([A-Z0-9]{4,6}-[A-Z0-9]{4,6})\b/i)?.[1] || null;
  return { authorizationUrl, code };
}

export function normalizeChatGPTStatus(output = '') {
  const text = plain(output).trim();
  return {
    connected: /logged in using chatgpt/i.test(text),
    authMethod: /logged in using chatgpt/i.test(text) ? 'chatgpt' : 'none',
  };
}

export async function chatgptConnectionStatus(userId) {
  const dir = chatgptUserConfigDir(userId);
  if (!existsSync(dir)) return { ...normalizeChatGPTStatus(), pending: pending.has(userId) };
  try {
    const { stdout, stderr } = await execFileAsync(cliPath(), ['login', 'status', ...FILE_AUTH_ARGS], {
      env: userChatGPTEnv(userId),
      timeout: 15_000,
      maxBuffer: 128 * 1024,
    });
    return { ...normalizeChatGPTStatus(`${stdout}\n${stderr}`), pending: pending.has(userId) };
  } catch {
    return { ...normalizeChatGPTStatus(), pending: pending.has(userId) };
  }
}

function stopPending(userId) {
  const active = pending.get(userId);
  if (!active) return;
  clearTimeout(active.expiryTimer);
  pending.delete(userId);
  if (!active.child.killed) active.child.kill('SIGTERM');
}

export async function startChatGPTConnection(userId) {
  const status = await chatgptConnectionStatus(userId);
  if (status.connected) return { ...status, alreadyConnected: true };

  stopPending(userId);
  const configDir = chatgptUserConfigDir(userId);
  await mkdir(configDir, { recursive: true, mode: 0o700 });
  await chmod(configDir, 0o700);

  const child = spawn(cliPath(), ['login', '--device-auth', ...FILE_AUTH_ARGS], {
    env: userChatGPTEnv(userId),
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let settled = false;
  let resolveDevice;
  let rejectDevice;
  const devicePromise = new Promise((resolve, reject) => {
    resolveDevice = resolve;
    rejectDevice = reject;
  });
  const active = { child, expiryTimer: null };
  pending.set(userId, active);

  const capture = (chunk) => {
    output = (output + String(chunk)).slice(-16_000);
    const device = extractChatGPTDeviceLogin(output);
    if (device.authorizationUrl && device.code && !settled) {
      settled = true;
      resolveDevice(device);
    }
  };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  child.once('error', (error) => {
    if (!settled) {
      settled = true;
      rejectDevice(error);
    }
    stopPending(userId);
  });
  child.once('exit', (code) => {
    clearTimeout(active.expiryTimer);
    pending.delete(userId);
    if (!settled) {
      settled = true;
      rejectDevice(new Error(`ChatGPT device login exited before producing a code (${code ?? 'signal'})`));
    }
  });

  const startTimer = setTimeout(() => {
    if (!settled) {
      settled = true;
      rejectDevice(new Error('ChatGPT login did not produce a device code'));
      stopPending(userId);
    }
  }, START_TIMEOUT_MS);

  try {
    const device = await devicePromise;
    clearTimeout(startTimer);
    active.expiryTimer = setTimeout(() => stopPending(userId), LOGIN_TTL_MS);
    return {
      connected: false,
      pending: true,
      ...device,
      expiresInSeconds: LOGIN_TTL_MS / 1000,
    };
  } catch (error) {
    clearTimeout(startTimer);
    throw error;
  }
}

export async function disconnectChatGPTConnection(userId) {
  stopPending(userId);
  await rm(chatgptUserConfigDir(userId), { recursive: true, force: true });
  return { ...normalizeChatGPTStatus(), pending: false };
}

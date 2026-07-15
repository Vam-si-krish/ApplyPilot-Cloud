import test from 'node:test';
import assert from 'node:assert/strict';
import { chatgptUserConfigDir, extractChatGPTDeviceLogin, normalizeChatGPTStatus, userChatGPTEnv } from './chatgptConnection.js';

const USER = '00000000-0000-4000-8000-000000000002';

test('ChatGPT config paths and subprocess credentials are isolated by user UUID', () => {
  assert.equal(chatgptUserConfigDir(USER, { CHATGPT_USER_CONFIG_ROOT: '/private/chatgpt' }), `/private/chatgpt/${USER}`);
  const env = userChatGPTEnv(USER, {
    CHATGPT_USER_CONFIG_ROOT: '/private/chatgpt', OPENAI_API_KEY: 'paid', CODEX_API_KEY: 'paid2', CODEX_ACCESS_TOKEN: 'paid3', PATH: '/bin',
  });
  assert.equal(env.CODEX_HOME, `/private/chatgpt/${USER}`);
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.CODEX_API_KEY, undefined);
  assert.equal(env.CODEX_ACCESS_TOKEN, undefined);
  assert.equal(env.PATH, '/bin');
});

test('extracts the official OpenAI device URL and one-time code from ANSI output', () => {
  const output = `Open \u001b[94mhttps://auth.openai.com/codex/device\u001b[0m\nEnter this one-time code (expires soon)\n\u001b[94mAB12-C3DEF\u001b[0m`;
  assert.deepEqual(extractChatGPTDeviceLogin(output), {
    authorizationUrl: 'https://auth.openai.com/codex/device', code: 'AB12-C3DEF',
  });
});

test('recognizes only ChatGPT login status', () => {
  assert.equal(normalizeChatGPTStatus('Logged in using ChatGPT').connected, true);
  assert.equal(normalizeChatGPTStatus('Logged in using an API key').connected, false);
});

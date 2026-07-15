import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCodexPrompt, normalizeUsage, subscriptionEnv } from './chatgptClient.js';

test('buildCodexPrompt keeps stable system blocks before the volatile job', () => {
  const prompt = buildCodexPrompt([
    { role: 'system', content: 'rubric' },
    { role: 'system', content: [{ text: 'resume', cache: true }] },
    { role: 'user', content: 'job A' },
  ], 1000);
  assert.ok(prompt.indexOf('rubric') < prompt.indexOf('resume'));
  assert.ok(prompt.indexOf('resume') < prompt.indexOf('job A'));
  assert.match(prompt, /roughly 1000 output tokens/);
});

test('normalizeUsage separates OpenAI cached tokens from uncached input', () => {
  assert.deepEqual(
    normalizeUsage({ input_tokens: 5000, cached_input_tokens: 4000, output_tokens: 500, reasoning_output_tokens: 100 }, 'gpt-5.4', 123),
    {
      input_tokens: 1000,
      output_tokens: 500,
      cache_read_input_tokens: 4000,
      cache_creation_input_tokens: 0,
      reasoning_output_tokens: 100,
      cost_usd: null,
      model: 'gpt-5.4',
      ms: 123,
    },
  );
});

test('subscriptionEnv strips API billing credentials and isolates CODEX_HOME', () => {
  const env = subscriptionEnv({
    HOME: '/Users/tester',
    PATH: '/usr/bin',
    OPENAI_API_KEY: 'must-not-pass',
    CODEX_API_KEY: 'must-not-pass',
    CODEX_ACCESS_TOKEN: 'must-not-pass',
    OPENAI_BASE_URL: 'https://paid.example',
    CHATGPT_CODEX_HOME: '~/.applypilot-codex',
  });
  assert.equal(env.OPENAI_API_KEY, undefined);
  assert.equal(env.CODEX_API_KEY, undefined);
  assert.equal(env.CODEX_ACCESS_TOKEN, undefined);
  assert.equal(env.OPENAI_BASE_URL, undefined);
  assert.equal(env.CODEX_HOME, '/Users/tester/.applypilot-codex');
  assert.equal(env.PATH, '/usr/bin');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeUserConfigDir, extractClaudeAuthorizationUrl, normalizeClaudeStatus } from './claudeConnection.js';

test('Claude config paths are isolated by user UUID', () => {
  const env = { CLAUDE_USER_CONFIG_ROOT: '/private/claude-users' };
  assert.equal(claudeUserConfigDir('00000000-0000-4000-8000-000000000002', env),
    '/private/claude-users/00000000-0000-4000-8000-000000000002');
  assert.notEqual(
    claudeUserConfigDir('00000000-0000-4000-8000-000000000002', env),
    claudeUserConfigDir('00000000-0000-4000-8000-000000000003', env),
  );
});

test('extracts the official Claude authorization URL from terminal output', () => {
  const url = 'https://claude.com/cai/oauth/authorize?code=true&state=abc';
  assert.equal(extractClaudeAuthorizationUrl(`If the browser did not open: ${url}\nPaste code >`), url);
  assert.equal(extractClaudeAuthorizationUrl(`\x1b]8;;${url}\x07${url}\x1b]8;;\x07`), url);
  assert.equal(extractClaudeAuthorizationUrl('no link here'), null);
});

test('recognizes Claude subscription auth without accepting an API-key session', () => {
  assert.equal(normalizeClaudeStatus({ loggedIn: true, authMethod: 'claude.ai' }).connected, true);
  assert.equal(normalizeClaudeStatus({ loggedIn: true, authMethod: 'oauth' }).connected, true);
  assert.equal(normalizeClaudeStatus({ loggedIn: true, authMethod: 'api_key' }).connected, false);
  assert.equal(normalizeClaudeStatus({ loggedIn: false, authMethod: 'claude.ai' }).connected, false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const backend = dirname(fileURLToPath(import.meta.url));
const script = join(backend, 'scripts', 'remote-control.sh');

function run(command) {
  return spawnSync(script, [], {
    encoding: 'utf8',
    env: {
      ...process.env,
      JOBPILOT_REMOTE_CONTROL_LOCAL_TEST: '1',
      SSH_ORIGINAL_COMMAND: command,
    },
  });
}

test('remote control documents only its bounded command surface', () => {
  const result = run('help');
  assert.equal(result.status, 0);
  assert.match(result.stdout, /deploy <7-40 character git commit>/);
  assert.match(result.stdout, /restart all\|backend\|worker\|rest/);
  assert.doesNotMatch(result.stdout, /shell/i);
});

test('remote control rejects shell syntax and unapproved commands without evaluating them', () => {
  for (const command of ['deploy abc1234; id', 'logs backend 501', 'bash', 'status\nbackup']) {
    const result = run(command);
    assert.equal(result.status, 64, command);
    assert.match(result.stderr, /refused/i);
  }
});

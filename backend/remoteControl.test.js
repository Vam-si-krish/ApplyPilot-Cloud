import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
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
  assert.match(result.stdout, /repair-funnel/);
  assert.doesNotMatch(result.stdout, /shell/i);
});

test('Funnel repair is bounded to the selected instance path and externally verified', () => {
  const remoteControl = readFileSync(script, 'utf8');
  const watchdog = readFileSync(join(backend, 'scripts', 'watchdog.sh'), 'utf8');
  const publicCheck = readFileSync(join(backend, 'scripts', 'check-public-funnel.sh'), 'utf8');
  assert.match(remoteControl, /repair-funnel\)/);
  assert.match(remoteControl, /--set-path "\/\$\{APP_PATH\}"/);
  assert.match(watchdog, /check-public-funnel\.sh/);
  assert.match(publicCheck, /dig @8\.8\.8\.8/);
  assert.match(publicCheck, /curl .*--resolve/);
});

test('remote control rejects shell syntax and unapproved commands without evaluating them', () => {
  for (const command of ['deploy abc1234; id', 'production logs backend 501', 'bash', 'production status\nbackup']) {
    const result = run(command);
    assert.equal(result.status, 64, command);
    assert.match(result.stderr, /refused/i);
  }
});

test('deploy uses login-shell reconciliation after a partial checkout update', () => {
  const remoteControl = readFileSync(script, 'utf8');
  const autopull = readFileSync(join(backend, 'scripts', 'autopull.sh'), 'utf8');
  assert.match(remoteControl, /\/bin\/zsh -lc .*--reconcile/);
  assert.match(autopull, /RECONCILE/);
  assert.match(autopull, /reconciling/);
});

test('remote control requires an explicit allowlisted environment target', () => {
  assert.equal(run('staging status').status, 64);
  assert.equal(run('production help').status, 0);
  assert.equal(run('development help').status, 0);
});

test('development provisioning is a single bounded commit-addressed command', () => {
  const remoteControl = readFileSync(script, 'utf8');
  assert.match(remoteControl, /provision-development <7-40 character git commit>/);
  assert.match(remoteControl, /provision-development \[0-9a-f\]/);
  assert.doesNotMatch(remoteControl, /^\s*eval\b/m);
});

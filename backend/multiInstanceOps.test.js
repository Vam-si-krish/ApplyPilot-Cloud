import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backend = dirname(fileURLToPath(import.meta.url));
const read = (path) => readFileSync(join(backend, path), 'utf8');

test('runtime operations derive mutable identities from the protected instance environment', () => {
  assert.match(read('docker-compose.yml'), /container_name: \$\{APP_NAME:-jobpilotmulti\}-rest/);
  assert.match(read('scripts/autopull.sh'), /\/tmp\/\$\{APP_NAME\}-autopull\.lock/);
  assert.match(read('scripts/autopull.sh'), /com\.\$\{APP_NAME\}\.backend/);
  assert.match(read('scripts/watchdog.sh'), /com\.\$\{APP_NAME\}\.worker/);
  assert.match(read('scripts/install-launchd.sh'), /com\.\$\{APP_NAME\}/);
});

test('development provisioner uses only the ADR 0089 resource allocation', () => {
  const script = read('scripts/provision-development.sh');
  for (const expected of [
    'jobpilot_multi_dev', 'jobpilot_multi_dev_app', 'jobpilotdev',
    '8241', '8242', '8243', 'jobpilot-dev', 'develop',
  ]) assert.match(script, new RegExp(expected));
  assert.doesNotMatch(script, /DB_NAME=jobpilot_multi\n/);
  assert.doesNotMatch(script, /APP_NAME=jobpilotmulti\n/);
});

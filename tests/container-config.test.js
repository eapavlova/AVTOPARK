import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('container runs as node with writable persistent application directories', async () => {
  const dockerfile = await readFile(new URL('../Dockerfile', import.meta.url), 'utf8');
  const chownPosition = dockerfile.indexOf('chown -R node:node /app');
  const userPosition = dockerfile.indexOf('USER node');

  assert.ok(chownPosition >= 0 && chownPosition < userPosition);
  assert.match(dockerfile, /mkdir -p \/app\/data\/files/i);
  assert.match(dockerfile, /HEALTHCHECK[\s\S]*\/api\/ready/i);
});

test('production compose requires secrets and keeps state in persistent volumes', async () => {
  const compose = await readFile(new URL('../docker-compose.production.yml', import.meta.url), 'utf8');

  assert.match(compose, /AUTH_MODE: bitrix/i);
  assert.match(compose, /SEED_DEMO_DATA: "false"/i);
  assert.match(compose, /BITRIX_CLIENT_SECRET: \$\{BITRIX_CLIENT_SECRET:\?/i);
  assert.match(compose, /POSTGRES_PASSWORD: \$\{POSTGRES_PASSWORD:\?/i);
  assert.match(compose, /"127\.0\.0\.1:3000:3000"/i);
  assert.match(compose, /autopark_files:\/app\/data\/files/i);
  assert.match(compose, /autopark_postgres_data:\/var\/lib\/postgresql\/data/i);
  assert.match(compose, /\/api\/ready/i);

  const postgresSection = compose.split(/^  postgres:/m)[1].split(/^volumes:/m)[0];
  assert.doesNotMatch(postgresSection, /^    ports:/m);
});

test('production backup captures PostgreSQL including encrypted Bitrix data and attachments', async () => {
  const script = await readFile(new URL('../scripts/backup-production.sh', import.meta.url), 'utf8');

  assert.match(script, /compose stop app/i);
  assert.match(script, /pg_dump[\s\S]*--format=custom/i);
  assert.match(script, /\/app\/data\/files/i);
  assert.match(script, /sha256sum/i);
  assert.match(script, /trap restart_app/i);
});

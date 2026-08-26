import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectDir = dirname(dirname(fileURLToPath(import.meta.url)));

test('HTTP API protects the complete waybill attachment lifecycle', { timeout: 20_000 }, async () => {
  const tempRoot = await mkdtemp(join(tmpdir(), 'autopark-http-'));
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: projectDir,
    env: {
      ...process.env,
      PORT: '0',
      AUTH_MODE: 'local',
      STORAGE_DRIVER: 'json',
      DATA_FILE: join(tempRoot, 'state.json'),
      FILE_STORAGE_DIR: join(tempRoot, 'files'),
      DATABASE_URL: '',
      BITRIX_CLIENT_ID: '',
      BITRIX_CLIENT_SECRET: '',
      BITRIX_TOKEN_ENCRYPTION_KEY: ''
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  try {
    const baseUrl = await waitForServer(child);
    const driverHeaders = { 'x-autopark-user-id': 'u-driver-1' };
    const accountantHeaders = { 'x-autopark-user-id': 'u-accountant-1' };
    const otherDriverHeaders = { 'x-autopark-user-id': 'u-driver-2' };

    const ready = await fetch(`${baseUrl}/api/ready`);
    assert.equal(ready.status, 200);
    assert.deepEqual(await ready.json(), { status: 'ready' });

    const created = await jsonRequest(`${baseUrl}/api/waybills`, {
      method: 'POST',
      headers: driverHeaders,
      body: {
        driverId: 'u-driver-1',
        vehicleId: 'veh-1',
        waybillDate: '2026-08-26',
        distanceKm: 12,
        fuelAdded: 2,
        fuelSpent: 3,
        note: 'HTTP test'
      }
    });
    const waybill = created.waybills.find((item) => item.waybillDate === '2026-08-26');
    assert.ok(waybill);

    const source = Buffer.from('%PDF-1.7');
    const uploadedResponse = await fetch(`${baseUrl}/api/waybills/${waybill.id}/files`, {
      method: 'POST',
      headers: {
        ...driverHeaders,
        'content-type': 'application/pdf',
        'x-file-name': encodeURIComponent('Чек API.pdf')
      },
      body: source
    });
    assert.equal(uploadedResponse.status, 200);
    const uploaded = await uploadedResponse.json();
    const file = uploaded.waybillFiles.find((item) => item.waybillId === waybill.id);
    assert.equal(file.originalName, 'Чек API.pdf');
    assert.doesNotMatch(JSON.stringify(uploaded), /storageKey/);

    for (const headers of [driverHeaders, accountantHeaders]) {
      const download = await fetch(`${baseUrl}/api/waybill-files/${file.id}`, { headers });
      assert.equal(download.status, 200);
      assert.equal(download.headers.get('content-type'), 'application/octet-stream');
      assert.deepEqual(Buffer.from(await download.arrayBuffer()), source);
    }
    const hidden = await fetch(`${baseUrl}/api/waybill-files/${file.id}`, { headers: otherDriverHeaders });
    assert.equal(hidden.status, 404);

    const removed = await jsonRequest(`${baseUrl}/api/waybill-files/${file.id}`, {
      method: 'DELETE',
      headers: driverHeaders
    });
    assert.equal(removed.waybillFiles.some((item) => item.id === file.id), false);

    await jsonRequest(`${baseUrl}/api/waybills/${waybill.id}/status`, {
      method: 'PATCH',
      headers: driverHeaders,
      body: { status: 'ACCOUNTING_REVIEW' }
    });
    const forbidden = await fetch(`${baseUrl}/api/waybills/${waybill.id}/files`, {
      method: 'POST',
      headers: {
        ...driverHeaders,
        'content-type': 'application/pdf',
        'x-file-name': encodeURIComponent('После отправки.pdf')
      },
      body: source
    });
    assert.equal(forbidden.status, 422);
    assert.match((await forbidden.json()).error, /статусе нельзя изменять/i);
  } finally {
    await stopChild(child);
    await rm(tempRoot, { recursive: true, force: true });
  }
});

async function jsonRequest(url, { body, headers = {}, ...options }) {
  const response = await fetch(url, {
    ...options,
    headers: { ...headers, 'content-type': 'application/json; charset=utf-8' },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const payload = await response.json();
  assert.equal(response.status, 200, payload.error);
  return payload;
}

function waitForServer(child) {
  return new Promise((resolve, reject) => {
    let stderr = '';
    const timer = setTimeout(() => reject(new Error(`Сервер не запустился. ${stderr}`)), 8_000);
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`Сервер завершился до запуска с кодом ${code}. ${stderr}`));
    });
    child.stdout.on('data', (chunk) => {
      const match = chunk.toString().match(/Autopark is running at (http:\/\/[^\s]+)/);
      if (!match) return;
      clearTimeout(timer);
      resolve(match[1]);
    });
  });
}

async function stopChild(child) {
  if (child.exitCode !== null) return;
  const exited = new Promise((resolve) => child.once('exit', resolve));
  child.kill('SIGTERM');
  await Promise.race([
    exited,
    new Promise((resolve) => setTimeout(resolve, 3_000))
  ]);
  if (child.exitCode === null) {
    child.kill('SIGKILL');
    await exited;
  }
}

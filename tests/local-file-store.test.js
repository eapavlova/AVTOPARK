import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { LocalFileStore } from '../src/files/local-file-store.js';

test('local file store uses opaque keys and removes stored content', async () => {
  const root = await mkdtemp(join(tmpdir(), 'autopark-files-'));
  try {
    const store = new LocalFileStore(root);
    const source = Buffer.from('waybill receipt');
    const storageKey = await store.put(source);

    assert.match(storageKey, /^[0-9a-f-]{36}$/i);
    assert.deepEqual(await store.read(storageKey), source);

    await store.remove(storageKey);
    await assert.rejects(store.read(storageKey), { code: 'ENOENT' });
    await assert.rejects(store.read('../outside'), /внутренний ключ/i);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

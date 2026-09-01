import test from 'node:test';
import assert from 'node:assert/strict';
import { createStore, databaseSslFrom } from '../src/store-factory.js';

test('PostgreSQL is mandatory for the application store', async () => {
  await assert.rejects(createStore({}), /только PostgreSQL/i);
});

test('database SSL mode is explicitly validated', () => {
  assert.equal(databaseSslFrom({ DATABASE_SSL: 'disable' }), undefined);
  assert.deepEqual(databaseSslFrom({ DATABASE_SSL: 'require' }), { rejectUnauthorized: false });
  assert.deepEqual(databaseSslFrom({ DATABASE_SSL: 'verify-full' }), { rejectUnauthorized: true });
  assert.throws(() => databaseSslFrom({ DATABASE_SSL: 'unexpected' }), /DATABASE_SSL/);
});

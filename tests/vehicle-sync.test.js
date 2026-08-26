import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendPlannedVehicleSyncs,
  BitrixVehicleSyncDispatcher,
  buildVehicleFields,
  vehicleSyncConfigFrom
} from '../src/integrations/bitrix24/vehicle-sync.js';

test('vehicle changes create a durable Bitrix24 synchronization item', () => {
  const previous = portalState();
  const next = {
    ...previous,
    auditLog: [{
      id: 'audit-1', actorId: 'admin-1', action: 'VEHICLE_REFERENCE_UPDATED',
      payload: { vehicleId: 'vehicle-1' }, createdAt: '2026-08-26T12:00:00.000Z'
    }]
  };

  const queued = appendPlannedVehicleSyncs(previous, next);
  assert.equal(queued.vehicleSyncs.length, 1);
  assert.equal(queued.vehicleSyncs[0].vehicleId, 'vehicle-1');
  assert.equal(queued.vehicleSyncs[0].status, 'PENDING');
  assert.equal(queued.counters.vehicleSync, 1);
});

test('vehicle sync resolves a rejected transfer through its transfer id', () => {
  const previous = portalState();
  previous.transfers = [{ id: 'transfer-1', vehicleId: 'vehicle-1' }];
  const next = {
    ...previous,
    auditLog: [{
      id: 'audit-2', actorId: 'driver-1', action: 'TRANSFER_REJECTED',
      payload: { transferId: 'transfer-1', reason: 'Не готов принять' },
      createdAt: '2026-08-26T12:00:00.000Z'
    }]
  };

  const queued = appendPlannedVehicleSyncs(previous, next);
  assert.equal(queued.vehicleSyncs.length, 1);
  assert.equal(queued.vehicleSyncs[0].vehicleId, 'vehicle-1');
});

test('vehicle field mapping builds a readable title and configured custom fields', () => {
  const state = portalState();
  const fields = buildVehicleFields(state, state.vehicles[0], {
    plateNumber: 'ufCrm10_100',
    status: 'ufCrm10_101',
    currentDriverBitrixUserId: 'ufCrm10_102'
  });

  assert.deepEqual(fields, {
    title: 'А123АА 77 · Лада Гранта',
    ufCrm10_100: 'А123АА 77',
    ufCrm10_101: 'Закреплен',
    ufCrm10_102: 101
  });
});

test('vehicle sync configuration validates entity type and field map', () => {
  assert.deepEqual(vehicleSyncConfigFrom({}), { entityTypeId: null, fieldMap: {} });
  assert.deepEqual(vehicleSyncConfigFrom({
    BITRIX_VEHICLE_ENTITY_TYPE_ID: '1302',
    BITRIX_VEHICLE_FIELD_MAP: '{"plateNumber":"ufCrm10_100"}'
  }), { entityTypeId: 1302, fieldMap: { plateNumber: 'ufCrm10_100' } });
  assert.throws(() => vehicleSyncConfigFrom({ BITRIX_VEHICLE_ENTITY_TYPE_ID: 'abc' }), /положительным/i);
  assert.throws(() => vehicleSyncConfigFrom({
    BITRIX_VEHICLE_ENTITY_TYPE_ID: '1302', BITRIX_VEHICLE_FIELD_MAP: '{bad json}'
  }), /корректный JSON/i);
});

test('vehicle sync dispatcher creates the card and stores its Bitrix24 id', async () => {
  const state = portalState();
  state.vehicleSyncs = [{
    id: 'vehicle-sync-1', portalId: 'member-1', vehicleId: 'vehicle-1', eventType: 'VEHICLE_CREATED',
    status: 'PENDING', attempts: 0, lastError: null, createdAt: '2026-08-26T12:00:00.000Z', syncedAt: null
  }];
  const store = new MemoryStore(state);
  const calls = [];
  const dispatcher = new BitrixVehicleSyncDispatcher({
    store,
    bitrix24: {
      async upsertVehicle(...args) {
        calls.push(args);
        return 777;
      }
    },
    config: { entityTypeId: 1302, fieldMap: { plateNumber: 'ufCrm10_100' } },
    logger: silentLogger()
  });

  await dispatcher.dispatchPortal('member-1');

  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], 'member-1');
  assert.equal(calls[0][1].entityTypeId, 1302);
  assert.equal(calls[0][1].itemId, null);
  assert.equal(calls[0][1].fields.ufCrm10_100, 'А123АА 77');
  assert.equal(store.state.vehicles[0].bitrixItemId, 777);
  assert.equal(store.state.vehicleSyncs[0].status, 'SENT');
  assert.equal(store.state.vehicleSyncs[0].attempts, 1);
});

class MemoryStore {
  constructor(state) { this.state = state; }
  async load() { return this.state; }
  async update(mutator) {
    this.state = await mutator(this.state);
    return this.state;
  }
}

function portalState() {
  return {
    users: [
      { id: 'driver-1', portalId: 'member-1', bitrixUserId: 101, name: 'Иван', role: 'DRIVER' },
      { id: 'admin-1', portalId: 'member-1', bitrixUserId: 301, name: 'Администратор', role: 'ADMIN' }
    ],
    vehicles: [{
      id: 'vehicle-1', portalId: 'member-1', plateNumber: 'А123АА 77', title: 'Лада Гранта',
      status: 'ASSIGNED', currentDriverId: 'driver-1', startOdometer: 100, startFuel: 20,
      startAt: '2026-08-01', bitrixItemId: null
    }],
    auditLog: [],
    vehicleSyncs: [],
    counters: { vehicleSync: 0 }
  };
}

function silentLogger() {
  return { error() {}, warn() {} };
}

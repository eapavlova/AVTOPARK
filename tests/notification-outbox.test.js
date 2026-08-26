import test from 'node:test';
import assert from 'node:assert/strict';
import {
  appendPlannedNotifications,
  BitrixNotificationDispatcher
} from '../src/integrations/bitrix24/notification-outbox.js';

test('transfer notification is queued for the receiving Bitrix24 user', () => {
  const previous = portalState();
  const next = {
    ...previous,
    auditLog: [{
      id: 'audit-1',
      actorId: 'driver-1',
      action: 'TRANSFER_INITIATED',
      payload: { transferId: 'transfer-1', vehicleId: 'vehicle-1' },
      createdAt: '2026-08-26T12:00:00.000Z'
    }]
  };

  const queued = appendPlannedNotifications(previous, next);
  assert.equal(queued.notifications.length, 1);
  assert.equal(queued.notifications[0].bitrixUserId, 102);
  assert.equal(queued.notifications[0].portalId, 'member-1');
  assert.equal(queued.notifications[0].status, 'PENDING');
  assert.match(queued.notifications[0].message, /А123АА 77/);
});

test('accounting review notification is queued for accountant and administrator', () => {
  const previous = portalState();
  const next = {
    ...previous,
    auditLog: [{
      id: 'audit-2',
      actorId: 'driver-1',
      action: 'WAYBILL_STATUS_CHANGED',
      payload: { waybillId: 'waybill-1', status: 'ACCOUNTING_REVIEW' },
      createdAt: '2026-08-26T12:00:00.000Z'
    }]
  };

  const queued = appendPlannedNotifications(previous, next);
  assert.deepEqual(queued.notifications.map((item) => item.bitrixUserId).sort(), [201, 301]);
});

test('dispatcher sends queued notification and marks it delivered', async () => {
  const store = new MemoryStore(withPendingNotification());
  const calls = [];
  const dispatcher = new BitrixNotificationDispatcher({
    store,
    bitrix24: {
      async notify(...args) { calls.push(args); }
    },
    logger: silentLogger()
  });

  await dispatcher.dispatchPortal('member-1');

  assert.deepEqual(calls, [['member-1', 102, 'Тестовое уведомление', 'autopark:test:1']]);
  assert.equal(store.state.notifications[0].status, 'SENT');
  assert.equal(store.state.notifications[0].attempts, 1);
  assert.ok(store.state.notifications[0].sentAt);
});

test('dispatcher preserves a failed notification for a later retry', async () => {
  const store = new MemoryStore(withPendingNotification());
  const dispatcher = new BitrixNotificationDispatcher({
    store,
    bitrix24: {
      async notify() { throw new Error('Bitrix24 temporarily unavailable'); }
    },
    logger: silentLogger()
  });

  await dispatcher.dispatchPortal('member-1');

  assert.equal(store.state.notifications[0].status, 'PENDING');
  assert.equal(store.state.notifications[0].attempts, 1);
  assert.match(store.state.notifications[0].lastError, /temporarily unavailable/);
});

class MemoryStore {
  constructor(state) {
    this.state = state;
  }

  async load() {
    return this.state;
  }

  async update(mutator) {
    this.state = await mutator(this.state);
    return this.state;
  }
}

function portalState() {
  return {
    users: [
      { id: 'driver-1', portalId: 'member-1', bitrixUserId: 101, name: 'Иван', role: 'DRIVER' },
      { id: 'driver-2', portalId: 'member-1', bitrixUserId: 102, name: 'Мария', role: 'DRIVER' },
      { id: 'accountant-1', portalId: 'member-1', bitrixUserId: 201, name: 'Бухгалтер', role: 'ACCOUNTANT' },
      { id: 'admin-1', portalId: 'member-1', bitrixUserId: 301, name: 'Администратор', role: 'ADMIN' }
    ],
    vehicles: [{ id: 'vehicle-1', portalId: 'member-1', plateNumber: 'А123АА 77', title: 'Лада Гранта' }],
    transfers: [{
      id: 'transfer-1', vehicleId: 'vehicle-1', fromDriverId: 'driver-1', toDriverId: 'driver-2'
    }],
    waybills: [{
      id: 'waybill-1', vehicleId: 'vehicle-1', driverId: 'driver-1', waybillDate: '2026-08-26'
    }],
    auditLog: [],
    notifications: [],
    counters: { notification: 0 }
  };
}

function withPendingNotification() {
  return {
    notifications: [{
      id: 'notification-1',
      portalId: 'member-1',
      bitrixUserId: 102,
      eventType: 'TEST',
      message: 'Тестовое уведомление',
      tag: 'autopark:test:1',
      status: 'PENDING',
      attempts: 0,
      lastError: null,
      createdAt: '2026-08-26T12:00:00.000Z',
      sentAt: null
    }]
  };
}

function silentLogger() {
  return { error() {}, warn() {} };
}

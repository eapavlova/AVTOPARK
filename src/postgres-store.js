import pg from 'pg';
import { createEmptyState, createInitialState, seedDemoState } from './domain.js';
import { runMigrations } from './db/migrate.js';

const { Pool } = pg;

export class PostgresStore {
  static async connect({ connectionString, seedDemo = false }) {
    const pool = new Pool({
      connectionString,
      max: 10,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000
    });
    await runMigrations(pool);
    const store = new PostgresStore(pool);
    await store.ensureInitialized(seedDemo);
    return store;
  }

  constructor(pool) {
    this.pool = pool;
  }

  async ensureInitialized(useDemoData) {
    const result = await this.pool.query('select 1 from app_metadata where singleton = true');
    if (result.rowCount > 0) return;
    const initial = useDemoData ? seedDemoState() : createEmptyState();
    await this.replace(initial);
  }

  async load() {
    const client = await this.pool.connect();
    try {
      await client.query('begin isolation level repeatable read read only');
      const state = await loadState(client);
      await client.query('commit');
      return state;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async update(mutator) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("select pg_advisory_xact_lock(hashtext('autopark_domain_state'))");
      await client.query("set local statement_timeout = '10s'");
      const current = await loadState(client);
      const next = await mutator(current);
      await syncState(client, next);
      await client.query('commit');
      return next;
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async reset() {
    const state = createInitialState();
    await this.replace(state);
    return state;
  }

  async replace(state) {
    const client = await this.pool.connect();
    try {
      await client.query('begin');
      await client.query("select pg_advisory_xact_lock(hashtext('autopark_domain_state'))");
      await client.query('truncate vehicle_sync_outbox, notification_outbox, audit_log, waybill_files, transfer_files, waybill_revisions, waybills, vehicle_transfers, assignments, vehicles, users, app_counters, app_metadata');
      await syncState(client, state);
      await client.query('commit');
    } catch (error) {
      await client.query('rollback');
      throw error;
    } finally {
      client.release();
    }
  }

  async close() {
    await this.pool.end();
  }
}

async function loadState(client) {
  const metadata = await client.query('select created_at, updated_at from app_metadata where singleton = true');
  if (metadata.rowCount === 0) return createEmptyState();

  const users = await client.query('select id, portal_id, bitrix_user_id, name, role from users order by id');
  const vehicles = await client.query('select * from vehicles order by id');
  const assignments = await client.query('select * from assignments order by start_at, id');
  const transfers = await client.query('select * from vehicle_transfers order by created_at, id');
  const waybills = await client.query('select * from waybills order by waybill_date, created_at, id');
  const waybillRevisions = await client.query('select * from waybill_revisions order by created_at, id');
  const waybillFiles = await client.query('select * from waybill_files order by created_at, id');
  const transferFiles = await client.query('select * from transfer_files order by created_at, id');
  const notifications = await client.query('select * from notification_outbox order by created_at, id');
  const vehicleSyncs = await client.query('select * from vehicle_sync_outbox order by created_at, id');
  const audit = await client.query('select * from audit_log order by created_at desc, id desc');
  const counters = await client.query('select name, value from app_counters');

  return {
    meta: {
      createdAt: toIso(metadata.rows[0].created_at),
      updatedAt: toIso(metadata.rows[0].updated_at)
    },
    users: users.rows.map((row) => ({
      id: row.id,
      portalId: row.portal_id,
      bitrixUserId: row.bitrix_user_id === null ? null : Number(row.bitrix_user_id),
      name: row.name,
      role: row.role
    })),
    vehicles: vehicles.rows.map((row) => ({
      id: row.id,
      portalId: row.portal_id,
      plateNumber: row.plate_number,
      title: row.title,
      status: row.status,
      currentDriverId: row.current_driver_id,
      startOdometer: Number(row.start_odometer),
      startFuel: Number(row.start_fuel),
      startAt: toDate(row.start_at),
      startRecordedBy: row.start_recorded_by,
      startRecordedAt: toIso(row.start_recorded_at),
      soldAt: row.sold_at ? toDate(row.sold_at) : null,
      bitrixItemId: row.bitrix_item_id === null ? null : Number(row.bitrix_item_id)
    })),
    assignments: assignments.rows.map((row) => ({
      id: row.id,
      vehicleId: row.vehicle_id,
      driverId: row.driver_id,
      startAt: toIso(row.start_at),
      endAt: row.end_at ? toIso(row.end_at) : null
    })),
    transfers: transfers.rows.map((row) => ({
      id: row.id,
      type: row.type,
      status: row.status,
      vehicleId: row.vehicle_id,
      fromDriverId: row.from_driver_id,
      toDriverId: row.to_driver_id,
      createdBy: row.created_by,
      createdAt: toIso(row.created_at),
      resolvedAt: row.resolved_at ? toIso(row.resolved_at) : null,
      reason: row.reason,
      handover: row.handover
    })),
    waybills: waybills.rows.map((row) => ({
      id: row.id,
      vehicleId: row.vehicle_id,
      driverId: row.driver_id,
      waybillDate: toDate(row.waybill_date),
      createdAt: toIso(row.created_at),
      status: row.status,
      distanceKm: Number(row.distance_km),
      reportedEndOdometer: nullableNumber(row.reported_end_odometer),
      fuelAdded: Number(row.fuel_added),
      fuelSpent: Number(row.fuel_spent),
      reportedEndFuel: nullableNumber(row.reported_end_fuel),
      startOdometer: nullableNumber(row.start_odometer),
      endOdometer: nullableNumber(row.end_odometer),
      startFuel: nullableNumber(row.start_fuel),
      endFuel: nullableNumber(row.end_fuel),
      route: row.route,
      note: row.note
    })),
    waybillRevisions: waybillRevisions.rows.map((row) => ({
      id: row.id,
      waybillId: row.waybill_id,
      actorId: row.actor_id,
      waybillStatus: row.waybill_status,
      before: row.before_data,
      after: row.after_data,
      createdAt: toIso(row.created_at)
    })),
    waybillFiles: waybillFiles.rows.map((row) => ({
      id: row.id,
      waybillId: row.waybill_id,
      uploadedBy: row.uploaded_by,
      originalName: row.original_name,
      mimeType: row.mime_type,
      sizeBytes: Number(row.size_bytes),
      storageKey: row.storage_key,
      createdAt: toIso(row.created_at)
    })),
    transferFiles: transferFiles.rows.map((row) => ({ id: row.id, transferId: row.transfer_id, uploadedBy: row.uploaded_by, category: row.category, originalName: row.original_name, mimeType: row.mime_type, sizeBytes: Number(row.size_bytes), storageKey: row.storage_key, createdAt: toIso(row.created_at) })),
    notifications: notifications.rows.map((row) => ({
      id: row.id,
      portalId: row.portal_id,
      bitrixUserId: Number(row.bitrix_user_id),
      eventType: row.event_type,
      message: row.message,
      tag: row.tag,
      status: row.status,
      attempts: row.attempts,
      lastError: row.last_error,
      createdAt: toIso(row.created_at),
      sentAt: row.sent_at ? toIso(row.sent_at) : null
    })),
    vehicleSyncs: vehicleSyncs.rows.map((row) => ({
      id: row.id,
      portalId: row.portal_id,
      vehicleId: row.vehicle_id,
      eventType: row.event_type,
      status: row.status,
      attempts: row.attempts,
      lastError: row.last_error,
      createdAt: toIso(row.created_at),
      syncedAt: row.synced_at ? toIso(row.synced_at) : null
    })),
    auditLog: audit.rows.map((row) => ({
      id: row.id,
      actorId: row.actor_id,
      action: row.action,
      payload: row.payload,
      createdAt: toIso(row.created_at)
    })),
    counters: Object.fromEntries(counters.rows.map((row) => [row.name, Number(row.value)]))
  };
}

async function syncState(client, state) {
  await upsertRows(client, 'app_metadata', ['singleton', 'created_at', 'updated_at'], [[true, state.meta.createdAt, state.meta.updatedAt]], ['singleton']);
  await upsertRows(client, 'app_counters', ['name', 'value'], Object.entries(state.counters), ['name']);
  await upsertRows(client, 'users', ['id', 'portal_id', 'bitrix_user_id', 'name', 'role'], state.users.map((user) => [
    user.id, user.portalId ?? 'local', user.bitrixUserId ?? null, user.name, user.role
  ]));
  await upsertRows(client, 'vehicles', [
    'id', 'portal_id', 'plate_number', 'title', 'status', 'current_driver_id', 'start_odometer', 'start_fuel',
    'start_at', 'start_recorded_by', 'start_recorded_at', 'sold_at', 'bitrix_item_id'
  ], state.vehicles.map((vehicle) => [
    vehicle.id, vehicle.portalId ?? 'local', vehicle.plateNumber, vehicle.title, vehicle.status,
    vehicle.currentDriverId, vehicle.startOdometer, vehicle.startFuel, vehicle.startAt, vehicle.startRecordedBy,
    vehicle.startRecordedAt, vehicle.soldAt ?? null, vehicle.bitrixItemId
  ]));
  const assignmentRows = state.assignments.map((assignment) => [
    assignment.id, assignment.vehicleId, assignment.driverId, assignment.startAt, assignment.endAt
  ]);
  await upsertRows(client, 'assignments', ['id', 'vehicle_id', 'driver_id', 'start_at', 'end_at'], assignmentRows.filter((row) => row[4] !== null));
  await upsertRows(client, 'assignments', ['id', 'vehicle_id', 'driver_id', 'start_at', 'end_at'], assignmentRows.filter((row) => row[4] === null));
  const transferRows = state.transfers.map((transfer) => [
    transfer.id, transfer.type, transfer.status, transfer.vehicleId, transfer.fromDriverId, transfer.toDriverId,
    transfer.createdBy, transfer.createdAt, transfer.resolvedAt, transfer.reason, transfer.handover ?? null
  ]);
  await upsertRows(client, 'vehicle_transfers', [
    'id', 'type', 'status', 'vehicle_id', 'from_driver_id', 'to_driver_id', 'created_by', 'created_at', 'resolved_at', 'reason', 'handover'
  ], transferRows.filter((row) => row[2] !== 'PENDING'));
  await upsertRows(client, 'vehicle_transfers', [
    'id', 'type', 'status', 'vehicle_id', 'from_driver_id', 'to_driver_id', 'created_by', 'created_at', 'resolved_at', 'reason', 'handover'
  ], transferRows.filter((row) => row[2] === 'PENDING'));
  await upsertRows(client, 'waybills', [
    'id', 'vehicle_id', 'driver_id', 'waybill_date', 'created_at', 'status', 'distance_km', 'fuel_added',
    'fuel_spent', 'reported_end_odometer', 'reported_end_fuel', 'start_odometer', 'end_odometer', 'start_fuel', 'end_fuel', 'route', 'note'
  ], state.waybills.map((waybill) => [
    waybill.id, waybill.vehicleId, waybill.driverId, waybill.waybillDate, waybill.createdAt, waybill.status,
    waybill.distanceKm, waybill.fuelAdded, waybill.fuelSpent, waybill.reportedEndOdometer, waybill.reportedEndFuel,
    waybill.startOdometer, waybill.endOdometer, waybill.startFuel, waybill.endFuel, waybill.route, waybill.note
  ]));
  await upsertRows(client, 'waybill_revisions', [
    'id', 'waybill_id', 'actor_id', 'waybill_status', 'before_data', 'after_data', 'created_at'
  ], (state.waybillRevisions ?? []).map((revision) => [
    revision.id, revision.waybillId, revision.actorId, revision.waybillStatus,
    revision.before, revision.after, revision.createdAt
  ]));
  await upsertRows(client, 'waybill_files', [
    'id', 'waybill_id', 'uploaded_by', 'original_name', 'mime_type', 'size_bytes', 'storage_key', 'created_at'
  ], (state.waybillFiles ?? []).map((file) => [
    file.id, file.waybillId, file.uploadedBy, file.originalName, file.mimeType,
    file.sizeBytes, file.storageKey, file.createdAt
  ]));
  await upsertRows(client, 'transfer_files', ['id', 'transfer_id', 'uploaded_by', 'category', 'original_name', 'mime_type', 'size_bytes', 'storage_key', 'created_at'], (state.transferFiles ?? []).map((file) => [file.id, file.transferId, file.uploadedBy, file.category, file.originalName, file.mimeType, file.sizeBytes, file.storageKey, file.createdAt]));
  await upsertRows(client, 'audit_log', ['id', 'actor_id', 'action', 'payload', 'created_at'], state.auditLog.map((entry) => [
    entry.id, entry.actorId, entry.action, entry.payload, entry.createdAt
  ]));
  await upsertRows(client, 'notification_outbox', [
    'id', 'portal_id', 'bitrix_user_id', 'event_type', 'message', 'tag', 'status', 'attempts',
    'last_error', 'created_at', 'sent_at'
  ], (state.notifications ?? []).map((item) => [
    item.id, item.portalId, item.bitrixUserId, item.eventType, item.message, item.tag, item.status,
    item.attempts, item.lastError, item.createdAt, item.sentAt
  ]));
  await upsertRows(client, 'vehicle_sync_outbox', [
    'id', 'portal_id', 'vehicle_id', 'event_type', 'status', 'attempts', 'last_error', 'created_at', 'synced_at'
  ], (state.vehicleSyncs ?? []).map((item) => [
    item.id, item.portalId, item.vehicleId, item.eventType, item.status, item.attempts,
    item.lastError, item.createdAt, item.syncedAt
  ]));

  await deleteMissing(client, 'vehicle_sync_outbox', (state.vehicleSyncs ?? []).map((item) => item.id));
  await deleteMissing(client, 'notification_outbox', (state.notifications ?? []).map((item) => item.id));
  await deleteMissing(client, 'audit_log', state.auditLog.map((entry) => entry.id));
  await deleteMissing(client, 'waybill_files', (state.waybillFiles ?? []).map((file) => file.id));
  await deleteMissing(client, 'transfer_files', (state.transferFiles ?? []).map((file) => file.id));
  await deleteMissing(client, 'waybill_revisions', (state.waybillRevisions ?? []).map((revision) => revision.id));
  await deleteMissing(client, 'waybills', state.waybills.map((waybill) => waybill.id));
  await deleteMissing(client, 'vehicle_transfers', state.transfers.map((transfer) => transfer.id));
  await deleteMissing(client, 'assignments', state.assignments.map((assignment) => assignment.id));
  await deleteMissing(client, 'vehicles', state.vehicles.map((vehicle) => vehicle.id));
  await deleteMissing(client, 'users', state.users.map((user) => user.id));
  await deleteMissing(client, 'app_counters', Object.keys(state.counters), 'name');
}

async function upsertRows(client, table, columns, rows, conflictColumns = ['id']) {
  if (rows.length === 0) return;
  for (let offset = 0; offset < rows.length; offset += 500) {
    await upsertRowBatch(client, table, columns, rows.slice(offset, offset + 500), conflictColumns);
  }
}

async function upsertRowBatch(client, table, columns, rows, conflictColumns) {
  const values = [];
  const groups = rows.map((row, rowIndex) => {
    const placeholders = row.map((value, columnIndex) => {
      values.push(value);
      return `$${rowIndex * columns.length + columnIndex + 1}`;
    });
    return `(${placeholders.join(', ')})`;
  });
  const updates = columns
    .filter((column) => !conflictColumns.includes(column))
    .map((column) => `${column} = excluded.${column}`)
    .join(', ');
  const conflictAction = updates ? `do update set ${updates}` : 'do nothing';
  await client.query(
    `insert into ${table} (${columns.join(', ')}) values ${groups.join(', ')} on conflict (${conflictColumns.join(', ')}) ${conflictAction}`,
    values
  );
}

async function deleteMissing(client, table, ids, idColumn = 'id') {
  if (ids.length === 0) {
    await client.query(`delete from ${table}`);
    return;
  }
  await client.query(`delete from ${table} where not (${idColumn} = any($1::text[]))`, [ids]);
}

function toIso(value) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toDate(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value).slice(0, 10);
}

function nullableNumber(value) {
  return value === null ? null : Number(value);
}

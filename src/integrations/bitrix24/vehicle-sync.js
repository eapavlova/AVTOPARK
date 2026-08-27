const VEHICLE_EVENTS = new Set([
  'VEHICLE_CREATED',
  'VEHICLE_REFERENCE_UPDATED',
  'VEHICLE_INITIAL_METRICS_UPDATED',
  'VEHICLE_ASSIGNED',
  'TRANSFER_INITIATED',
  'TRANSFER_ACCEPTED',
  'TRANSFER_REJECTED',
  'RETURN_INITIATED',
  'RETURN_CONFIRMED',
  'VEHICLE_SOLD'
]);
const MAPPABLE_FIELDS = new Set([
  'vehicleId',
  'plateNumber',
  'model',
  'status',
  'currentDriverBitrixUserId',
  'startOdometer',
  'startFuel',
  'startAt'
]);
const MAX_ATTEMPTS = 5;

export function vehicleSyncConfigFrom(environment = process.env) {
  const rawEntityTypeId = String(environment.BITRIX_VEHICLE_ENTITY_TYPE_ID ?? '').trim();
  if (!rawEntityTypeId) return { entityTypeId: null, fieldMap: {} };
  const entityTypeId = Number(rawEntityTypeId);
  if (!Number.isInteger(entityTypeId) || entityTypeId <= 0) {
    throw new Error('BITRIX_VEHICLE_ENTITY_TYPE_ID должен быть положительным целым числом.');
  }
  const rawMap = String(environment.BITRIX_VEHICLE_FIELD_MAP ?? '').trim();
  let fieldMap = {};
  if (rawMap) {
    try {
      fieldMap = JSON.parse(rawMap);
    } catch {
      throw new Error('BITRIX_VEHICLE_FIELD_MAP должен содержать корректный JSON.');
    }
    if (!fieldMap || Array.isArray(fieldMap) || typeof fieldMap !== 'object') {
      throw new Error('BITRIX_VEHICLE_FIELD_MAP должен быть объектом JSON.');
    }
    for (const [source, target] of Object.entries(fieldMap)) {
      if (!MAPPABLE_FIELDS.has(source) || !/^[A-Za-z][A-Za-z0-9_]*$/.test(target)) {
        throw new Error(`Некорректное сопоставление поля автомобиля: ${source}.`);
      }
    }
  }
  return { entityTypeId, fieldMap };
}

export function appendPlannedVehicleSyncs(previousState, nextState) {
  const previousAuditIds = new Set(previousState.auditLog.map((entry) => entry.id));
  const entries = nextState.auditLog
    .filter((entry) => !previousAuditIds.has(entry.id) && VEHICLE_EVENTS.has(entry.action))
    .map((entry) => ({ entry, vehicleId: vehicleIdForEntry(nextState, entry) }))
    .filter((item) => item.vehicleId);
  if (entries.length === 0) return nextState;

  let counter = Number(nextState.counters.vehicleSync ?? 0);
  const syncs = [...(nextState.vehicleSyncs ?? [])];
  for (const { entry, vehicleId } of entries) {
    const vehicle = nextState.vehicles.find((item) => item.id === vehicleId);
    if (!vehicle || vehicle.portalId === 'local') continue;
    counter += 1;
    syncs.push({
      id: `vehicle-sync-${counter}`,
      portalId: vehicle.portalId,
      vehicleId: vehicle.id,
      eventType: entry.action,
      status: 'PENDING',
      attempts: 0,
      lastError: null,
      createdAt: new Date().toISOString(),
      syncedAt: null
    });
  }
  if (counter === Number(nextState.counters.vehicleSync ?? 0)) return nextState;
  return {
    ...nextState,
    vehicleSyncs: syncs,
    counters: { ...nextState.counters, vehicleSync: counter }
  };
}

function vehicleIdForEntry(state, entry) {
  if (entry.payload.vehicleId) return entry.payload.vehicleId;
  if (!entry.payload.transferId) return null;
  return state.transfers.find((transfer) => transfer.id === entry.payload.transferId)?.vehicleId ?? null;
}

export class BitrixVehicleSyncDispatcher {
  constructor({ store, bitrix24, config, logger = console }) {
    this.store = store;
    this.bitrix24 = bitrix24;
    this.config = config;
    this.logger = logger;
    this.active = new Map();
  }

  dispatchPortal(portalId) {
    if (!this.bitrix24 || !this.config.entityTypeId || !portalId || portalId === 'local') return Promise.resolve();
    const previous = this.active.get(portalId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.#drain(portalId))
      .catch((error) => this.logger.error?.('Ошибка очереди синхронизации автомобилей Bitrix24:', error))
      .finally(() => {
        if (this.active.get(portalId) === current) this.active.delete(portalId);
      });
    this.active.set(portalId, current);
    return current;
  }

  async close() {
    await Promise.allSettled(this.active.values());
  }

  async #drain(portalId) {
    const state = await this.store.load();
    const pending = (state.vehicleSyncs ?? [])
      .filter((item) => item.portalId === portalId && item.status === 'PENDING' && item.attempts < MAX_ATTEMPTS)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

    for (const sync of pending) {
      const latest = await this.store.load();
      const vehicle = latest.vehicles.find((item) => item.id === sync.vehicleId);
      if (!vehicle) {
        await this.#mark(sync.id, { status: 'FAILED', lastError: 'Автомобиль не найден.' });
        continue;
      }
      try {
        const itemId = await this.bitrix24.upsertVehicle(sync.portalId, {
          entityTypeId: this.config.entityTypeId,
          itemId: vehicle.bitrixItemId,
          fields: buildVehicleFields(latest, vehicle, this.config.fieldMap)
        });
        await this.#mark(sync.id, {
          status: 'SENT',
          syncedAt: new Date().toISOString(),
          lastError: null,
          vehicleId: vehicle.id,
          bitrixItemId: itemId
        });
      } catch (error) {
        const attempts = sync.attempts + 1;
        await this.#mark(sync.id, {
          status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
          lastError: safeErrorMessage(error)
        });
        this.logger.warn?.(`Не удалось синхронизировать автомобиль ${vehicle.id}.`, error);
      }
    }
  }

  async #mark(syncId, patch) {
    await this.store.update((state) => ({
      ...state,
      vehicles: patch.bitrixItemId
        ? state.vehicles.map((vehicle) => vehicle.id === patch.vehicleId
          ? { ...vehicle, bitrixItemId: patch.bitrixItemId }
          : vehicle)
        : state.vehicles,
      vehicleSyncs: (state.vehicleSyncs ?? []).map((item) => item.id === syncId
        ? {
            ...item,
            status: patch.status,
            attempts: item.attempts + 1,
            lastError: patch.lastError,
            syncedAt: patch.syncedAt ?? item.syncedAt
          }
        : item)
    }));
  }
}

export function buildVehicleFields(state, vehicle, fieldMap = {}) {
  const currentDriver = state.users.find((user) => user.id === vehicle.currentDriverId);
  const values = {
    vehicleId: vehicle.id,
    plateNumber: vehicle.plateNumber,
    model: vehicle.title,
    status: statusLabel(vehicle.status),
    currentDriverBitrixUserId: currentDriver?.bitrixUserId ?? null,
    startOdometer: vehicle.startOdometer,
    startFuel: vehicle.startFuel,
    startAt: vehicle.startAt
  };
  const fields = { title: `${vehicle.plateNumber} · ${vehicle.title}` };
  for (const [source, target] of Object.entries(fieldMap)) fields[target] = values[source];
  return fields;
}

function statusLabel(status) {
  return {
    FREE: 'Свободен',
    ASSIGNED: 'Закреплен',
    TRANSFER_PENDING: 'Передача',
    RETURN_PENDING: 'Приемка',
    SOLD: 'Продан'
  }[status] ?? status;
}

function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

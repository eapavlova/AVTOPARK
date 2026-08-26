import { Roles, WaybillStatus } from '../../domain.js';

const MAX_ATTEMPTS = 5;

export function appendPlannedNotifications(previousState, nextState) {
  const previousAuditIds = new Set(previousState.auditLog.map((entry) => entry.id));
  const newEntries = nextState.auditLog.filter((entry) => !previousAuditIds.has(entry.id));
  const plans = newEntries.flatMap((entry) => plansForAuditEntry(nextState, entry));
  if (plans.length === 0) return nextState;

  let counter = Number(nextState.counters.notification ?? 0);
  const existing = nextState.notifications ?? [];
  const notifications = plans.map((plan) => {
    counter += 1;
    return {
      id: `notification-${counter}`,
      portalId: plan.portalId,
      bitrixUserId: plan.bitrixUserId,
      eventType: plan.eventType,
      message: plan.message,
      tag: plan.tag,
      status: 'PENDING',
      attempts: 0,
      lastError: null,
      createdAt: new Date().toISOString(),
      sentAt: null
    };
  });

  return {
    ...nextState,
    notifications: [...existing, ...notifications],
    counters: { ...nextState.counters, notification: counter }
  };
}

export class BitrixNotificationDispatcher {
  constructor({ store, bitrix24, logger = console }) {
    this.store = store;
    this.bitrix24 = bitrix24;
    this.logger = logger;
    this.active = new Map();
  }

  dispatchPortal(portalId) {
    if (!this.bitrix24 || !portalId || portalId === 'local') return Promise.resolve();
    const previous = this.active.get(portalId) ?? Promise.resolve();
    const current = previous
      .catch(() => undefined)
      .then(() => this.#drain(portalId))
      .catch((error) => this.logger.error?.('Ошибка очереди уведомлений Bitrix24:', error))
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
    const pending = (state.notifications ?? [])
      .filter((item) => item.portalId === portalId && item.status === 'PENDING' && item.attempts < MAX_ATTEMPTS)
      .sort((left, right) => left.createdAt.localeCompare(right.createdAt));

    for (const notification of pending) {
      try {
        await this.bitrix24.notify(
          notification.portalId,
          notification.bitrixUserId,
          notification.message,
          notification.tag
        );
        await this.#mark(notification.id, { status: 'SENT', sentAt: new Date().toISOString(), lastError: null });
      } catch (error) {
        const attempts = notification.attempts + 1;
        await this.#mark(notification.id, {
          status: attempts >= MAX_ATTEMPTS ? 'FAILED' : 'PENDING',
          lastError: safeErrorMessage(error)
        });
        this.logger.warn?.(`Не удалось отправить уведомление ${notification.id}.`, error);
      }
    }
  }

  async #mark(notificationId, patch) {
    await this.store.update((state) => ({
      ...state,
      notifications: (state.notifications ?? []).map((item) => item.id === notificationId
        ? { ...item, ...patch, attempts: item.attempts + 1 }
        : item)
    }));
  }
}

function plansForAuditEntry(state, entry) {
  const transfer = entry.payload.transferId
    ? state.transfers.find((item) => item.id === entry.payload.transferId)
    : null;
  const waybill = entry.payload.waybillId
    ? state.waybills.find((item) => item.id === entry.payload.waybillId)
    : null;
  const vehicle = state.vehicles.find((item) =>
    item.id === (entry.payload.vehicleId ?? transfer?.vehicleId ?? waybill?.vehicleId)
  );
  const vehicleName = vehicle ? `${vehicle.plateNumber} (${vehicle.title})` : 'автомобиль';

  switch (entry.action) {
    case 'TRANSFER_INITIATED':
      return notifyUsers(state, [transfer?.toDriverId], entry, transfer?.id,
        `Вам передают автомобиль ${vehicleName}. Откройте раздел «Передачи» в приложении «Автопарк».`);
    case 'TRANSFER_ACCEPTED':
      return notifyUsers(state, [transfer?.fromDriverId], entry, transfer?.id,
        `${userName(state, transfer?.toDriverId)} принял(а) автомобиль ${vehicleName}.`);
    case 'TRANSFER_REJECTED':
      return notifyUsers(state, [transfer?.fromDriverId], entry, transfer?.id,
        `${userName(state, transfer?.toDriverId)} отклонил(а) передачу автомобиля ${vehicleName}. Причина: ${entry.payload.reason}.`);
    case 'RETURN_INITIATED': {
      const actor = state.users.find((user) => user.id === entry.actorId);
      const recipients = state.users.filter((user) =>
        samePortal(user, actor) && [Roles.FLEET_MANAGER, Roles.ADMIN].includes(user.role)
      );
      return notifyUsers(state, recipients.map((user) => user.id), entry, transfer?.id,
        `${userName(state, transfer?.fromDriverId)} передает автомобиль ${vehicleName} на приемку в автопарк.`);
    }
    case 'RETURN_CONFIRMED':
      return notifyUsers(state, [transfer?.fromDriverId], entry, transfer?.id,
        `Приемка автомобиля ${vehicleName} подтверждена. Автомобиль переведен в состояние «Свободен».`);
    case 'WAYBILL_STATUS_CHANGED':
      return plansForWaybillStatus(state, entry, waybill, vehicleName);
    default:
      return [];
  }
}

function plansForWaybillStatus(state, entry, waybill, vehicleName) {
  if (!waybill) return [];
  const status = entry.payload.status;
  if (status === WaybillStatus.ACCOUNTING_REVIEW) {
    const driver = state.users.find((user) => user.id === waybill.driverId);
    const recipients = state.users.filter((user) =>
      samePortal(user, driver) && [Roles.ACCOUNTANT, Roles.ADMIN].includes(user.role)
    );
    return notifyUsers(state, recipients.map((user) => user.id), entry, waybill.id,
      `Путевой лист ${waybill.id} от ${waybill.waybillDate} по автомобилю ${vehicleName} отправлен на проверку.`);
  }
  const message = {
    [WaybillStatus.DRIVER_CORRECTION]: `Путевой лист ${waybill.id} возвращен вам на корректировку.`,
    [WaybillStatus.PROCESSED]: `Путевой лист ${waybill.id} обработан бухгалтерией.`,
    [WaybillStatus.REJECTED]: `Путевой лист ${waybill.id} отклонен бухгалтерией.`
  }[status];
  return message ? notifyUsers(state, [waybill.driverId], entry, waybill.id, message) : [];
}

function notifyUsers(state, userIds, entry, entityId, message) {
  const seen = new Set();
  return userIds
    .map((userId) => state.users.find((user) => user.id === userId))
    .filter((user) => user && user.portalId !== 'local' && Number.isInteger(user.bitrixUserId) && user.bitrixUserId > 0)
    .filter((user) => {
      if (seen.has(user.id)) return false;
      seen.add(user.id);
      return true;
    })
    .map((user) => ({
      portalId: user.portalId,
      bitrixUserId: user.bitrixUserId,
      eventType: entry.action,
      message,
      tag: `autopark:${entry.action}:${entityId ?? entry.id}:${user.bitrixUserId}`
    }));
}

function userName(state, userId) {
  return state.users.find((user) => user.id === userId)?.name ?? 'Сотрудник';
}

function samePortal(left, right) {
  return left && right && left.portalId === right.portalId;
}

function safeErrorMessage(error) {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 500);
}

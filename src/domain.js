export const VehicleStatus = Object.freeze({
  FREE: 'FREE',
  ASSIGNED: 'ASSIGNED',
  TRANSFER_PENDING: 'TRANSFER_PENDING',
  RETURN_PENDING: 'RETURN_PENDING',
  SOLD: 'SOLD'
});

export const TransferType = Object.freeze({
  DRIVER_TO_DRIVER: 'DRIVER_TO_DRIVER',
  RETURN_TO_FLEET: 'RETURN_TO_FLEET'
});

export const TransferStatus = Object.freeze({
  PENDING: 'PENDING',
  ACCEPTED: 'ACCEPTED',
  REJECTED: 'REJECTED',
  CONFIRMED: 'CONFIRMED'
});

export const WaybillStatus = Object.freeze({
  DRAFT: 'DRAFT',
  ACCOUNTING_REVIEW: 'ACCOUNTING_REVIEW',
  DRIVER_CORRECTION: 'DRIVER_CORRECTION',
  PROCESSED: 'PROCESSED',
  REJECTED: 'REJECTED'
});

export const Roles = Object.freeze({
  DRIVER: 'DRIVER',
  FLEET_MANAGER: 'FLEET_MANAGER',
  ADMIN: 'ADMIN',
  ACCOUNTANT: 'ACCOUNTANT'
});

export const WaybillFileMimeTypes = Object.freeze([
  'image/jpeg',
  'image/png',
  'image/webp',
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
]);

export function createEmptyState() {
  const now = new Date().toISOString();
  return {
    meta: { createdAt: now, updatedAt: now },
    users: [],
    vehicles: [],
    assignments: [],
    transfers: [],
    transferFiles: [],
    waybills: [],
    waybillRevisions: [],
    waybillFiles: [],
    notifications: [],
    vehicleSyncs: [],
    auditLog: [],
    counters: {
      vehicle: 0,
      assignment: 0,
      transfer: 0,
      transferFile: 0,
      waybill: 0,
      waybillRevision: 0,
      waybillFile: 0,
      notification: 0,
      vehicleSync: 0,
      audit: 0
    }
  };
}

export function createInitialState() {
  const state = createEmptyState();
  return {
    ...state,
    users: [
      { id: 'u-driver-1', portalId: 'local', bitrixUserId: 101, name: 'Иван Петров', role: Roles.DRIVER },
      { id: 'u-driver-2', portalId: 'local', bitrixUserId: 102, name: 'Мария Соколова', role: Roles.DRIVER },
      { id: 'u-fleet-1', portalId: 'local', bitrixUserId: 201, name: 'Заведующий автопарком', role: Roles.FLEET_MANAGER },
      { id: 'u-accountant-1', portalId: 'local', bitrixUserId: 301, name: 'Бухгалтер', role: Roles.ACCOUNTANT },
      { id: 'u-admin-1', portalId: 'local', bitrixUserId: 401, name: 'Администратор', role: Roles.ADMIN }
    ]
  };
}

export function synchronizeBitrixUser(state, command) {
  const portalId = requireIdentifier(command.portalId, 'portalId');
  const bitrixUserId = requirePositiveInteger(command.bitrixUserId, 'bitrixUserId');
  const name = required(command.name, 'name').trim();
  const existing = state.users.find((user) =>
    (user.portalId ?? 'local') === portalId && user.bitrixUserId === bitrixUserId
  );

  if (existing) {
    if (existing.name === name) return { state, user: existing, created: false };
    const updatedUser = { ...existing, name };
    const updated = appendAudit({
      ...touch(state),
      users: state.users.map((user) => user.id === existing.id ? updatedUser : user)
    }, existing.id, 'USER_PROFILE_UPDATED', { userId: existing.id });
    return { state: updated, user: updatedUser, created: false };
  }

  const portalUsers = state.users.filter((user) => (user.portalId ?? 'local') === portalId);
  if (portalUsers.length === 0 && !command.isPortalAdmin) {
    throw new DomainError('Первый вход в новый портал должен выполнить администратор Bitrix24.');
  }
  const user = {
    id: `bx-${portalId}-${bitrixUserId}`,
    portalId,
    bitrixUserId,
    name,
    role: portalUsers.length === 0 ? Roles.ADMIN : Roles.DRIVER
  };
  const withUser = { ...touch(state), users: [...state.users, user] };
  const updated = appendAudit(withUser, user.id, 'USER_CREATED_FROM_BITRIX', {
    userId: user.id,
    portalId,
    role: user.role
  });
  return { state: updated, user, created: true };
}

export function changeUserRole(state, command) {
  assertRole(state, command.actorId, [Roles.ADMIN]);
  const actor = getUser(state, command.actorId);
  const user = getUser(state, command.userId);
  const role = required(command.role, 'role');
  if (!Object.values(Roles).includes(role)) throw new DomainError('Неизвестная роль пользователя.');
  if ((actor.portalId ?? 'local') !== (user.portalId ?? 'local')) {
    throw new DomainError('Нельзя изменять роли пользователей другого портала.');
  }
  if (user.role === role) return state;
  if (user.role === Roles.ADMIN && role !== Roles.ADMIN) {
    const admins = state.users.filter((item) =>
      (item.portalId ?? 'local') === (user.portalId ?? 'local') && item.role === Roles.ADMIN
    );
    if (admins.length === 1) throw new DomainError('Нельзя снять роль у последнего администратора.');
  }
  if (role === Roles.DRIVER) {
    const activeVehicles = state.vehicles.filter((vehicle) => vehicle.currentDriverId === user.id).length;
    if (activeVehicles > 1) {
      throw new DomainError('Нельзя назначить роль водителя: за пользователем закреплено несколько автомобилей.');
    }
  }

  const updated = {
    ...touch(state),
    users: state.users.map((item) => item.id === user.id ? { ...item, role } : item)
  };
  return appendAudit(updated, command.actorId, 'USER_ROLE_CHANGED', {
    userId: user.id,
    previousRole: user.role,
    role
  });
}

export function seedDemoState() {
  let state = createInitialState();
  state = addVehicle(state, {
    actorId: 'u-admin-1',
    plateNumber: 'А123ВС 77',
    title: 'Lada Largus',
    startOdometer: 125000,
    startFuel: 32,
    startAt: '2026-08-01'
  });
  state = addVehicle(state, {
    actorId: 'u-admin-1',
    plateNumber: 'В456ОР 77',
    title: 'Газель Next',
    startOdometer: 89120,
    startFuel: 48,
    startAt: '2026-08-01'
  });
  state = assignFreeVehicle(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    assignedAt: '2026-08-02T09:00:00.000Z'
  });
  return state;
}

export function addVehicle(state, command) {
  assertRole(state, command.actorId, [Roles.FLEET_MANAGER, Roles.ADMIN]);
  const actor = getUser(state, command.actorId);
  requireNumber(command.startOdometer, 'startOdometer');
  requireNumber(command.startFuel, 'startFuel');
  if (command.startOdometer < 0 || command.startFuel < 0) {
    throw new DomainError('Стартовый пробег и топливо не могут быть отрицательными.');
  }
  const plateNumber = requireText(command.plateNumber, 'plateNumber', 32);
  const title = requireText(command.title, 'title', 120);
  if (state.vehicles.some((vehicle) =>
    (vehicle.portalId ?? 'local') === (actor.portalId ?? 'local')
      && normalizePlateNumber(vehicle.plateNumber) === normalizePlateNumber(plateNumber)
  )) {
    throw new DomainError('Автомобиль с таким госномером уже существует.');
  }
  const allocation = allocateId(state, 'vehicle', 'veh');

  const startAt = requireDate(command.startAt, 'startAt');
  if (startAt > new Date().toISOString().slice(0, 10)) {
    throw new DomainError('Дата запуска автомобиля не может быть в будущем.');
  }

  const vehicle = {
    id: allocation.id,
    portalId: actor.portalId ?? 'local',
    plateNumber,
    title,
    status: VehicleStatus.FREE,
    currentDriverId: null,
    startOdometer: command.startOdometer,
    startFuel: command.startFuel,
    startAt,
    startRecordedBy: command.actorId,
    startRecordedAt: new Date().toISOString(),
    soldAt: null,
    bitrixItemId: command.bitrixItemId ?? null
  };

  return appendAudit({
    ...touch(allocation.state),
    vehicles: [...allocation.state.vehicles, vehicle]
  }, command.actorId, 'VEHICLE_CREATED', { vehicleId: vehicle.id });
}

export function updateVehicleReference(state, command) {
  assertRole(state, command.actorId, [Roles.FLEET_MANAGER, Roles.ADMIN]);
  const actor = getUser(state, command.actorId);
  const vehicle = getVehicle(state, command.vehicleId);
  assertSamePortal(actor, vehicle);
  const plateNumber = requireText(command.plateNumber, 'plateNumber', 32);
  const title = requireText(command.title, 'title', 120);
  if (state.vehicles.some((item) =>
    item.id !== vehicle.id
      && (item.portalId ?? 'local') === (vehicle.portalId ?? 'local')
      && normalizePlateNumber(item.plateNumber) === normalizePlateNumber(plateNumber)
  )) {
    throw new DomainError('Автомобиль с таким госномером уже существует.');
  }
  if (vehicle.plateNumber === plateNumber && vehicle.title === title) return state;

  return appendAudit(updateVehicle(state, vehicle.id, { plateNumber, title }), command.actorId, 'VEHICLE_REFERENCE_UPDATED', {
    vehicleId: vehicle.id,
    previousPlateNumber: vehicle.plateNumber,
    previousTitle: vehicle.title,
    plateNumber,
    title
  });
}

export function updateVehicleInitialMetrics(state, command) {
  assertRole(state, command.actorId, [Roles.FLEET_MANAGER, Roles.ADMIN]);
  const actor = getUser(state, command.actorId);
  const vehicle = getVehicle(state, command.vehicleId);
  assertSamePortal(actor, vehicle);
  if (state.waybills.some((waybill) => waybill.vehicleId === vehicle.id)) {
    throw new DomainError('Стартовые показатели нельзя изменить: по автомобилю уже создан путевой лист.');
  }

  requireNumber(command.startOdometer, 'startOdometer');
  requireNumber(command.startFuel, 'startFuel');
  if (command.startOdometer < 0 || command.startFuel < 0) {
    throw new DomainError('Стартовый пробег и топливо не могут быть отрицательными.');
  }
  if (vehicle.startOdometer === command.startOdometer && vehicle.startFuel === command.startFuel) return state;

  return appendAudit(updateVehicle(state, vehicle.id, {
    startOdometer: command.startOdometer,
    startFuel: command.startFuel
  }), command.actorId, 'VEHICLE_INITIAL_METRICS_UPDATED', {
    vehicleId: vehicle.id,
    previousStartOdometer: vehicle.startOdometer,
    previousStartFuel: vehicle.startFuel,
    startOdometer: command.startOdometer,
    startFuel: command.startFuel
  });
}

export function assignFreeVehicle(state, command) {
  assertSameActor(command.actorId, command.driverId);
  assertRole(state, command.actorId, [Roles.DRIVER, Roles.FLEET_MANAGER]);
  const driver = getUser(state, command.driverId);
  const vehicle = getVehicle(state, command.vehicleId);
  assertSamePortal(driver, vehicle);

  if (hasActiveVehicle(state, driver.id)) {
    throw new DomainError('Водитель уже имеет активный автомобиль.');
  }
  if (vehicle.status !== VehicleStatus.FREE) {
    throw new DomainError('Автомобиль уже не свободен.');
  }

  const assignedAt = command.assignedAt ?? new Date().toISOString();
  const allocation = allocateId(state, 'assignment', 'asg');
  const assignment = {
    id: allocation.id,
    vehicleId: vehicle.id,
    driverId: driver.id,
    startAt: assignedAt,
    endAt: null
  };

  const updated = updateVehicle(allocation.state, vehicle.id, {
    status: VehicleStatus.ASSIGNED,
    currentDriverId: driver.id
  });

  return appendAudit({
    ...updated,
    assignments: [...updated.assignments, assignment]
  }, command.actorId, 'VEHICLE_ASSIGNED', { vehicleId: vehicle.id, driverId: driver.id });
}

export function initiateDriverTransfer(state, command) {
  assertSameActor(command.actorId, command.fromDriverId);
  assertRole(state, command.actorId, [Roles.DRIVER, Roles.FLEET_MANAGER]);
  const vehicle = getVehicle(state, command.vehicleId);
  assertCurrentDriver(vehicle, command.fromDriverId);
  const fromDriver = getUser(state, command.fromDriverId);
  const toDriver = getUser(state, command.toDriverId);
  assertSamePortal(fromDriver, vehicle);
  assertSamePortal(toDriver, vehicle);
  if (vehicle.status !== VehicleStatus.ASSIGNED) {
    throw new DomainError('Для автомобиля уже выполняется другая операция.');
  }
  if (command.fromDriverId === command.toDriverId) {
    throw new DomainError('Нельзя передать автомобиль самому себе.');
  }
  if (![Roles.DRIVER, Roles.FLEET_MANAGER].includes(toDriver.role)) {
    throw new DomainError('Получателем передачи может быть только водитель или заведующий автопарком.');
  }

  if (hasActiveVehicle(state, toDriver.id)) {
    throw new DomainError('Принимающий водитель уже имеет активный автомобиль.');
  }

  const allocation = allocateId(state, 'transfer', 'trn');
  const transfer = {
    id: allocation.id,
    type: TransferType.DRIVER_TO_DRIVER,
    status: TransferStatus.PENDING,
    vehicleId: vehicle.id,
    fromDriverId: command.fromDriverId,
    toDriverId: command.toDriverId,
    createdBy: command.fromDriverId,
    createdAt: new Date().toISOString(),
    resolvedAt: null,
    reason: null,
    handover: normalizeTransferHandover(command)
  };

  const updated = updateVehicle(allocation.state, vehicle.id, { status: VehicleStatus.TRANSFER_PENDING });
  return appendAudit({
    ...updated,
    transfers: [...updated.transfers, transfer]
  }, command.fromDriverId, 'TRANSFER_INITIATED', { transferId: transfer.id, vehicleId: vehicle.id });
}

export function acceptDriverTransfer(state, command) {
  const transfer = getTransfer(state, command.transferId);
  if (transfer.type !== TransferType.DRIVER_TO_DRIVER || transfer.status !== TransferStatus.PENDING) {
    throw new DomainError('Передача недоступна для принятия.');
  }
  if (transfer.toDriverId !== command.actorId) {
    throw new DomainError('Принять передачу может только указанный принимающий водитель.');
  }
  const vehicle = getVehicle(state, transfer.vehicleId);
  if (vehicle.status !== VehicleStatus.TRANSFER_PENDING || vehicle.currentDriverId !== transfer.fromDriverId) {
    throw new DomainError('Состояние автомобиля изменилось, передачу нельзя принять.');
  }
  const toDriver = getUser(state, transfer.toDriverId);
  if (hasActiveVehicle(state, toDriver.id)) {
    throw new DomainError('Принимающий водитель уже имеет активный автомобиль.');
  }

  const resolvedAt = command.resolvedAt ?? new Date().toISOString();
  const allocation = allocateId(state, 'assignment', 'asg');
  const closedAssignments = allocation.state.assignments.map((assignment) => {
    if (assignment.vehicleId === transfer.vehicleId && assignment.endAt === null) {
      return { ...assignment, endAt: resolvedAt };
    }
    return assignment;
  });

  const newAssignment = {
    id: allocation.id,
    vehicleId: transfer.vehicleId,
    driverId: transfer.toDriverId,
    startAt: resolvedAt,
    endAt: null
  };

  const withVehicle = updateVehicle(allocation.state, transfer.vehicleId, {
    status: VehicleStatus.ASSIGNED,
    currentDriverId: transfer.toDriverId
  });

  const updated = {
    ...withVehicle,
    assignments: [...closedAssignments, newAssignment],
    transfers: withVehicle.transfers.map((item) =>
      item.id === transfer.id ? { ...item, status: TransferStatus.ACCEPTED, resolvedAt } : item
    )
  };

  return appendAudit(updated, command.actorId, 'TRANSFER_ACCEPTED', {
    transferId: transfer.id,
    vehicleId: transfer.vehicleId
  });
}

export function rejectDriverTransfer(state, command) {
  const transfer = getTransfer(state, command.transferId);
  if (transfer.type !== TransferType.DRIVER_TO_DRIVER || transfer.status !== TransferStatus.PENDING) {
    throw new DomainError('Передача недоступна для отказа.');
  }
  if (transfer.toDriverId !== command.actorId) {
    throw new DomainError('Отказаться может только указанный принимающий водитель.');
  }
  const vehicle = getVehicle(state, transfer.vehicleId);
  if (vehicle.status !== VehicleStatus.TRANSFER_PENDING || vehicle.currentDriverId !== transfer.fromDriverId) {
    throw new DomainError('Состояние автомобиля изменилось, передачу нельзя отклонить.');
  }
  const reason = required(command.reason, 'reason');

  const updated = updateVehicle(state, transfer.vehicleId, { status: VehicleStatus.ASSIGNED });
  return appendAudit({
    ...updated,
    transfers: updated.transfers.map((item) =>
      item.id === transfer.id
        ? { ...item, status: TransferStatus.REJECTED, resolvedAt: new Date().toISOString(), reason }
        : item
    )
  }, command.actorId, 'TRANSFER_REJECTED', { transferId: transfer.id, vehicleId: transfer.vehicleId, reason });
}

export function initiateReturnToFleet(state, command) {
  assertSameActor(command.actorId, command.driverId);
  assertRole(state, command.actorId, [Roles.DRIVER, Roles.FLEET_MANAGER]);
  const driver = getUser(state, command.driverId);
  const vehicle = getVehicle(state, command.vehicleId);
  assertCurrentDriver(vehicle, command.driverId);
  if (vehicle.status !== VehicleStatus.ASSIGNED) {
    throw new DomainError('Для автомобиля уже выполняется другая операция.');
  }

  const returnedAt = command.returnedAt ?? command.resolvedAt ?? new Date().toISOString();
  assertWaybillsCompleteForReturn(state, vehicle.id, driver.id, returnedAt);

  if (driver.role === Roles.FLEET_MANAGER) {
    const allocation = allocateId(state, 'transfer', 'trn');
    const closedAssignments = allocation.state.assignments.map((assignment) => {
      if (assignment.vehicleId === vehicle.id && assignment.endAt === null) {
        return { ...assignment, endAt: returnedAt };
      }
      return assignment;
    });
    const transfer = {
      id: allocation.id,
      type: TransferType.RETURN_TO_FLEET,
      status: TransferStatus.CONFIRMED,
      vehicleId: vehicle.id,
      fromDriverId: command.driverId,
      toDriverId: null,
      createdBy: command.driverId,
      createdAt: returnedAt,
      resolvedAt: returnedAt,
      reason: command.note ?? null,
      handover: normalizeTransferHandover(command)
    };
    const withVehicle = updateVehicle(allocation.state, vehicle.id, {
      status: VehicleStatus.FREE,
      currentDriverId: null
    });
    return appendAudit({
      ...withVehicle,
      assignments: closedAssignments,
      transfers: [...withVehicle.transfers, transfer]
    }, command.actorId, 'RETURN_CONFIRMED', {
      transferId: transfer.id,
      vehicleId: vehicle.id,
      selfReturn: true,
      note: command.note ?? null
    });
  }

  const allocation = allocateId(state, 'transfer', 'trn');
  const transfer = {
    id: allocation.id,
    type: TransferType.RETURN_TO_FLEET,
    status: TransferStatus.PENDING,
    vehicleId: vehicle.id,
    fromDriverId: command.driverId,
    toDriverId: null,
    createdBy: command.driverId,
    createdAt: returnedAt,
    resolvedAt: null,
    reason: command.note ?? null,
    handover: normalizeTransferHandover(command)
  };

  const updated = updateVehicle(allocation.state, vehicle.id, { status: VehicleStatus.RETURN_PENDING });
  return appendAudit({
    ...updated,
    transfers: [...updated.transfers, transfer]
  }, command.driverId, 'RETURN_INITIATED', { transferId: transfer.id, vehicleId: vehicle.id });
}

export function confirmReturnToFleet(state, command) {
  assertRole(state, command.actorId, [Roles.FLEET_MANAGER, Roles.ADMIN]);
  const actor = getUser(state, command.actorId);
  const transfer = getTransfer(state, command.transferId);
  if (transfer.type !== TransferType.RETURN_TO_FLEET || transfer.status !== TransferStatus.PENDING) {
    throw new DomainError('Сдача в автопарк недоступна для подтверждения.');
  }
  if (actor.role === Roles.FLEET_MANAGER && transfer.fromDriverId === actor.id) {
    throw new DomainError('Заведующему автопарком не требуется подтверждать собственную сдачу автомобиля.');
  }
  const vehicle = getVehicle(state, transfer.vehicleId);
  if (vehicle.status !== VehicleStatus.RETURN_PENDING || vehicle.currentDriverId !== transfer.fromDriverId) {
    throw new DomainError('Состояние автомобиля изменилось, приемку нельзя подтвердить.');
  }

  const resolvedAt = command.resolvedAt ?? new Date().toISOString();
  const closedAssignments = state.assignments.map((assignment) => {
    if (assignment.vehicleId === transfer.vehicleId && assignment.endAt === null) {
      return { ...assignment, endAt: resolvedAt };
    }
    return assignment;
  });

  const withVehicle = updateVehicle(state, transfer.vehicleId, {
    status: VehicleStatus.FREE,
    currentDriverId: null
  });

  return appendAudit({
    ...withVehicle,
    assignments: closedAssignments,
    transfers: withVehicle.transfers.map((item) =>
      item.id === transfer.id ? { ...item, status: TransferStatus.CONFIRMED, resolvedAt } : item
    )
  }, command.actorId, 'RETURN_CONFIRMED', { transferId: transfer.id, vehicleId: transfer.vehicleId });
}

export function sellVehicle(state, command) {
  assertRole(state, command.actorId, [Roles.FLEET_MANAGER, Roles.ADMIN]);
  const actor = getUser(state, command.actorId);
  const vehicle = getVehicle(state, command.vehicleId);
  assertSamePortal(actor, vehicle);
  const soldAt = requireDate(command.soldAt ?? command.retiredAt, 'soldAt');

  if (vehicle.status !== VehicleStatus.FREE) {
    throw new DomainError('Продать можно только свободный автомобиль, принятый в автопарк.');
  }
  const unresolvedWaybill = state.waybills.find((waybill) =>
    waybill.vehicleId === vehicle.id && ![WaybillStatus.PROCESSED, WaybillStatus.REJECTED].includes(waybill.status)
  );
  if (unresolvedWaybill) {
    throw new DomainError('Перед продажей необходимо завершить все путевые листы автомобиля.');
  }
  const laterWaybill = state.waybills.find((waybill) =>
    waybill.vehicleId === vehicle.id && waybill.waybillDate > soldAt
  );
  if (laterWaybill) {
    throw new DomainError('Дата продажи не может быть раньше уже созданного путевого листа.');
  }

  return appendAudit(updateVehicle(state, vehicle.id, {
    status: VehicleStatus.SOLD,
    currentDriverId: null,
    soldAt
  }), command.actorId, 'VEHICLE_SOLD', { vehicleId: vehicle.id, soldAt });
}

export function createWaybill(state, command) {
  assertSameActor(command.actorId, command.driverId);
  assertRole(state, command.actorId, [Roles.DRIVER, Roles.FLEET_MANAGER]);
  const vehicle = getVehicle(state, command.vehicleId);
  const driver = getUser(state, command.driverId);
  assertSamePortal(driver, vehicle);
  const waybillDate = requireDate(command.waybillDate, 'waybillDate');
  const soldAt = vehicle.soldAt ?? vehicle.retiredAt;
  if (soldAt && waybillDate > soldAt) {
    throw new DomainError('После даты продажи автомобиля путевой лист создавать нельзя.');
  }
  if (vehicle.currentDriverId !== driver.id || vehicle.status !== VehicleStatus.ASSIGNED) {
    throw new DomainError('Путевой лист можно создать только по автомобилю, который сейчас закреплен за водителем.');
  }
  if (!wasAssignedOnDate(state, vehicle.id, driver.id, waybillDate)) {
    throw new DomainError('На дату путевого листа автомобиль не был закреплен за водителем.');
  }
  if (hasDriverCorrectionWaybill(state, driver.id)) {
    throw new DomainError('У водителя есть путевой лист на корректировке.');
  }
  const odometerInput = normalizeWaybillOdometerInput(state, vehicle.id, waybillDate, command);
  const fuelInput = normalizeWaybillFuelInput(state, vehicle.id, waybillDate, command);

  const allocation = allocateId(state, 'waybill', 'way');
  const waybill = {
    id: allocation.id,
    vehicleId: vehicle.id,
    driverId: driver.id,
    waybillDate,
    createdAt: new Date().toISOString(),
    status: WaybillStatus.DRAFT,
    distanceKm: odometerInput.distanceKm,
    reportedEndOdometer: odometerInput.reportedEndOdometer,
    fuelAdded: fuelInput.fuelAdded,
    fuelSpent: fuelInput.fuelSpent,
    reportedEndFuel: fuelInput.reportedEndFuel,
    startOdometer: null,
    endOdometer: null,
    startFuel: null,
    endFuel: null,
    note: normalizeNote(command.note)
  };

  const withWaybill = {
    ...touch(allocation.state),
    waybills: [...allocation.state.waybills, waybill]
  };
  const recalculated = recalculateVehicleWaybills(withWaybill, vehicle.id);
  return appendAudit(recalculated, command.driverId, 'WAYBILL_CREATED', { waybillId: waybill.id, vehicleId: vehicle.id });
}

export function updateWaybill(state, command) {
  const waybill = getWaybill(state, command.waybillId);
  const actor = getUser(state, command.actorId);
  if (waybill.driverId !== actor.id || ![Roles.DRIVER, Roles.FLEET_MANAGER].includes(actor.role)) {
    throw new DomainError('Исправлять путевой лист может только его водитель.');
  }
  if (![WaybillStatus.DRAFT, WaybillStatus.DRIVER_CORRECTION].includes(waybill.status)) {
    throw new DomainError('Путевой лист в этом статусе нельзя редактировать.');
  }
  const odometerInput = normalizeWaybillOdometerInput(state, waybill.vehicleId, waybill.waybillDate, command, waybill.id);
  const fuelInput = normalizeWaybillFuelInput(state, waybill.vehicleId, waybill.waybillDate, command, waybill.id);
  const after = {
    distanceKm: odometerInput.distanceKm,
    reportedEndOdometer: odometerInput.reportedEndOdometer,
    fuelAdded: fuelInput.fuelAdded,
    fuelSpent: fuelInput.fuelSpent,
    reportedEndFuel: fuelInput.reportedEndFuel,
    note: normalizeNote(command.note)
  };
  const before = waybillRevisionData(waybill);
  const comparableAfter = waybillRevisionData({ ...waybill, ...after });
  if (Object.keys(comparableAfter).every((key) => comparableAfter[key] === before[key])) return state;

  const allocation = allocateId(state, 'waybillRevision', 'rev');
  const revision = {
    id: allocation.id,
    waybillId: waybill.id,
    actorId: actor.id,
    waybillStatus: waybill.status,
    before,
    after: comparableAfter,
    createdAt: new Date().toISOString()
  };
  const updated = {
    ...touch(allocation.state),
    waybills: allocation.state.waybills.map((item) => item.id === waybill.id ? { ...item, ...after } : item),
    waybillRevisions: [...(allocation.state.waybillRevisions ?? []), revision]
  };
  const recalculated = recalculateVehicleWaybills(updated, waybill.vehicleId);
  return appendAudit(recalculated, actor.id, 'WAYBILL_UPDATED', {
    waybillId: waybill.id,
    revisionId: revision.id
  });
}

export function attachWaybillFile(state, command) {
  const waybill = getWaybill(state, command.waybillId);
  const actor = getUser(state, command.actorId);
  assertEditableWaybillOwner(actor, waybill);
  const originalName = requireFileName(command.originalName);
  const mimeType = requireText(command.mimeType, 'mimeType', 160).toLowerCase();
  if (!WaybillFileMimeTypes.includes(mimeType)) throw new DomainError('Этот тип файла не поддерживается.');
  if (!Number.isInteger(command.sizeBytes) || command.sizeBytes <= 0 || command.sizeBytes > 10 * 1024 * 1024) {
    throw new DomainError('Размер файла должен быть от 1 байта до 10 МБ.');
  }
  const storageKey = requireText(command.storageKey, 'storageKey', 100);
  if ((state.waybillFiles ?? []).some((file) => file.storageKey === storageKey)) {
    throw new DomainError('Файл с таким внутренним ключом уже существует.');
  }
  const allocation = allocateId(state, 'waybillFile', 'file');
  const file = {
    id: allocation.id,
    waybillId: waybill.id,
    uploadedBy: actor.id,
    originalName,
    mimeType,
    sizeBytes: command.sizeBytes,
    storageKey,
    createdAt: new Date().toISOString()
  };
  return appendAudit({
    ...touch(allocation.state),
    waybillFiles: [...(allocation.state.waybillFiles ?? []), file]
  }, actor.id, 'WAYBILL_FILE_ATTACHED', { waybillId: waybill.id, fileId: file.id });
}

export function removeWaybillFile(state, command) {
  const file = getWaybillFile(state, command.fileId);
  const waybill = getWaybill(state, file.waybillId);
  const actor = getUser(state, command.actorId);
  assertEditableWaybillOwner(actor, waybill);
  return appendAudit({
    ...touch(state),
    waybillFiles: (state.waybillFiles ?? []).filter((item) => item.id !== file.id)
  }, actor.id, 'WAYBILL_FILE_REMOVED', { waybillId: waybill.id, fileId: file.id, originalName: file.originalName });
}

export function updateWaybillStatus(state, command) {
  const waybill = getWaybill(state, command.waybillId);
  const actor = getUser(state, command.actorId);

  const nextStatus = required(command.status, 'status');
  if (!Object.values(WaybillStatus).includes(nextStatus)) {
    throw new DomainError('Неизвестный статус путевого листа.');
  }
  assertWaybillTransition(actor, waybill, nextStatus);

  const updated = {
    ...touch(state),
    waybills: state.waybills.map((item) => item.id === waybill.id ? { ...item, status: nextStatus } : item)
  };
  const recalculated = recalculateVehicleWaybills(updated, waybill.vehicleId);
  return appendAudit(recalculated, command.actorId, 'WAYBILL_STATUS_CHANGED', {
    waybillId: waybill.id,
    status: nextStatus
  });
}

export function recalculateVehicleWaybills(state, vehicleId) {
  const vehicle = getVehicle(state, vehicleId);
  let previousOdometer = vehicle.startOdometer;
  let previousFuel = vehicle.startFuel;

  const sorted = state.waybills
    .filter((waybill) => waybill.vehicleId === vehicleId)
    .sort(compareWaybills);

  const recalculatedById = new Map();
  for (const waybill of sorted) {
    if (waybill.status === WaybillStatus.REJECTED) {
      recalculatedById.set(waybill.id, {
        ...waybill,
        startOdometer: null,
        endOdometer: null,
        startFuel: null,
        endFuel: null
      });
      continue;
    }

    const usesReportedEndOdometer = Number.isFinite(waybill.reportedEndOdometer);
    const endOdometer = usesReportedEndOdometer
      ? waybill.reportedEndOdometer
      : previousOdometer + waybill.distanceKm;
    const distanceKm = endOdometer - previousOdometer;
    const usesReportedEndFuel = Number.isFinite(waybill.reportedEndFuel);
    const endFuel = usesReportedEndFuel
      ? waybill.reportedEndFuel
      : previousFuel + waybill.fuelAdded - waybill.fuelSpent;
    const fuelSpent = previousFuel + waybill.fuelAdded - endFuel;
    if (distanceKm < 0 || endOdometer < 0 || fuelSpent < 0 || endFuel < 0) {
      throw new DomainError('Каскадный перерасчет остановлен: итоговый пробег или топливо стали отрицательными.');
    }

    const recalculated = {
      ...waybill,
      distanceKm,
      fuelSpent,
      startOdometer: previousOdometer,
      endOdometer,
      startFuel: previousFuel,
      endFuel
    };
    recalculatedById.set(waybill.id, recalculated);
    previousOdometer = endOdometer;
    previousFuel = endFuel;
  }

  return {
    ...touch(state),
    waybills: state.waybills.map((waybill) => recalculatedById.get(waybill.id) ?? waybill)
  };
}

export function listActiveAssignments(state) {
  return state.assignments.filter((assignment) => assignment.endAt === null);
}

export class DomainError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DomainError';
  }
}

function appendAudit(state, actorId, action, payload) {
  const allocation = allocateId(state, 'audit', 'aud');
  const entry = {
    id: allocation.id,
    actorId,
    action,
    payload,
    createdAt: new Date().toISOString()
  };
  return {
    ...touch(allocation.state),
    auditLog: [entry, ...allocation.state.auditLog].slice(0, 200)
  };
}

function touch(state) {
  return {
    ...state,
    meta: { ...state.meta, updatedAt: new Date().toISOString() }
  };
}

function allocateId(state, counterName, prefix) {
  const next = (state.counters[counterName] ?? 0) + 1;
  return {
    id: `${prefix}-${next}`,
    state: {
      ...state,
      counters: { ...state.counters, [counterName]: next }
    }
  };
}

function updateVehicle(state, vehicleId, patch) {
  return {
    ...touch(state),
    vehicles: state.vehicles.map((vehicle) => vehicle.id === vehicleId ? { ...vehicle, ...patch } : vehicle)
  };
}

function getUser(state, userId) {
  const user = state.users.find((item) => item.id === userId);
  if (!user) throw new DomainError('Пользователь не найден.');
  return user;
}

function getVehicle(state, vehicleId) {
  const vehicle = state.vehicles.find((item) => item.id === vehicleId);
  if (!vehicle) throw new DomainError('Автомобиль не найден.');
  return vehicle;
}

function getTransfer(state, transferId) {
  const transfer = state.transfers.find((item) => item.id === transferId);
  if (!transfer) throw new DomainError('Передача не найдена.');
  return transfer;
}

function normalizeTransferHandover(command) {
  if (!command.handover) return null;
  const odometer = Number(command.handover.odometer);
  if (!Number.isFinite(odometer) || odometer < 0) {
    throw new DomainError('Укажите корректный текущий пробег автомобиля.');
  }
  const documents = Array.isArray(command.handover.documents) ? command.handover.documents : [];
  const allowedDocuments = new Set(['STS', 'SERVICE_BOOK', 'FUEL_CARD', 'INSURANCE_POLICY']);
  if (documents.some((item) => !allowedDocuments.has(item))) {
    throw new DomainError('Указан неизвестный передаваемый документ.');
  }
  return {
    odometer,
    documents: [...new Set(documents)],
    comment: String(command.handover.comment ?? '').trim().slice(0, 2000)
  };
}

function getWaybill(state, waybillId) {
  const waybill = state.waybills.find((item) => item.id === waybillId);
  if (!waybill) throw new DomainError('Путевой лист не найден.');
  return waybill;
}

function getWaybillFile(state, fileId) {
  const file = (state.waybillFiles ?? []).find((item) => item.id === fileId);
  if (!file) throw new DomainError('Файл путевого листа не найден.');
  return file;
}

function assertRole(state, userId, roles) {
  const user = getUser(state, userId);
  if (!roles.includes(user.role)) {
    throw new DomainError('Недостаточно прав для операции.');
  }
}

function assertSameActor(actorId, subjectId) {
  if (actorId !== subjectId) {
    throw new DomainError('Нельзя выполнить операцию от имени другого пользователя.');
  }
}

function assertSamePortal(user, resource) {
  if ((user.portalId ?? 'local') !== (resource.portalId ?? 'local')) {
    throw new DomainError('Пользователь и объект относятся к разным порталам.');
  }
}

function assertCurrentDriver(vehicle, driverId) {
  if (vehicle.currentDriverId !== driverId) {
    throw new DomainError('Операция доступна только текущему водителю автомобиля.');
  }
}

function hasActiveVehicle(state, driverId) {
  return state.vehicles.some((vehicle) => vehicle.currentDriverId === driverId && vehicle.status !== VehicleStatus.FREE);
}

function hasDriverCorrectionWaybill(state, driverId) {
  return state.waybills.some((waybill) =>
    waybill.driverId === driverId && waybill.status === WaybillStatus.DRIVER_CORRECTION
  );
}

function assertWaybillsCompleteForReturn(state, vehicleId, driverId, returnedAt) {
  const missingDates = missingWaybillDatesForReturn(state, vehicleId, driverId, returnedAt);
  if (missingDates.length > 0) {
    throw new DomainError(`Нельзя сдать автомобиль: не созданы путевые листы за даты ${formatDateList(missingDates)}.`);
  }
}

function missingWaybillDatesForReturn(state, vehicleId, driverId, returnedAt) {
  const assignment = state.assignments.find((item) =>
    item.vehicleId === vehicleId && item.driverId === driverId && item.endAt === null
  );
  if (!assignment) throw new DomainError('Активное закрепление автомобиля не найдено.');

  const startDate = datePartFromInstant(assignment.startAt, 'assignedAt');
  const endDate = datePartFromInstant(returnedAt, 'returnedAt');
  if (endDate < startDate) {
    throw new DomainError('Дата сдачи автомобиля не может быть раньше даты его получения.');
  }

  const coveredDates = new Set(state.waybills
    .filter((waybill) =>
      waybill.vehicleId === vehicleId
      && waybill.driverId === driverId
      && waybill.status !== WaybillStatus.REJECTED
    )
    .map((waybill) => waybill.waybillDate));

  return datesBetween(startDate, endDate).filter((date) => !coveredDates.has(date));
}

function normalizeWaybillOdometerInput(state, vehicleId, waybillDate, command, excludedWaybillId = null) {
  const hasEndOdometer = command.endOdometer !== undefined
    && command.endOdometer !== null
    && command.endOdometer !== '';
  if (!hasEndOdometer) {
    requireNumber(command.distanceKm, 'distanceKm');
    if (command.distanceKm < 0) {
      throw new DomainError('Пробег и топливные значения не могут быть отрицательными.');
    }
    return {
      distanceKm: command.distanceKm,
      reportedEndOdometer: null
    };
  }

  requireNumber(command.endOdometer, 'endOdometer');
  const startOdometer = previousOdometerBeforeWaybill(state, vehicleId, waybillDate, excludedWaybillId);
  if (command.endOdometer < startOdometer) {
    throw new DomainError('Показание спидометра на конец дня не может быть меньше начального пробега.');
  }
  return {
    distanceKm: command.endOdometer - startOdometer,
    reportedEndOdometer: command.endOdometer
  };
}

function normalizeWaybillFuelInput(state, vehicleId, waybillDate, command, excludedWaybillId = null) {
  requireNumber(command.fuelAdded, 'fuelAdded');
  if (command.fuelAdded < 0) {
    throw new DomainError('Пробег и топливные значения не могут быть отрицательными.');
  }
  const hasEndFuel = command.endFuel !== undefined
    && command.endFuel !== null
    && command.endFuel !== '';
  if (!hasEndFuel) {
    requireNumber(command.fuelSpent, 'fuelSpent');
    if (command.fuelSpent < 0) {
      throw new DomainError('Пробег и топливные значения не могут быть отрицательными.');
    }
    return {
      fuelAdded: command.fuelAdded,
      fuelSpent: command.fuelSpent,
      reportedEndFuel: null
    };
  }

  requireNumber(command.endFuel, 'endFuel');
  const startFuel = previousFuelBeforeWaybill(state, vehicleId, waybillDate, excludedWaybillId);
  if (command.endFuel < 0) {
    throw new DomainError('Остаток топлива в баке на конец дня не может быть отрицательным.');
  }
  if (command.endFuel > startFuel + command.fuelAdded) {
    throw new DomainError('Остаток топлива в баке на конец дня не может быть больше начального остатка и заправленного топлива.');
  }
  return {
    fuelAdded: command.fuelAdded,
    fuelSpent: startFuel + command.fuelAdded - command.endFuel,
    reportedEndFuel: command.endFuel
  };
}

function previousOdometerBeforeWaybill(state, vehicleId, waybillDate, excludedWaybillId = null) {
  const vehicle = getVehicle(state, vehicleId);
  const previousWaybill = state.waybills
    .filter((waybill) =>
      waybill.vehicleId === vehicleId
      && waybill.id !== excludedWaybillId
      && waybill.status !== WaybillStatus.REJECTED
      && waybill.waybillDate < waybillDate
    )
    .sort(compareWaybills)
    .at(-1);
  return previousWaybill?.endOdometer ?? vehicle.startOdometer;
}

function previousFuelBeforeWaybill(state, vehicleId, waybillDate, excludedWaybillId = null) {
  const vehicle = getVehicle(state, vehicleId);
  const previousWaybill = state.waybills
    .filter((waybill) =>
      waybill.vehicleId === vehicleId
      && waybill.id !== excludedWaybillId
      && waybill.status !== WaybillStatus.REJECTED
      && waybill.waybillDate < waybillDate
    )
    .sort(compareWaybills)
    .at(-1);
  return previousWaybill?.endFuel ?? vehicle.startFuel;
}

function datesBetween(startDate, endDate) {
  const dates = [];
  const cursor = new Date(`${startDate}T00:00:00.000Z`);
  const end = new Date(`${endDate}T00:00:00.000Z`);
  while (cursor <= end) {
    dates.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return dates;
}

function wasAssignedOnDate(state, vehicleId, driverId, date) {
  const dayStart = new Date(`${date}T00:00:00.000Z`).getTime();
  const dayEnd = new Date(`${date}T23:59:59.999Z`).getTime();
  return state.assignments.some((assignment) => {
    if (assignment.vehicleId !== vehicleId || assignment.driverId !== driverId) return false;
    const start = new Date(assignment.startAt).getTime();
    const end = assignment.endAt ? new Date(assignment.endAt).getTime() : Number.POSITIVE_INFINITY;
    return start <= dayEnd && dayStart <= end;
  });
}

function assertWaybillTransition(actor, waybill, nextStatus) {
  const driverTransitions = new Set([
    `${WaybillStatus.DRAFT}:${WaybillStatus.ACCOUNTING_REVIEW}`,
    `${WaybillStatus.DRIVER_CORRECTION}:${WaybillStatus.ACCOUNTING_REVIEW}`
  ]);
  const accountingTransitions = new Set([
    `${WaybillStatus.ACCOUNTING_REVIEW}:${WaybillStatus.DRIVER_CORRECTION}`,
    `${WaybillStatus.ACCOUNTING_REVIEW}:${WaybillStatus.PROCESSED}`,
    `${WaybillStatus.ACCOUNTING_REVIEW}:${WaybillStatus.REJECTED}`
  ]);
  const transition = `${waybill.status}:${nextStatus}`;

  if ([Roles.DRIVER, Roles.FLEET_MANAGER].includes(actor.role)) {
    if (waybill.driverId !== actor.id || !driverTransitions.has(transition)) {
      throw new DomainError('Водитель не может выполнить такой переход статуса путевого листа.');
    }
    return;
  }

  if ([Roles.ACCOUNTANT, Roles.ADMIN].includes(actor.role) && accountingTransitions.has(transition)) {
    return;
  }

  throw new DomainError('Недопустимый переход статуса путевого листа.');
}

function assertEditableWaybillOwner(actor, waybill) {
  if (waybill.driverId !== actor.id || ![Roles.DRIVER, Roles.FLEET_MANAGER].includes(actor.role)) {
    throw new DomainError('Изменять файлы путевого листа может только его водитель.');
  }
  if (![WaybillStatus.DRAFT, WaybillStatus.DRIVER_CORRECTION].includes(waybill.status)) {
    throw new DomainError('Файлы путевого листа в этом статусе нельзя изменять.');
  }
}

function compareWaybills(a, b) {
  const byDate = a.waybillDate.localeCompare(b.waybillDate);
  if (byDate !== 0) return byDate;
  return a.createdAt.localeCompare(b.createdAt);
}

function required(value, name) {
  if (value === undefined || value === null || value === '') {
    throw new DomainError(`Поле ${name} обязательно.`);
  }
  return value;
}

function requireText(value, name, maxLength) {
  const text = String(required(value, name)).trim();
  if (!text) throw new DomainError(`Поле ${name} обязательно.`);
  if (text.length > maxLength) throw new DomainError(`Поле ${name} слишком длинное.`);
  return text;
}

function requireFileName(value) {
  const name = requireText(value, 'originalName', 180);
  if (/[\\/\u0000-\u001F]/.test(name) || name === '.' || name === '..') {
    throw new DomainError('Некорректное имя файла.');
  }
  return name;
}

function normalizePlateNumber(value) {
  return value.replace(/\s+/g, '').toLocaleUpperCase('ru-RU');
}

function requireDate(value, name) {
  const date = required(value, name);
  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)
    || Number.isNaN(parsed.getTime())
    || parsed.toISOString().slice(0, 10) !== date) {
    throw new DomainError(`Поле ${name} должно содержать корректную дату.`);
  }
  return date;
}

function datePartFromInstant(value, name) {
  const raw = required(value, name);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(raw))) return requireDate(raw, name);
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    throw new DomainError(`Поле ${name} должно содержать корректную дату.`);
  }
  return parsed.toISOString().slice(0, 10);
}

function formatDateList(dates) {
  return dates.map((date) => new Date(`${date}T00:00:00.000Z`).toLocaleDateString('ru-RU')).join(', ');
}

function requireNumber(value, name) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new DomainError(`Поле ${name} должно быть числом.`);
  }
}

function normalizeNote(value) {
  const note = value === undefined || value === null ? '' : String(value).trim();
  if (note.length > 2000) throw new DomainError('Примечание слишком длинное.');
  return note;
}

function waybillRevisionData(waybill) {
  return {
    distanceKm: waybill.distanceKm,
    fuelAdded: waybill.fuelAdded,
    fuelSpent: waybill.fuelSpent,
    note: waybill.note ?? ''
  };
}

function requirePositiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new DomainError(`Поле ${name} должно быть положительным целым числом.`);
  }
  return number;
}

function requireIdentifier(value, name) {
  const identifier = required(value, name);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(identifier)) {
    throw new DomainError(`Поле ${name} содержит недопустимые символы.`);
  }
  return identifier;
}

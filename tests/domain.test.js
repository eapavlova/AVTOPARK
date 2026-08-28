import test from 'node:test';
import assert from 'node:assert/strict';
import {
  acceptDriverTransfer,
  addVehicle,
  assignFreeVehicle,
  attachWaybillFile,
  changeUserRole,
  confirmReturnToFleet,
  createEmptyState,
  createInitialState,
  createWaybill,
  initiateDriverTransfer,
  initiateReturnToFleet,
  rejectDriverTransfer,
  removeWaybillFile,
  Roles,
  sellVehicle,
  synchronizeBitrixUser,
  updateVehicleReference,
  updateVehicleInitialMetrics,
  updateWaybill,
  updateWaybillStatus,
  VehicleStatus,
  WaybillStatus
} from '../src/domain.js';

const PdfFile = Object.freeze({
  originalName: 'Чек.pdf',
  mimeType: 'application/pdf',
  sizeBytes: 128,
  storageKey: '11111111-1111-4111-8111-111111111111'
});

test('first Bitrix24 user must be a portal administrator and becomes app administrator', () => {
  const empty = createEmptyState();
  assert.throws(() => synchronizeBitrixUser(empty, {
    portalId: 'member-1',
    bitrixUserId: 10,
    name: 'Обычный сотрудник',
    isPortalAdmin: false
  }), /первый вход/i);

  const synchronized = synchronizeBitrixUser(empty, {
    portalId: 'member-1',
    bitrixUserId: 1,
    name: 'Администратор портала',
    isPortalAdmin: true
  });

  assert.equal(synchronized.user.role, Roles.ADMIN);
  assert.equal(synchronized.state.users.length, 1);
});

test('subsequent Bitrix24 users receive driver role by default', () => {
  let state = synchronizeBitrixUser(createEmptyState(), {
    portalId: 'member-1', bitrixUserId: 1, name: 'Администратор', isPortalAdmin: true
  }).state;
  const synchronized = synchronizeBitrixUser(state, {
    portalId: 'member-1', bitrixUserId: 2, name: 'Новый сотрудник', isPortalAdmin: false
  });

  assert.equal(synchronized.user.role, Roles.DRIVER);
});

test('administrator manages roles but cannot demote the last administrator', () => {
  let state = synchronizeBitrixUser(createEmptyState(), {
    portalId: 'member-1', bitrixUserId: 1, name: 'Администратор', isPortalAdmin: true
  }).state;
  state = synchronizeBitrixUser(state, {
    portalId: 'member-1', bitrixUserId: 2, name: 'Сотрудник', isPortalAdmin: false
  }).state;

  assert.throws(() => changeUserRole(state, {
    actorId: 'bx-member-1-1', userId: 'bx-member-1-1', role: Roles.DRIVER
  }), /последнего администратора/i);

  state = changeUserRole(state, {
    actorId: 'bx-member-1-1', userId: 'bx-member-1-2', role: Roles.ACCOUNTANT
  });
  assert.equal(state.users.find((user) => user.id === 'bx-member-1-2').role, Roles.ACCOUNTANT);
});

test('fleet manager edits vehicle reference data without changing the calculation starting point', () => {
  const state = baseState();
  const before = state.vehicles.find((vehicle) => vehicle.id === 'veh-1');
  const updated = updateVehicleReference(state, {
    actorId: 'u-fleet-1',
    vehicleId: 'veh-1',
    plateNumber: ' А123ВС77 ',
    title: 'Lada Largus Cross'
  });
  const vehicle = updated.vehicles.find((item) => item.id === 'veh-1');

  assert.equal(vehicle.plateNumber, 'А123ВС77');
  assert.equal(vehicle.title, 'Lada Largus Cross');
  assert.equal(vehicle.startOdometer, before.startOdometer);
  assert.equal(vehicle.startFuel, before.startFuel);
  assert.equal(vehicle.startAt, before.startAt);
  assert.equal(vehicle.startRecordedBy, before.startRecordedBy);
  assert.equal(updated.auditLog[0].action, 'VEHICLE_REFERENCE_UPDATED');
});

test('driver cannot edit vehicle reference data and duplicate plates are rejected', () => {
  const state = baseState();
  assert.throws(() => updateVehicleReference(state, {
    actorId: 'u-driver-1', vehicleId: 'veh-1', plateNumber: 'А111АА 77', title: 'Другая модель'
  }), /недостаточно прав/i);
  assert.throws(() => updateVehicleReference(state, {
    actorId: 'u-admin-1', vehicleId: 'veh-2', plateNumber: ' а123вс77 ', title: 'Газель Next'
  }), /госномером уже существует/i);
});

test('vehicle start date cannot be in the future', () => {
  assert.throws(() => addVehicle(createInitialState(), {
    actorId: 'u-admin-1',
    plateNumber: 'Е111ЕЕ 77',
    title: 'Lada Vesta',
    startOdometer: 0,
    startFuel: 0,
    startAt: '9999-01-01'
  }), /не может быть в будущем/i);
});

test('initial vehicle metrics can be corrected only before the first waybill', () => {
  let state = baseState();
  state = updateVehicleInitialMetrics(state, {
    actorId: 'u-fleet-1', vehicleId: 'veh-1', startOdometer: 1200, startFuel: 42
  });
  const vehicle = state.vehicles.find((item) => item.id === 'veh-1');
  assert.equal(vehicle.startOdometer, 1200);
  assert.equal(vehicle.startFuel, 42);
  assert.equal(state.auditLog[0].action, 'VEHICLE_INITIAL_METRICS_UPDATED');

  state = assignFreeVehicle(state, {
    actorId: 'u-driver-1', driverId: 'u-driver-1', vehicleId: 'veh-1', assignedAt: '2026-08-02T09:00:00.000Z'
  });
  state = createWaybill(state, {
    actorId: 'u-driver-1', driverId: 'u-driver-1', vehicleId: 'veh-1', waybillDate: '2026-08-03',
    distanceKm: 10, fuelAdded: 0, fuelSpent: 1
  });
  assert.throws(() => updateVehicleInitialMetrics(state, {
    actorId: 'u-admin-1', vehicleId: 'veh-1', startOdometer: 1300, startFuel: 40
  }), /уже создан путевой лист/i);
});

test('ordinary driver cannot take a second active vehicle', () => {
  let state = baseState();
  state = assignFreeVehicle(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    assignedAt: '2026-08-02T09:00:00.000Z'
  });

  assert.throws(() => assignFreeVehicle(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-2',
    assignedAt: '2026-08-02T10:00:00.000Z'
  }), /уже имеет активный автомобиль/i);
});

test('fleet manager cannot take a second active vehicle', () => {
  let state = baseState();
  state = assignFreeVehicle(state, {
    actorId: 'u-fleet-1',
    driverId: 'u-fleet-1',
    vehicleId: 'veh-1',
    assignedAt: '2026-08-02T09:00:00.000Z'
  });

  assert.throws(() => assignFreeVehicle(state, {
    actorId: 'u-fleet-1',
    driverId: 'u-fleet-1',
    vehicleId: 'veh-2',
    assignedAt: '2026-08-02T10:00:00.000Z'
  }), /уже имеет активный автомобиль/i);
});

test('waybill can be created only for the currently assigned vehicle', () => {
  let state = baseState();
  const assignedAt = new Date().toISOString();
  const waybillDate = assignedAt.slice(0, 10);
  state = assignFreeVehicle(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    assignedAt
  });
  state = createWaybill(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    waybillDate,
    distanceKm: 10,
    fuelAdded: 0,
    fuelSpent: 1
  });
  state = initiateDriverTransfer(state, {
    actorId: 'u-driver-1',
    fromDriverId: 'u-driver-1',
    toDriverId: 'u-driver-2',
    vehicleId: 'veh-1'
  });
  state = acceptDriverTransfer(state, {
    actorId: 'u-driver-2',
    transferId: 'trn-1',
    resolvedAt: assignedAt
  });

  assert.throws(() => createWaybill(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    waybillDate,
    distanceKm: 15,
    fuelAdded: 0,
    fuelSpent: 2
  }), /сейчас закреплен/);

  state = createWaybill(state, {
    actorId: 'u-driver-2',
    driverId: 'u-driver-2',
    vehicleId: 'veh-1',
    waybillDate,
    distanceKm: 20,
    fuelAdded: 0,
    fuelSpent: 3
  });

  assert.equal(state.waybills.length, 2);
  assert.equal(state.waybills.at(-1).driverId, 'u-driver-2');
});

test('fleet manager can create a waybill for their currently assigned vehicle', () => {
  let state = baseState();
  state = assignFreeVehicle(state, {
    actorId: 'u-fleet-1',
    driverId: 'u-fleet-1',
    vehicleId: 'veh-1',
    assignedAt: '2026-08-03T09:00:00.000Z'
  });

  state = createWaybill(state, {
    actorId: 'u-fleet-1',
    driverId: 'u-fleet-1',
    vehicleId: 'veh-1',
    waybillDate: '2026-08-03',
    distanceKm: 12,
    fuelAdded: 0,
    fuelSpent: 2
  });

  assert.equal(state.waybills.length, 1);
  assert.equal(state.waybills[0].driverId, 'u-fleet-1');
});

test('driver can transfer a vehicle to fleet manager, who becomes its driver after acceptance', () => {
  let state = baseState();
  const assignedAt = new Date().toISOString();
  state = assignFreeVehicle(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    assignedAt
  });
  state = createWaybill(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    waybillDate: assignedAt.slice(0, 10),
    distanceKm: 10,
    fuelAdded: 0,
    fuelSpent: 1
  });
  state = initiateDriverTransfer(state, {
    actorId: 'u-driver-1',
    fromDriverId: 'u-driver-1',
    toDriverId: 'u-fleet-1',
    vehicleId: 'veh-1',
    handover: { odometer: 12345, documents: ['STS', 'FUEL_CARD'], comment: 'Передача после смены' }
  });

  assert.equal(state.vehicles.find((vehicle) => vehicle.id === 'veh-1').currentDriverId, 'u-driver-1');
  assert.equal(state.vehicles.find((vehicle) => vehicle.id === 'veh-1').status, VehicleStatus.TRANSFER_PENDING);
  assert.deepEqual(state.transfers[0].handover, { odometer: 12345, documents: ['STS', 'FUEL_CARD'], comment: 'Передача после смены' });

  state = acceptDriverTransfer(state, { actorId: 'u-fleet-1', transferId: 'trn-1' });

  assert.equal(state.vehicles.find((vehicle) => vehicle.id === 'veh-1').currentDriverId, 'u-fleet-1');
  assert.equal(state.assignments.filter((assignment) => assignment.vehicleId === 'veh-1').length, 2);
});

test('transfer rejection requires reason and keeps car with original driver', () => {
  let state = baseState();
  const assignedAt = new Date().toISOString();
  state = assignFreeVehicle(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    assignedAt
  });
  state = createWaybill(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    waybillDate: assignedAt.slice(0, 10),
    distanceKm: 10,
    fuelAdded: 0,
    fuelSpent: 1
  });
  state = initiateDriverTransfer(state, {
    actorId: 'u-driver-1',
    fromDriverId: 'u-driver-1',
    toDriverId: 'u-driver-2',
    vehicleId: 'veh-1'
  });

  assert.throws(() => rejectDriverTransfer(state, {
    actorId: 'u-driver-2',
    transferId: 'trn-1',
    reason: ''
  }), /reason/);

  state = rejectDriverTransfer(state, {
    actorId: 'u-driver-2',
    transferId: 'trn-1',
    reason: 'Не готов принять автомобиль'
  });

  assert.equal(state.vehicles.find((vehicle) => vehicle.id === 'veh-1').currentDriverId, 'u-driver-1');
  assert.equal(state.vehicles.find((vehicle) => vehicle.id === 'veh-1').status, VehicleStatus.ASSIGNED);
});

test('return to fleet makes vehicle free only after fleet manager confirmation', () => {
  let state = baseState();
  state = assignFreeVehicle(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    assignedAt: '2026-08-02T09:00:00.000Z'
  });
  state = createWaybill(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    waybillDate: '2026-08-02',
    distanceKm: 30,
    fuelAdded: 0,
    fuelSpent: 4
  });
  state = initiateReturnToFleet(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    note: 'Смена завершена',
    returnedAt: '2026-08-02T18:00:00.000Z'
  });

  assert.equal(state.vehicles.find((vehicle) => vehicle.id === 'veh-1').status, VehicleStatus.RETURN_PENDING);
  assert.equal(state.vehicles.find((vehicle) => vehicle.id === 'veh-1').currentDriverId, 'u-driver-1');

  state = confirmReturnToFleet(state, { actorId: 'u-fleet-1', transferId: 'trn-1' });

  assert.equal(state.vehicles.find((vehicle) => vehicle.id === 'veh-1').status, VehicleStatus.FREE);
  assert.equal(state.vehicles.find((vehicle) => vehicle.id === 'veh-1').currentDriverId, null);
});

test('driver cannot return a vehicle until every ownership day has a waybill', () => {
  let state = baseState();
  state = assignFreeVehicle(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    assignedAt: '2026-08-01T09:00:00.000Z'
  });
  state = createWaybill(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    waybillDate: '2026-08-01',
    distanceKm: 10,
    fuelAdded: 0,
    fuelSpent: 1
  });
  state = createWaybill(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    waybillDate: '2026-08-03',
    distanceKm: 30,
    fuelAdded: 0,
    fuelSpent: 3
  });

  assert.throws(() => initiateReturnToFleet(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    returnedAt: '2026-08-04T18:00:00.000Z'
  }), /02\.08\.2026, 04\.08\.2026/);

  state = createWaybill(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    waybillDate: '2026-08-02',
    distanceKm: 20,
    fuelAdded: 0,
    fuelSpent: 2
  });
  state = createWaybill(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    waybillDate: '2026-08-04',
    distanceKm: 40,
    fuelAdded: 0,
    fuelSpent: 4
  });
  state = initiateReturnToFleet(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    returnedAt: '2026-08-04T18:00:00.000Z'
  });

  assert.equal(state.vehicles.find((vehicle) => vehicle.id === 'veh-1').status, VehicleStatus.RETURN_PENDING);
});

test('driver and fleet manager cannot transfer a vehicle until every ownership day has a waybill', () => {
  for (const [driverId, recipientId] of [['u-driver-1', 'u-driver-2'], ['u-fleet-1', 'u-driver-1']]) {
    let state = baseState();
    state = assignFreeVehicle(state, {
      actorId: driverId,
      driverId,
      vehicleId: 'veh-1',
      assignedAt: new Date().toISOString()
    });

    assert.throws(() => initiateDriverTransfer(state, {
      actorId: driverId,
      fromDriverId: driverId,
      toDriverId: recipientId,
      vehicleId: 'veh-1'
    }), /нельзя передать автомобиль/i);
  }
});

test('fleet manager own return immediately frees the vehicle without acceptance', () => {
  let state = baseState();
  state = assignFreeVehicle(state, {
    actorId: 'u-fleet-1',
    driverId: 'u-fleet-1',
    vehicleId: 'veh-1',
    assignedAt: '2026-08-02T09:00:00.000Z'
  });
  state = createWaybill(state, {
    actorId: 'u-fleet-1',
    driverId: 'u-fleet-1',
    vehicleId: 'veh-1',
    waybillDate: '2026-08-02',
    distanceKm: 30,
    fuelAdded: 0,
    fuelSpent: 4
  });
  state = initiateReturnToFleet(state, {
    actorId: 'u-fleet-1',
    driverId: 'u-fleet-1',
    vehicleId: 'veh-1',
    note: 'Вернул после проверки',
    resolvedAt: '2026-08-02T18:00:00.000Z'
  });

  const vehicle = state.vehicles.find((item) => item.id === 'veh-1');
  const assignment = state.assignments.find((item) => item.vehicleId === 'veh-1');
  assert.equal(vehicle.status, VehicleStatus.FREE);
  assert.equal(vehicle.currentDriverId, null);
  assert.equal(assignment.endAt, '2026-08-02T18:00:00.000Z');
  assert.equal(state.transfers.length, 1);
  assert.equal(state.transfers[0].status, 'CONFIRMED');
  assert.equal(state.auditLog[0].action, 'RETURN_CONFIRMED');
});

test('fleet manager cannot confirm an old pending return from self', () => {
  let state = baseState();
  state = assignFreeVehicle(state, {
    actorId: 'u-fleet-1',
    driverId: 'u-fleet-1',
    vehicleId: 'veh-1',
    assignedAt: '2026-08-02T09:00:00.000Z'
  });
  state = {
    ...state,
    vehicles: state.vehicles.map((vehicle) => vehicle.id === 'veh-1'
      ? { ...vehicle, status: VehicleStatus.RETURN_PENDING }
      : vehicle),
    transfers: [{
      id: 'trn-old',
      type: 'RETURN_TO_FLEET',
      status: 'PENDING',
      vehicleId: 'veh-1',
      fromDriverId: 'u-fleet-1',
      toDriverId: null,
      createdBy: 'u-fleet-1',
      createdAt: '2026-08-02T18:00:00.000Z',
      resolvedAt: null,
      reason: null
    }]
  };

  assert.throws(
    () => confirmReturnToFleet(state, { actorId: 'u-fleet-1', transferId: 'trn-old' }),
    /не требуется подтверждать собственную сдачу/
  );
});

test('fleet manager or administrator can sell a free vehicle and retain its history', () => {
  let state = assignedState();
  state = createWaybill(state, {
    actorId: 'u-driver-1', driverId: 'u-driver-1', vehicleId: 'veh-1', waybillDate: '2026-08-02',
    distanceKm: 10, fuelAdded: 0, fuelSpent: 1
  });
  state = createWaybill(state, {
    actorId: 'u-driver-1', driverId: 'u-driver-1', vehicleId: 'veh-1', waybillDate: '2026-08-03',
    distanceKm: 30, fuelAdded: 0, fuelSpent: 4
  });
  for (const waybill of state.waybills) {
    state = updateWaybillStatus(state, {
      actorId: 'u-driver-1', waybillId: waybill.id, status: WaybillStatus.ACCOUNTING_REVIEW
    });
    state = updateWaybillStatus(state, {
      actorId: 'u-accountant-1', waybillId: waybill.id, status: WaybillStatus.PROCESSED
    });
  }
  state = initiateReturnToFleet(state, {
    actorId: 'u-driver-1', driverId: 'u-driver-1', vehicleId: 'veh-1', returnedAt: '2026-08-03T18:00:00.000Z'
  });
  state = confirmReturnToFleet(state, { actorId: 'u-fleet-1', transferId: 'trn-1' });
  state = sellVehicle(state, { actorId: 'u-fleet-1', vehicleId: 'veh-1', soldAt: '2026-08-03' });

  const vehicle = state.vehicles.find((item) => item.id === 'veh-1');
  assert.equal(vehicle.status, VehicleStatus.SOLD);
  assert.equal(vehicle.soldAt, '2026-08-03');
  assert.equal(state.waybills.length, 2);
  assert.equal(state.auditLog[0].action, 'VEHICLE_SOLD');
  assert.throws(() => assignFreeVehicle(state, {
    actorId: 'u-driver-2', driverId: 'u-driver-2', vehicleId: 'veh-1'
  }), /уже не свободен/i);
  assert.throws(() => createWaybill(state, {
    actorId: 'u-driver-1', driverId: 'u-driver-1', vehicleId: 'veh-1', waybillDate: '2026-08-04',
    distanceKm: 10, fuelAdded: 0, fuelSpent: 1
  }), /после даты продажи/i);
});

test('sale is restricted to free vehicles with completed waybills', () => {
  const assigned = assignedState();
  assert.throws(() => sellVehicle(assigned, {
    actorId: 'u-admin-1', vehicleId: 'veh-1', soldAt: '2026-08-03'
  }), /только свободный/i);
  assert.throws(() => sellVehicle(baseState(), {
    actorId: 'u-driver-1', vehicleId: 'veh-1', soldAt: '2026-08-03'
  }), /недостаточно прав/i);
});

test('backdated waybill becomes previous source for the next waybill', () => {
  let state = assignedState();
  state = createWaybill(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    waybillDate: '2026-08-05',
    distanceKm: 100,
    fuelAdded: 0,
    fuelSpent: 10
  });
  state = createWaybill(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    waybillDate: '2026-08-03',
    distanceKm: 30,
    fuelAdded: 5,
    fuelSpent: 4
  });

  const first = state.waybills.find((waybill) => waybill.waybillDate === '2026-08-03');
  const second = state.waybills.find((waybill) => waybill.waybillDate === '2026-08-05');

  assert.equal(first.startOdometer, 1000);
  assert.equal(first.endOdometer, 1030);
  assert.equal(second.startOdometer, 1030);
  assert.equal(second.endOdometer, 1130);
  assert.equal(second.startFuel, 51);
});

test('out-of-order daily waybills recalculate by waybill date', () => {
  let state = baseState();
  state = assignFreeVehicle(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    assignedAt: '2026-08-01T09:00:00.000Z'
  });
  state = createWaybill(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    waybillDate: '2026-08-01',
    distanceKm: 10,
    fuelAdded: 0,
    fuelSpent: 1
  });
  state = createWaybill(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    waybillDate: '2026-08-03',
    distanceKm: 30,
    fuelAdded: 0,
    fuelSpent: 3
  });
  state = createWaybill(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    waybillDate: '2026-08-02',
    distanceKm: 20,
    fuelAdded: 0,
    fuelSpent: 2
  });

  const first = state.waybills.find((waybill) => waybill.waybillDate === '2026-08-01');
  const second = state.waybills.find((waybill) => waybill.waybillDate === '2026-08-02');
  const third = state.waybills.find((waybill) => waybill.waybillDate === '2026-08-03');
  assert.equal(first.startOdometer, 1000);
  assert.equal(second.startOdometer, 1010);
  assert.equal(third.startOdometer, 1030);
  assert.equal(third.endOdometer, 1060);
  assert.equal(third.startFuel, 47);
});

test('reported end odometer is preserved when waybills are created out of order', () => {
  let state = baseState();
  state = assignFreeVehicle(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    assignedAt: '2026-08-01T09:00:00.000Z'
  });
  state = createWaybill(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    waybillDate: '2026-08-01',
    endOdometer: 1010,
    fuelAdded: 0,
    fuelSpent: 1
  });
  state = createWaybill(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    waybillDate: '2026-08-03',
    endOdometer: 1060,
    fuelAdded: 0,
    fuelSpent: 3
  });
  state = createWaybill(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    waybillDate: '2026-08-02',
    endOdometer: 1030,
    fuelAdded: 0,
    fuelSpent: 2
  });

  const first = state.waybills.find((waybill) => waybill.waybillDate === '2026-08-01');
  const second = state.waybills.find((waybill) => waybill.waybillDate === '2026-08-02');
  const third = state.waybills.find((waybill) => waybill.waybillDate === '2026-08-03');
  assert.equal(first.distanceKm, 10);
  assert.equal(second.distanceKm, 20);
  assert.equal(third.startOdometer, 1030);
  assert.equal(third.distanceKm, 30);
  assert.equal(third.endOdometer, 1060);
});

test('reported end fuel calculates fuel spent automatically', () => {
  let state = assignedState();
  state = createWaybill(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    waybillDate: '2026-08-03',
    endOdometer: 1030,
    fuelAdded: 10,
    endFuel: 52
  });

  const waybill = state.waybills[0];
  assert.equal(waybill.startFuel, 50);
  assert.equal(waybill.fuelAdded, 10);
  assert.equal(waybill.fuelSpent, 8);
  assert.equal(waybill.endFuel, 52);
});

test('waybill accepts an empty refueling value as zero liters', () => {
  let state = assignedState();
  state = createWaybill(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    waybillDate: '2026-08-03',
    endOdometer: 1030,
    endFuel: 45
  });

  const waybill = state.waybills[0];
  assert.equal(waybill.fuelAdded, 0);
  assert.equal(waybill.fuelSpent, 5);
});

test('driver route is stored in a waybill and can be corrected', () => {
  let state = assignedState();
  state = createWaybill(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    waybillDate: '2026-08-03',
    endOdometer: 1030,
    endFuel: 45,
    route: 'Гараж → склад № 1 → гараж'
  });
  assert.equal(state.waybills[0].route, 'Гараж → склад № 1 → гараж');

  state = updateWaybill(state, {
    actorId: 'u-driver-1',
    waybillId: 'way-1',
    endOdometer: 1030,
    endFuel: 45,
    route: 'Гараж → АЗС → склад № 1 → гараж'
  });
  assert.equal(state.waybills[0].route, 'Гараж → АЗС → склад № 1 → гараж');
});

test('reported end fuel cannot exceed available fuel', () => {
  const state = assignedState();
  assert.throws(() => createWaybill(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    waybillDate: '2026-08-03',
    endOdometer: 1030,
    fuelAdded: 5,
    endFuel: 60
  }), /больше начального остатка/i);
});

test('rejected waybill is excluded from calculation chain', () => {
  let state = assignedState();
  state = createWaybill(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    waybillDate: '2026-08-03',
    distanceKm: 30,
    fuelAdded: 0,
    fuelSpent: 4
  });
  state = createWaybill(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    waybillDate: '2026-08-04',
    distanceKm: 20,
    fuelAdded: 0,
    fuelSpent: 3
  });

  state = updateWaybillStatus(state, {
    actorId: 'u-driver-1',
    waybillId: 'way-1',
    status: WaybillStatus.ACCOUNTING_REVIEW
  });
  state = updateWaybillStatus(state, {
    actorId: 'u-accountant-1',
    waybillId: 'way-1',
    status: WaybillStatus.REJECTED
  });

  const rejected = state.waybills.find((waybill) => waybill.id === 'way-1');
  const next = state.waybills.find((waybill) => waybill.id === 'way-2');

  assert.equal(rejected.startOdometer, null);
  assert.equal(next.startOdometer, 1000);
  assert.equal(next.endOdometer, 1020);
  assert.equal(next.startFuel, 50);
  assert.equal(next.endFuel, 47);
});

test('driver with correction waybill cannot create a new waybill', () => {
  let state = assignedState();
  state = createWaybill(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    waybillDate: '2026-08-03',
    distanceKm: 30,
    fuelAdded: 0,
    fuelSpent: 4
  });
  state = updateWaybillStatus(state, {
    actorId: 'u-driver-1',
    waybillId: 'way-1',
    status: WaybillStatus.ACCOUNTING_REVIEW
  });
  state = updateWaybillStatus(state, {
    actorId: 'u-accountant-1',
    waybillId: 'way-1',
    status: WaybillStatus.DRIVER_CORRECTION
  });

  assert.throws(() => createWaybill(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    waybillDate: '2026-08-04',
    distanceKm: 20,
    fuelAdded: 0,
    fuelSpent: 3
  }), /корректировке/i);
});

test('driver corrects own waybill and the revision recalculates following sheets', () => {
  let state = assignedState();
  state = createWaybill(state, {
    actorId: 'u-driver-1', driverId: 'u-driver-1', vehicleId: 'veh-1', waybillDate: '2026-08-03',
    distanceKm: 30, fuelAdded: 0, fuelSpent: 4, note: 'Первая версия'
  });
  state = createWaybill(state, {
    actorId: 'u-driver-1', driverId: 'u-driver-1', vehicleId: 'veh-1', waybillDate: '2026-08-04',
    distanceKm: 20, fuelAdded: 0, fuelSpent: 3
  });

  state = updateWaybill(state, {
    actorId: 'u-driver-1', waybillId: 'way-1',
    distanceKm: 40, fuelAdded: 0, fuelSpent: 5, note: 'Исправлено водителем'
  });

  const first = state.waybills.find((waybill) => waybill.id === 'way-1');
  const next = state.waybills.find((waybill) => waybill.id === 'way-2');
  assert.equal(first.endOdometer, 1040);
  assert.equal(first.endFuel, 45);
  assert.equal(next.startOdometer, 1040);
  assert.equal(next.startFuel, 45);
  assert.equal(state.waybillRevisions.length, 1);
  assert.deepEqual(state.waybillRevisions[0].before, {
    distanceKm: 30, fuelAdded: 0, fuelSpent: 4, route: '', note: 'Первая версия'
  });
  assert.deepEqual(state.waybillRevisions[0].after, {
    distanceKm: 40, fuelAdded: 0, fuelSpent: 5, route: '', note: 'Исправлено водителем'
  });
  assert.equal(state.auditLog[0].action, 'WAYBILL_UPDATED');
});

test('waybill editing is limited to its driver and editable statuses', () => {
  let state = assignedState();
  state = createWaybill(state, {
    actorId: 'u-driver-1', driverId: 'u-driver-1', vehicleId: 'veh-1', waybillDate: '2026-08-03',
    distanceKm: 30, fuelAdded: 0, fuelSpent: 4
  });
  assert.throws(() => updateWaybill(state, {
    actorId: 'u-accountant-1', waybillId: 'way-1', distanceKm: 20, fuelAdded: 0, fuelSpent: 3
  }), /только его водитель/i);

  state = updateWaybillStatus(state, {
    actorId: 'u-driver-1', waybillId: 'way-1', status: WaybillStatus.ACCOUNTING_REVIEW
  });
  assert.throws(() => updateWaybill(state, {
    actorId: 'u-driver-1', waybillId: 'way-1', distanceKm: 20, fuelAdded: 0, fuelSpent: 3
  }), /статусе нельзя редактировать/i);
});

test('driver attaches and removes a file from an editable waybill', () => {
  let state = assignedState();
  state = createWaybill(state, {
    actorId: 'u-driver-1', driverId: 'u-driver-1', vehicleId: 'veh-1', waybillDate: '2026-08-03',
    distanceKm: 30, fuelAdded: 0, fuelSpent: 4
  });
  state = attachWaybillFile(state, {
    actorId: 'u-driver-1', waybillId: 'way-1', ...PdfFile
  });

  assert.equal(state.waybillFiles.length, 1);
  assert.equal(state.waybillFiles[0].originalName, 'Чек.pdf');
  assert.equal(state.auditLog[0].action, 'WAYBILL_FILE_ATTACHED');

  state = removeWaybillFile(state, { actorId: 'u-driver-1', fileId: state.waybillFiles[0].id });
  assert.equal(state.waybillFiles.length, 0);
  assert.equal(state.auditLog[0].action, 'WAYBILL_FILE_REMOVED');
});

test('waybill files are limited to their driver and editable statuses', () => {
  let state = assignedState();
  state = createWaybill(state, {
    actorId: 'u-driver-1', driverId: 'u-driver-1', vehicleId: 'veh-1', waybillDate: '2026-08-03',
    distanceKm: 30, fuelAdded: 0, fuelSpent: 4
  });
  assert.throws(() => attachWaybillFile(state, {
    actorId: 'u-driver-2', waybillId: 'way-1', ...PdfFile
  }), /только его водитель/i);
  assert.throws(() => attachWaybillFile(state, {
    actorId: 'u-accountant-1', waybillId: 'way-1', ...PdfFile
  }), /только его водитель/i);

  state = attachWaybillFile(state, {
    actorId: 'u-driver-1', waybillId: 'way-1', ...PdfFile
  });
  state = updateWaybillStatus(state, {
    actorId: 'u-driver-1', waybillId: 'way-1', status: WaybillStatus.ACCOUNTING_REVIEW
  });
  assert.throws(() => removeWaybillFile(state, {
    actorId: 'u-driver-1', fileId: state.waybillFiles[0].id
  }), /статусе нельзя/i);
  assert.throws(() => attachWaybillFile(state, {
    actorId: 'u-driver-1', waybillId: 'way-1',
    ...PdfFile,
    storageKey: '22222222-2222-4222-8222-222222222222'
  }), /статусе нельзя/i);
});

test('waybill attachment validates name, type and size', () => {
  let state = assignedState();
  state = createWaybill(state, {
    actorId: 'u-driver-1', driverId: 'u-driver-1', vehicleId: 'veh-1', waybillDate: '2026-08-03',
    distanceKm: 30, fuelAdded: 0, fuelSpent: 4
  });
  assert.throws(() => attachWaybillFile(state, {
    actorId: 'u-driver-1', waybillId: 'way-1', ...PdfFile, originalName: '../Чек.pdf'
  }), /имя файла/i);
  assert.throws(() => attachWaybillFile(state, {
    actorId: 'u-driver-1', waybillId: 'way-1', ...PdfFile, mimeType: 'text/html'
  }), /тип файла/i);
  assert.throws(() => attachWaybillFile(state, {
    actorId: 'u-driver-1', waybillId: 'way-1', ...PdfFile, sizeBytes: 10 * 1024 * 1024 + 1
  }), /размер файла/i);
});

test('invalid date and non-finite trip values are rejected', () => {
  const state = assignedState();
  assert.throws(() => createWaybill(state, {
    actorId: 'u-driver-1', driverId: 'u-driver-1', vehicleId: 'veh-1', waybillDate: '2026-02-30',
    distanceKm: 10, fuelAdded: 0, fuelSpent: 1
  }), /корректную дату/i);
  assert.throws(() => createWaybill(state, {
    actorId: 'u-driver-1', driverId: 'u-driver-1', vehicleId: 'veh-1', waybillDate: '2026-08-03',
    distanceKm: Number.POSITIVE_INFINITY, fuelAdded: 0, fuelSpent: 1
  }), /должно быть числом/i);
});

test('a user cannot take a free vehicle for another driver', () => {
  const state = baseState();
  assert.throws(() => assignFreeVehicle(state, {
    actorId: 'u-fleet-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1'
  }), /от имени другого пользователя/i);
});

test('failed operation does not mutate counters in source state', () => {
  const state = baseState();
  const before = structuredClone(state.counters);
  assert.throws(() => initiateDriverTransfer(state, {
    actorId: 'u-driver-2',
    fromDriverId: 'u-driver-1',
    toDriverId: 'u-driver-2',
    vehicleId: 'veh-1'
  }), /от имени другого пользователя/i);
  assert.deepEqual(state.counters, before);
});

test('only the driver can submit a draft and only accounting can process it', () => {
  let state = assignedState();
  state = createWaybill(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    waybillDate: '2026-08-03',
    distanceKm: 30,
    fuelAdded: 0,
    fuelSpent: 4
  });

  assert.throws(() => updateWaybillStatus(state, {
    actorId: 'u-accountant-1',
    waybillId: 'way-1',
    status: WaybillStatus.PROCESSED
  }), /переход/i);

  state = updateWaybillStatus(state, {
    actorId: 'u-driver-1',
    waybillId: 'way-1',
    status: WaybillStatus.ACCOUNTING_REVIEW
  });
  state = updateWaybillStatus(state, {
    actorId: 'u-accountant-1',
    waybillId: 'way-1',
    status: WaybillStatus.PROCESSED
  });

  assert.equal(state.waybills[0].status, WaybillStatus.PROCESSED);
});

test('waybill may use a vehicle assigned later on the same date', () => {
  let state = baseState();
  state = assignFreeVehicle(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    assignedAt: '2026-08-03T18:00:00.000Z'
  });

  state = createWaybill(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    waybillDate: '2026-08-03',
    distanceKm: 5,
    fuelAdded: 0,
    fuelSpent: 1
  });

  assert.equal(state.waybills.length, 1);
});

function assignedState() {
  let state = baseState();
  return assignFreeVehicle(state, {
    actorId: 'u-driver-1',
    driverId: 'u-driver-1',
    vehicleId: 'veh-1',
    assignedAt: '2026-08-02T09:00:00.000Z'
  });
}

function baseState() {
  let state = createInitialState();
  state = addVehicle(state, {
    actorId: 'u-admin-1',
    plateNumber: 'А123ВС 77',
    title: 'Lada Largus',
    startOdometer: 1000,
    startFuel: 50,
    startAt: '2026-08-01'
  });
  state = addVehicle(state, {
    actorId: 'u-admin-1',
    plateNumber: 'В456ОР 77',
    title: 'Газель Next',
    startOdometer: 2000,
    startFuel: 40,
    startAt: '2026-08-01'
  });
  return state;
}

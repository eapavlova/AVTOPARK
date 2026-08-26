import test from 'node:test';
import assert from 'node:assert/strict';
import ExcelJS from 'exceljs';
import { createInitialState, Roles, WaybillStatus } from '../src/domain.js';
import {
  createWaybillReport,
  waybillReportToCsv,
  waybillReportToXlsx
} from '../src/reports/waybill-report.js';

test('waybill report enforces role and applies all filters', () => {
  const state = reportState();
  assert.throws(() => createWaybillReport(state, 'u-driver-1'), /недостаточно прав/i);

  const report = createWaybillReport(state, 'u-accountant-1', {
    from: '2026-08-02',
    to: '2026-08-31',
    vehicleId: 'veh-1',
    driverId: 'u-driver-1',
    status: WaybillStatus.PROCESSED
  });

  assert.equal(report.rows.length, 1);
  assert.deepEqual(report.rows[0], {
    waybillDate: '2026-08-03',
    waybillId: 'way-1',
    plateNumber: 'А123АА 77',
    vehicleTitle: 'Лада Гранта',
    driverName: 'Иван Петров',
    status: 'Обработано',
    startOdometer: 100,
    distanceKm: 24.5,
    endOdometer: 124.5,
    startFuel: 20,
    fuelAdded: 10,
    fuelSpent: 6.25,
    endFuel: 23.75,
    note: '=SUM(1;1)'
  });
});

test('waybill report rejects an invalid period', () => {
  const state = reportState();
  assert.throws(() => createWaybillReport(state, 'u-accountant-1', {
    from: '2026-08-31', to: '2026-08-01'
  }), /дата начала/i);
  assert.throws(() => createWaybillReport(state, 'u-accountant-1', {
    from: '2026-02-30'
  }), /календарной датой/i);
});

test('CSV report has UTF-8 BOM, semicolon separators and neutralizes formulas', () => {
  const csv = waybillReportToCsv(createWaybillReport(reportState(), 'u-accountant-1'));
  assert.equal(csv.charCodeAt(0), 0xFEFF);
  assert.match(csv, /"Дата";"Путевой лист"/);
  assert.match(csv, /"'=SUM\(1;1\)"/);
  assert.ok(csv.endsWith('\r\n'));
});

test('XLSX report keeps date and numbers typed and formats the worksheet', async () => {
  const buffer = await waybillReportToXlsx(createWaybillReport(reportState(), 'u-accountant-1'));
  assert.deepEqual(buffer.subarray(0, 2), Buffer.from('PK'));

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet('Путевые листы');
  assert.ok(sheet);
  const targetRow = sheet.getRows(2, sheet.rowCount - 1)
    .find((row) => row.getCell(2).value === 'way-1');
  assert.ok(targetRow);
  assert.equal(targetRow.getCell(1).value instanceof Date, true);
  assert.equal(targetRow.getCell(8).value, 24.5);
  assert.equal(targetRow.getCell(14).value, '=SUM(1;1)');
  assert.equal(sheet.getCell('A1').value, 'Дата');
  assert.equal(sheet.autoFilter, 'A1:N1');
  assert.equal(sheet.views[0].state, 'frozen');
  assert.equal(sheet.views[0].ySplit, 1);
});

function reportState() {
  const state = createInitialState();
  return {
    ...state,
    users: state.users.map((user) => user.id === 'u-accountant-1'
      ? { ...user, role: Roles.ACCOUNTANT }
      : user),
    vehicles: [{
      id: 'veh-1',
      portalId: 'local',
      plateNumber: 'А123АА 77',
      title: 'Лада Гранта',
      status: 'ASSIGNED',
      currentDriverId: 'u-driver-1',
      startOdometer: 100,
      startFuel: 20,
      startAt: '2026-08-01'
    }],
    waybills: [
      {
        id: 'way-1', vehicleId: 'veh-1', driverId: 'u-driver-1', waybillDate: '2026-08-03',
        createdAt: '2026-08-03T12:00:00.000Z', status: WaybillStatus.PROCESSED,
        distanceKm: 24.5, fuelAdded: 10, fuelSpent: 6.25,
        startOdometer: 100, endOdometer: 124.5, startFuel: 20, endFuel: 23.75,
        note: '=SUM(1;1)'
      },
      {
        id: 'way-2', vehicleId: 'veh-1', driverId: 'u-driver-1', waybillDate: '2026-08-01',
        createdAt: '2026-08-01T12:00:00.000Z', status: WaybillStatus.DRAFT,
        distanceKm: 5, fuelAdded: 0, fuelSpent: 1,
        startOdometer: 95, endOdometer: 100, startFuel: 21, endFuel: 20,
        note: ''
      }
    ]
  };
}

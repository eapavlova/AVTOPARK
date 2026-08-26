import ExcelJS from 'exceljs';
import { DomainError, Roles, WaybillStatus } from '../domain.js';

const REPORT_ROLES = new Set([Roles.FLEET_MANAGER, Roles.ACCOUNTANT, Roles.ADMIN]);

export const WAYBILL_REPORT_COLUMNS = Object.freeze([
  { header: 'Дата', key: 'waybillDate', width: 13 },
  { header: 'Путевой лист', key: 'waybillId', width: 16 },
  { header: 'Госномер', key: 'plateNumber', width: 15 },
  { header: 'Автомобиль', key: 'vehicleTitle', width: 24 },
  { header: 'Водитель', key: 'driverName', width: 24 },
  { header: 'Статус', key: 'status', width: 18 },
  { header: 'Пробег начальный, км', key: 'startOdometer', width: 21 },
  { header: 'Пробег поездки, км', key: 'distanceKm', width: 20 },
  { header: 'Пробег конечный, км', key: 'endOdometer', width: 21 },
  { header: 'Топливо начальное, л', key: 'startFuel', width: 21 },
  { header: 'Заправлено, л', key: 'fuelAdded', width: 16 },
  { header: 'Потрачено, л', key: 'fuelSpent', width: 16 },
  { header: 'Топливо конечное, л', key: 'endFuel', width: 21 },
  { header: 'Примечание', key: 'note', width: 32 }
]);

export function createWaybillReport(state, actorId, filters = {}) {
  const actor = state.users.find((user) => user.id === actorId);
  if (!actor || !REPORT_ROLES.has(actor.role)) {
    throw new DomainError('Недостаточно прав для выгрузки отчетов.');
  }

  const normalized = normalizeFilters(filters);
  const vehicles = new Map(state.vehicles.map((vehicle) => [vehicle.id, vehicle]));
  const users = new Map(state.users.map((user) => [user.id, user]));
  const rows = state.waybills
    .filter((waybill) => matchesFilters(waybill, normalized))
    .sort((left, right) => {
      const byDate = left.waybillDate.localeCompare(right.waybillDate);
      return byDate || left.id.localeCompare(right.id);
    })
    .map((waybill) => {
      const vehicle = vehicles.get(waybill.vehicleId);
      const driver = users.get(waybill.driverId);
      return {
        waybillDate: waybill.waybillDate,
        waybillId: waybill.id,
        plateNumber: vehicle?.plateNumber ?? waybill.vehicleId,
        vehicleTitle: vehicle?.title ?? '',
        driverName: driver?.name ?? waybill.driverId,
        status: statusLabel(waybill.status),
        startOdometer: waybill.startOdometer,
        distanceKm: waybill.distanceKm,
        endOdometer: waybill.endOdometer,
        startFuel: waybill.startFuel,
        fuelAdded: waybill.fuelAdded,
        fuelSpent: waybill.fuelSpent,
        endFuel: waybill.endFuel,
        note: waybill.note ?? ''
      };
    });

  return { filters: normalized, rows };
}

export function waybillReportToCsv(report) {
  const header = WAYBILL_REPORT_COLUMNS.map((column) => csvCell(column.header)).join(';');
  const lines = report.rows.map((row) => WAYBILL_REPORT_COLUMNS
    .map((column) => csvCell(row[column.key]))
    .join(';'));
  return `\uFEFF${[header, ...lines].join('\r\n')}\r\n`;
}

export async function waybillReportToXlsx(report) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Autopark';
  workbook.subject = 'Отчет по путевым листам';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet('Путевые листы', {
    views: [{ state: 'frozen', ySplit: 1 }],
    pageSetup: { orientation: 'landscape', fitToPage: true, fitToWidth: 1, fitToHeight: 0 }
  });
  sheet.columns = WAYBILL_REPORT_COLUMNS.map((column) => ({ ...column }));
  sheet.autoFilter = { from: 'A1', to: 'N1' };

  const headerRow = sheet.getRow(1);
  headerRow.height = 30;
  headerRow.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  headerRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF1F6F54' } };
  headerRow.alignment = { vertical: 'middle', wrapText: true };

  for (const row of report.rows) {
    const worksheetRow = sheet.addRow({
      ...row,
      waybillDate: isoDateToExcelDate(row.waybillDate)
    });
    worksheetRow.alignment = { vertical: 'top', wrapText: true };
    if (worksheetRow.number % 2 === 0) {
      worksheetRow.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F7F5' } };
    }
  }

  sheet.getColumn('waybillDate').numFmt = 'yyyy-mm-dd';
  for (const key of ['startOdometer', 'distanceKm', 'endOdometer', 'startFuel', 'fuelAdded', 'fuelSpent', 'endFuel']) {
    sheet.getColumn(key).numFmt = '#,##0.00';
  }
  sheet.eachRow((row) => {
    row.eachCell((cell) => {
      cell.border = {
        bottom: { style: 'thin', color: { argb: 'FFD9E2DE' } }
      };
    });
  });

  return Buffer.from(await workbook.xlsx.writeBuffer());
}

function normalizeFilters(filters) {
  const from = optionalDate(filters.from, 'Дата начала');
  const to = optionalDate(filters.to, 'Дата окончания');
  if (from && to && from > to) {
    throw new DomainError('Дата начала периода не может быть позже даты окончания.');
  }
  const status = optionalString(filters.status);
  if (status && !Object.values(WaybillStatus).includes(status)) {
    throw new DomainError('Неизвестный статус путевого листа.');
  }
  return {
    from,
    to,
    vehicleId: optionalString(filters.vehicleId),
    driverId: optionalString(filters.driverId),
    status
  };
}

function matchesFilters(waybill, filters) {
  return (!filters.from || waybill.waybillDate >= filters.from)
    && (!filters.to || waybill.waybillDate <= filters.to)
    && (!filters.vehicleId || waybill.vehicleId === filters.vehicleId)
    && (!filters.driverId || waybill.driverId === filters.driverId)
    && (!filters.status || waybill.status === filters.status);
}

function optionalDate(value, label) {
  const text = optionalString(value);
  if (!text) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text) || Number.isNaN(Date.parse(`${text}T00:00:00.000Z`))) {
    throw new DomainError(`${label} должна быть календарной датой.`);
  }
  const date = new Date(`${text}T00:00:00.000Z`);
  if (date.toISOString().slice(0, 10) !== text) {
    throw new DomainError(`${label} должна быть календарной датой.`);
  }
  return text;
}

function optionalString(value) {
  if (value === undefined || value === null) return null;
  const text = String(value).trim();
  return text || null;
}

function isoDateToExcelDate(value) {
  return new Date(`${value}T00:00:00.000Z`);
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  let text = String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}

function statusLabel(status) {
  return {
    [WaybillStatus.DRAFT]: 'Черновик',
    [WaybillStatus.ACCOUNTING_REVIEW]: 'На проверке',
    [WaybillStatus.DRIVER_CORRECTION]: 'На корректировке',
    [WaybillStatus.PROCESSED]: 'Обработано',
    [WaybillStatus.REJECTED]: 'Отклонено'
  }[status] ?? status;
}

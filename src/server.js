import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, relative, resolve } from 'node:path';
import {
  acceptDriverTransfer,
  addVehicle,
  attachWaybillFile,
  assignFreeVehicle,
  changeUserRole,
  confirmReturnToFleet,
  createWaybill,
  DomainError,
  initiateDriverTransfer,
  initiateReturnToFleet,
  rejectDriverTransfer,
  removeWaybillFile,
  sellVehicle,
  synchronizeBitrixUser,
  updateVehicleInitialMetrics,
  updateVehicleReference,
  updateWaybill,
  updateWaybillStatus
} from './domain.js';
import { readSessionId, sessionCookie, SessionStore } from './auth/session-store.js';
import { LocalFileStore } from './files/local-file-store.js';
import { createStore } from './store-factory.js';
import { Bitrix24Error } from './integrations/bitrix24/client.js';
import {
  appendPlannedNotifications,
  BitrixNotificationDispatcher
} from './integrations/bitrix24/notification-outbox.js';
import { createBitrix24Service, parseInstallationForm } from './integrations/bitrix24/service.js';
import {
  appendPlannedVehicleSyncs,
  BitrixVehicleSyncDispatcher,
  vehicleSyncConfigFrom
} from './integrations/bitrix24/vehicle-sync.js';
import {
  createWaybillReport,
  waybillReportToCsv,
  waybillReportToXlsx
} from './reports/waybill-report.js';

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';
const publicDir = resolve('public');
const authMode = readAuthMode(process.env.AUTH_MODE ?? 'local');
const appBaseUrl = process.env.APP_BASE_URL ?? `http://${host}:${port}`;
const store = await createStore();
const bitrix24 = createBitrix24Service();
const sessions = new SessionStore();
const notificationDispatcher = new BitrixNotificationDispatcher({ store, bitrix24 });
const fileStore = new LocalFileStore(process.env.FILE_STORAGE_DIR);
const fileMaxBytes = readFileMaxBytes(process.env.FILE_MAX_BYTES ?? String(10 * 1024 * 1024));
const vehicleSyncDispatcher = new BitrixVehicleSyncDispatcher({
  store,
  bitrix24,
  config: vehicleSyncConfigFrom()
});

const routes = [
  ['GET', /^\/api\/health$/, async () => ok({ status: 'ok' })],
  ['GET', /^\/api\/ready$/, async () => {
    await store.load();
    return ok({ status: 'ready' });
  }],
  ['GET', /^\/api\/session$/, async (request) => ok(sessionInfo(request))],
  ['POST', /^\/bitrix\/install$/, async (request) => installBitrix24(request)],
  ['GET', /^\/api\/state$/, async (request) => ok(projectState(await store.load(), actorIdFrom(request)))],
  ['GET', /^\/api\/vehicles$/, async (request) => ok(projectState(await store.load(), actorIdFrom(request)).vehicles)],
  ['GET', /^\/api\/waybills$/, async (request) => ok(projectState(await store.load(), actorIdFrom(request)).waybills)],
  ['GET', /^\/api\/waybill-files\/([^/]+)$/, async (request, match) =>
    downloadWaybillFile(request, match[1])],
  ['GET', /^\/api\/transfer-files\/([^/]+)$/, async (request, match) =>
    downloadTransferFile(request, match[1])],
  ['GET', /^\/api\/reports\/waybills\.(csv|xlsx)$/, async (request, match) =>
    createWaybillReportDownload(request, match[1])],
  ['GET', /^\/api\/transfers$/, async (request) => ok(projectState(await store.load(), actorIdFrom(request)).transfers)],
  ['GET', /^\/api\/audit$/, async (request) => ok(projectState(await store.load(), actorIdFrom(request)).auditLog)],
  ['POST', /^\/api\/vehicles$/, async (request) => mutate(request, addVehicle)],
  ['PATCH', /^\/api\/vehicles\/([^/]+)$/, async (request, match) =>
    mutate(request, updateVehicleReference, { vehicleId: match[1] })],
  ['PATCH', /^\/api\/vehicles\/([^/]+)\/initial-metrics$/, async (request, match) =>
    mutate(request, updateVehicleInitialMetrics, { vehicleId: match[1] })],
  ['POST', /^\/api\/vehicles\/([^/]+)\/assign-free$/, async (request, match) =>
    mutate(request, assignFreeVehicle, { vehicleId: match[1] })],
  ['POST', /^\/api\/vehicles\/([^/]+)\/retire$/, async (request, match) =>
    mutate(request, sellVehicle, { vehicleId: match[1] })],
  ['POST', /^\/api\/vehicles\/([^/]+)\/sell$/, async (request, match) =>
    mutate(request, sellVehicle, { vehicleId: match[1] })],
  ['POST', /^\/api\/transfers\/driver-to-driver$/, async (request) => mutate(request, initiateDriverTransfer)],
  ['POST', /^\/api\/transfers\/return-to-fleet$/, async (request) => mutate(request, initiateReturnToFleet)],
  ['POST', /^\/api\/transfers\/([^/]+)\/files$/, async (request, match) =>
    uploadTransferFile(request, match[1])],
  ['POST', /^\/api\/transfers\/([^/]+)\/accept$/, async (request, match) =>
    mutate(request, acceptDriverTransfer, { transferId: match[1] })],
  ['POST', /^\/api\/transfers\/([^/]+)\/reject$/, async (request, match) =>
    mutate(request, rejectDriverTransfer, { transferId: match[1] })],
  ['POST', /^\/api\/transfers\/([^/]+)\/confirm-return$/, async (request, match) =>
    mutate(request, confirmReturnToFleet, { transferId: match[1] })],
  ['POST', /^\/api\/waybills$/, async (request) => mutate(request, createWaybill)],
  ['POST', /^\/api\/waybills\/([^/]+)\/files$/, async (request, match) =>
    uploadWaybillFile(request, match[1])],
  ['DELETE', /^\/api\/waybill-files\/([^/]+)$/, async (request, match) =>
    deleteWaybillFile(request, match[1])],
  ['PATCH', /^\/api\/waybills\/([^/]+)$/, async (request, match) =>
    mutate(request, updateWaybill, { waybillId: match[1] })],
  ['PATCH', /^\/api\/waybills\/([^/]+)\/status$/, async (request, match) =>
    mutate(request, updateWaybillStatus, { waybillId: match[1] })],
  ['PATCH', /^\/api\/users\/([^/]+)\/role$/, async (request, match) =>
    mutate(request, changeUserRole, { userId: match[1] })]
];

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);
    if (url.pathname === '/bitrix/app' && ['GET', 'POST'].includes(request.method)) {
      return openBitrix24App(request, response);
    }
    const route = routes.find(([method, pattern]) => method === request.method && pattern.test(url.pathname));
    if (route) {
      const [, pattern, handler] = route;
      const result = await handler(request, url.pathname.match(pattern));
      return sendResult(response, result);
    }

    if (request.method === 'GET') {
      return serveStatic(url.pathname, response);
    }

    sendJson(response, 404, { error: 'Not found' });
  } catch (error) {
    const status = error instanceof HttpError ? error.status : error instanceof DomainError ? 422 : 500;
    const message = status === 500 ? 'Внутренняя ошибка сервера.' : error.message;
    if (status === 500) console.error(error);
    sendJson(response, status, { error: message });
  }
});

server.listen(port, host, () => {
  const address = server.address();
  const activePort = typeof address === 'object' && address ? address.port : port;
  console.log(`Autopark is running at http://${host}:${activePort}`);
});

let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM']) {
  process.once(signal, () => void shutdownServer(signal));
}

async function shutdownServer(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Получен ${signal}, сервер Autopark завершает работу.`);
  const forceExit = setTimeout(() => {
    console.error('Сервер Autopark не завершился за 10 секунд.');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  server.close(async (error) => {
    try {
      await notificationDispatcher.close();
      await vehicleSyncDispatcher.close();
      await store.close?.();
      await bitrix24?.close();
    } catch (closeError) {
      console.error('Не удалось закрыть хранилище Autopark:', closeError);
      error ??= closeError;
    }
    clearTimeout(forceExit);
    if (error) console.error('Ошибка при завершении сервера Autopark:', error);
    process.exit(error ? 1 : 0);
  });
}

async function mutate(request, operation, pathParams = {}) {
  const body = await readJson(request);
  const { actorId, memberId } = authContextFrom(request, { requireCsrf: true });
  const state = await applyDomainOperation(operation, { ...body, ...pathParams, actorId });
  dispatchExternal(memberId);
  return ok(projectState(state, actorId));
}

async function applyDomainOperation(operation, command) {
  return store.update((current) => {
    const next = operation(current, command);
    const withNotifications = appendPlannedNotifications(current, next);
    return appendPlannedVehicleSyncs(current, withNotifications);
  });
}

function dispatchExternal(memberId) {
  void notificationDispatcher.dispatchPortal(memberId);
  void vehicleSyncDispatcher.dispatchPortal(memberId);
}

async function readJson(request) {
  const body = await readBody(request);
  if (body.length === 0) return {};
  try {
    return JSON.parse(body);
  } catch {
    throw new HttpError(400, 'Некорректный JSON.');
  }
}

async function readBody(request) {
  return (await readBuffer(request, 1024 * 1024)).toString('utf8');
}

async function readBuffer(request, maxBytes) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBytes) throw new HttpError(413, 'Тело запроса слишком большое.');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

function ok(body) {
  return { status: 200, body };
}

function sendJson(response, status, body) {
  response.writeHead(status, securityHeaders({ 'content-type': 'application/json; charset=utf-8' }));
  response.end(JSON.stringify(body));
}

function sendResult(response, result) {
  if (!result.headers) return sendJson(response, result.status, result.body);
  response.writeHead(result.status, securityHeaders(result.headers));
  response.end(result.body);
}

async function createWaybillReportDownload(request, format) {
  const actorId = actorIdFrom(request);
  const projected = projectState(await store.load(), actorId);
  const url = new URL(request.url, `http://${request.headers.host}`);
  const report = createWaybillReport(projected, actorId, Object.fromEntries(url.searchParams));
  const isXlsx = format === 'xlsx';
  return {
    status: 200,
    body: isXlsx ? await waybillReportToXlsx(report) : waybillReportToCsv(report),
    headers: {
      'content-type': isXlsx
        ? 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
        : 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="autopark-waybills.${format}"`,
      'cache-control': 'no-store'
    }
  };
}

async function uploadWaybillFile(request, waybillId) {
  const { actorId, memberId } = authContextFrom(request, { requireCsrf: true });
  const originalName = decodeFileNameHeader(request.headers['x-file-name']);
  const mimeType = String(request.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
  const declaredLength = Number(request.headers['content-length'] ?? 0);
  if (Number.isFinite(declaredLength) && declaredLength > fileMaxBytes) {
    throw new HttpError(413, 'Файл превышает допустимый размер.');
  }
  const buffer = await readBuffer(request, fileMaxBytes);
  if (buffer.length === 0) throw new HttpError(400, 'Нельзя загрузить пустой файл.');
  const storageKey = await fileStore.put(buffer);
  try {
    const state = await applyDomainOperation(attachWaybillFile, {
      actorId,
      waybillId,
      originalName,
      mimeType,
      sizeBytes: buffer.length,
      storageKey
    });
    dispatchExternal(memberId);
    return ok(projectState(state, actorId));
  } catch (error) {
    await fileStore.remove(storageKey).catch(() => undefined);
    throw error;
  }
}

async function downloadWaybillFile(request, fileId) {
  const state = await store.load();
  const projected = projectState(state, actorIdFrom(request));
  const visibleFile = projected.waybillFiles.find((item) => item.id === fileId);
  if (!visibleFile) throw new HttpError(404, 'Файл путевого листа не найден.');
  const file = (state.waybillFiles ?? []).find((item) => item.id === fileId);
  if (!file) throw new HttpError(404, 'Файл путевого листа не найден.');
  let body;
  try {
    body = await fileStore.read(file.storageKey);
  } catch (error) {
    if (error.code === 'ENOENT') throw new HttpError(404, 'Содержимое файла не найдено.');
    throw error;
  }
  return {
    status: 200,
    body,
    headers: {
      'content-type': 'application/octet-stream',
      'content-length': String(body.length),
      'content-disposition': contentDisposition(file.originalName),
      'cache-control': 'private, no-store'
    }
  };
}

async function uploadTransferFile(request, transferId) {
  const { actorId, memberId } = authContextFrom(request, { requireCsrf: true });
  const originalName = decodeFileNameHeader(request.headers['x-file-name']);
  const mimeType = String(request.headers['content-type'] ?? '').split(';', 1)[0].trim().toLowerCase();
  const category = String(request.headers['x-transfer-file-category'] ?? 'EXTRA').toUpperCase();
  if (!['VEHICLE', 'DASHBOARD', 'EXTRA'].includes(category) || !['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
    throw new HttpError(400, 'Можно загрузить только изображения автомобиля, приборной панели или дополнительные фото.');
  }
  const buffer = await readBuffer(request, fileMaxBytes);
  if (!buffer.length) throw new HttpError(400, 'Нельзя загрузить пустой файл.');
  const storageKey = await fileStore.put(buffer);
  try {
    const state = await store.update((current) => {
      const transfer = current.transfers.find((item) => item.id === transferId);
      const canAttachToCompletedSelfReturn = transfer?.type === 'RETURN_TO_FLEET'
        && transfer?.status === 'CONFIRMED'
        && transfer?.createdBy === actorId
        && transfer?.fromDriverId === actorId;
      if (!transfer || transfer.createdBy !== actorId || (transfer.status !== 'PENDING' && !canAttachToCompletedSelfReturn)) {
        throw new HttpError(403, 'Фотографии может добавить только передающий водитель до завершения передачи.');
      }
      const next = (current.counters.transferFile ?? 0) + 1;
      const file = { id: `tfile-${next}`, transferId, uploadedBy: actorId, category, originalName, mimeType, sizeBytes: buffer.length, storageKey, createdAt: new Date().toISOString() };
      return { ...current, meta: { ...current.meta, updatedAt: file.createdAt }, counters: { ...current.counters, transferFile: next }, transferFiles: [...(current.transferFiles ?? []), file] };
    });
    dispatchExternal(memberId);
    return ok(projectState(state, actorId));
  } catch (error) {
    await fileStore.remove(storageKey).catch(() => undefined);
    throw error;
  }
}

async function downloadTransferFile(request, fileId) {
  const state = await store.load();
  const visible = projectState(state, actorIdFrom(request)).transferFiles.find((item) => item.id === fileId);
  if (!visible) throw new HttpError(404, 'Файл передачи не найден.');
  const file = (state.transferFiles ?? []).find((item) => item.id === fileId);
  const body = await fileStore.read(file.storageKey);
  return { status: 200, body, headers: { 'content-type': file.mimeType, 'content-length': String(body.length), 'content-disposition': contentDisposition(file.originalName), 'cache-control': 'private, no-store' } };
}

async function deleteWaybillFile(request, fileId) {
  const { actorId, memberId } = authContextFrom(request, { requireCsrf: true });
  let removed;
  const state = await store.update((current) => {
    removed = (current.waybillFiles ?? []).find((file) => file.id === fileId);
    const next = removeWaybillFile(current, { actorId, fileId });
    return appendPlannedVehicleSyncs(current, appendPlannedNotifications(current, next));
  });
  if (removed) await fileStore.remove(removed.storageKey).catch((error) => console.warn('Не удалось удалить содержимое файла:', error));
  dispatchExternal(memberId);
  return ok(projectState(state, actorId));
}

async function serveStatic(pathname, response, extraHeaders = {}) {
  const relativePath = pathname === '/' ? 'index.html' : pathname.slice(1);
  const filePath = normalize(join(publicDir, relativePath));
  if (relative(publicDir, filePath).startsWith('..')) {
    response.writeHead(403);
    response.end('Forbidden');
    return;
  }

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) throw new Error('Not a file');
    response.writeHead(200, securityHeaders({ ...extraHeaders, 'content-type': contentType(filePath) }));
    createReadStream(filePath).pipe(response);
  } catch {
    response.writeHead(404);
    response.end('Not found');
  }
}

function actorIdFrom(request) {
  return authContextFrom(request).actorId;
}

function authContextFrom(request, { requireCsrf = false } = {}) {
  if (authMode === 'local') {
    const actorId = request.headers['x-autopark-user-id'];
    if (typeof actorId !== 'string' || actorId.length === 0) {
      throw new HttpError(401, 'Не определен пользователь приложения.');
    }
    return { actorId, memberId: 'local', csrfToken: null };
  }

  const session = sessions.get(readSessionId(request.headers.cookie));
  if (!session) throw new HttpError(401, 'Сеанс Bitrix24 отсутствует или истек. Откройте приложение заново из Bitrix24.');
  if (requireCsrf && !sessions.verifyCsrf(session, request.headers['x-csrf-token'])) {
    throw new HttpError(403, 'Защитный токен запроса недействителен.');
  }
  return session;
}

function sessionInfo(request) {
  const context = authContextFrom(request);
  return {
    authMode,
    actorId: context.actorId,
    csrfToken: context.csrfToken,
    canSwitchUsers: authMode === 'local'
  };
}

async function installBitrix24(request) {
  if (!bitrix24) {
    throw new HttpError(503, 'Интеграция Bitrix24 не настроена в переменных окружения.');
  }
  try {
    const result = await bitrix24.install(parseInstallationForm(await readBody(request)));
    return ok({ status: 'installed', ...result });
  } catch (error) {
    if (error instanceof Bitrix24Error) {
      const status = {
        INVALID_DOMAIN: 400,
        DOMAIN_NOT_ALLOWED: 403,
        INSTALLER_MISMATCH: 401,
        INSTALLER_NOT_ADMIN: 403
      }[error.code] ?? 502;
      throw new HttpError(status, error.message);
    }
    throw error;
  }
}

async function openBitrix24App(request, response) {
  if (authMode === 'local') return serveStatic('/', response);
  if (!bitrix24) throw new HttpError(503, 'Интеграция Bitrix24 не настроена в переменных окружения.');

  if (request.method === 'GET') {
    authContextFrom(request);
    return serveStatic('/', response);
  }

  try {
    const identity = await bitrix24.authenticateFrame(await readBody(request));
    let appUser;
    await store.update((current) => {
      const synchronized = synchronizeBitrixUser(current, {
        portalId: identity.memberId,
        bitrixUserId: identity.bitrixUserId,
        name: identity.name,
        isPortalAdmin: identity.isPortalAdmin
      });
      appUser = synchronized.user;
      return synchronized.state;
    });
    const session = sessions.create({ actorId: appUser.id, memberId: identity.memberId });
    void notificationDispatcher.dispatchPortal(identity.memberId);
    void vehicleSyncDispatcher.dispatchPortal(identity.memberId);
    return serveStatic('/', response, {
      'set-cookie': sessionCookie(session, { secure: appBaseUrl.startsWith('https://') })
    });
  } catch (error) {
    if (error instanceof Bitrix24Error) throw new HttpError(401, error.message);
    throw error;
  }
}

function projectState(state, actorId) {
  const actor = state.users.find((user) => user.id === actorId);
  if (!actor) throw new HttpError(403, 'Пользователь не имеет доступа к приложению.');
  const portalId = actor.portalId ?? 'local';
  const users = state.users.filter((user) => (user.portalId ?? 'local') === portalId);
  const userIds = new Set(users.map((user) => user.id));
  const vehicles = state.vehicles.filter((vehicle) => (vehicle.portalId ?? 'local') === portalId);
  const vehicleIds = new Set(vehicles.map((vehicle) => vehicle.id));
  const portalAssignments = state.assignments.filter((assignment) => vehicleIds.has(assignment.vehicleId));
  const portalTransfers = state.transfers.filter((transfer) => vehicleIds.has(transfer.vehicleId));
  const portalWaybills = state.waybills.filter((waybill) => vehicleIds.has(waybill.vehicleId));
  const portalAudit = state.auditLog.filter((entry) => userIds.has(entry.actorId));
  const seesFleetOperations = ['FLEET_MANAGER', 'ADMIN'].includes(actor.role);
  const seesAllWaybills = ['FLEET_MANAGER', 'ACCOUNTANT', 'ADMIN'].includes(actor.role);
  const visibleWaybills = seesAllWaybills
    ? portalWaybills
    : portalWaybills.filter((waybill) => waybill.driverId === actorId);
  const visibleTransfers = seesFleetOperations
    ? portalTransfers
    : portalTransfers.filter((transfer) => transfer.fromDriverId === actorId || transfer.toDriverId === actorId);
  const visibleWaybillIds = new Set(visibleWaybills.map((waybill) => waybill.id));
  const visibleTransferIds = new Set(visibleTransfers.map((transfer) => transfer.id));

  return {
    meta: state.meta,
    users,
    vehicles,
    assignments: seesFleetOperations
      ? portalAssignments
      : portalAssignments.filter((assignment) => assignment.driverId === actorId),
    transfers: visibleTransfers,
    waybills: visibleWaybills,
    waybillRevisions: (state.waybillRevisions ?? []).filter((revision) => visibleWaybillIds.has(revision.waybillId)),
    waybillFiles: (state.waybillFiles ?? [])
      .filter((file) => visibleWaybillIds.has(file.waybillId))
      .map(({ storageKey, ...file }) => file),
    transferFiles: (state.transferFiles ?? [])
      .filter((file) => visibleTransferIds.has(file.transferId))
      .map(({ storageKey, ...file }) => file),
    auditLog: actor.role === 'ADMIN' ? portalAudit : []
  };
}

function securityHeaders(headers = {}) {
  const allowedFrames = String(process.env.BITRIX_ALLOWED_DOMAINS ?? '')
    .split(',')
    .map((domain) => domain.trim())
    .filter(Boolean)
    .map((domain) => `https://${domain}`);
  return {
    'content-security-policy': `default-src 'self'; frame-ancestors 'self' ${allowedFrames.join(' ')}; base-uri 'none'; form-action 'self'`,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    ...headers
  };
}

function readAuthMode(value) {
  if (!['local', 'bitrix'].includes(value)) {
    throw new Error('AUTH_MODE должен быть local или bitrix.');
  }
  return value;
}

function readFileMaxBytes(value) {
  const maxBytes = Number(value);
  if (!Number.isInteger(maxBytes) || maxBytes <= 0 || maxBytes > 10 * 1024 * 1024) {
    throw new Error('FILE_MAX_BYTES должен быть положительным целым числом не больше 10485760.');
  }
  return maxBytes;
}

function decodeFileNameHeader(value) {
  if (typeof value !== 'string' || !value) throw new HttpError(400, 'Не передано имя файла.');
  try {
    return decodeURIComponent(value);
  } catch {
    throw new HttpError(400, 'Некорректное имя файла.');
  }
}

function contentDisposition(fileName) {
  const encoded = encodeURIComponent(fileName).replace(/['()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
  return `attachment; filename="attachment"; filename*=UTF-8''${encoded}`;
}

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function contentType(filePath) {
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8'
  }[extname(filePath)] ?? 'application/octet-stream';
}

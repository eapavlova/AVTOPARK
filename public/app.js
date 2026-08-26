const state = {
  data: null,
  view: 'vehicles',
  actorId: 'u-driver-1',
  session: null,
  fileWaybillId: null
};

const titles = {
  vehicles: ['Автомобили', 'Единый реестр и текущее закрепление.'],
  transfers: ['Передачи', 'Передача между водителями и сдача в автопарк.'],
  waybills: ['Путевые листы', 'Одна поездка в одном листе, хронология по дате листа.'],
  accounting: ['Бухгалтерия', 'Проверка, возврат, обработка и отклонение.'],
  reports: ['Отчеты', 'Фильтры и выгрузка путевых листов.'],
  users: ['Пользователи', 'Роли и доступ сотрудников к приложению.'],
  audit: ['Аудит', 'Журнал значимых операций серверной части.']
};

document.addEventListener('DOMContentLoaded', async () => {
  bindNavigation();
  bindForms();
  document.querySelector('#refreshButton').addEventListener('click', refresh);
  try {
    await initializeSession();
    await refresh();
  } catch (error) {
    showMessage(error.message, true);
  }
});

async function initializeSession() {
  const response = await fetch('/api/session', {
    headers: { 'x-autopark-user-id': state.actorId },
    credentials: 'same-origin'
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? 'Не удалось определить пользователя.');
  state.session = payload;
  state.actorId = payload.actorId;
}

async function refresh() {
  state.data = await api('/api/state');
  render();
}

function render() {
  renderUsers();
  renderPermissions();
  renderChrome();
  renderVehicles();
  renderTransferOptions();
  renderTransfers();
  renderWaybillOptions();
  renderWaybills();
  renderAccounting();
  renderReports();
  renderUserManagement();
  renderAudit();
}

function renderChrome() {
  if (document.querySelector(`.nav-item[data-view="${state.view}"]`)?.hidden) {
    state.view = 'vehicles';
  }
  const [title, subtitle] = titles[state.view];
  document.querySelector('#viewTitle').textContent = title;
  document.querySelector('#viewSubtitle').textContent = subtitle;
  document.querySelectorAll('.view').forEach((view) => view.classList.remove('active'));
  document.querySelector(`#${state.view}View`).classList.add('active');
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.classList.toggle('active', button.dataset.view === state.view);
  });
}

function renderUsers() {
  const select = document.querySelector('#actorSelect');
  select.innerHTML = state.data.users.map((user) =>
    `<option value="${user.id}">${escapeHtml(actorOptionLabel(user))}</option>`
  ).join('');
  select.value = state.actorId;
  const canSwitch = state.session.canSwitchUsers;
  document.querySelector('#actorSwitcher').hidden = !canSwitch;
  document.querySelector('#identitySummary').hidden = canSwitch;
  document.querySelector('#currentUserLabel').textContent = actorOptionLabel(currentUser());
}

function renderVehicles() {
  const tbody = document.querySelector('#vehiclesTable');
  tbody.innerHTML = state.data.vehicles.map((vehicle) => {
    const driver = userName(vehicle.currentDriverId);
    const canEdit = ['FLEET_MANAGER', 'ADMIN'].includes(currentUser().role);
    const canAssign = vehicle.status === 'FREE' && ['DRIVER', 'FLEET_MANAGER'].includes(currentUser().role);
    return `<tr>
      <td><strong>${escapeHtml(vehicle.plateNumber)}</strong><br><span>${escapeHtml(vehicle.title)}</span></td>
      <td>${statusBadge(vehicle.status)}</td>
      <td>${driver || 'Не закреплен'}</td>
      <td>${vehicle.startOdometer} км<br>${vehicle.startFuel} л</td>
      <td><div class="table-actions">
        ${canAssign ? `<button class="secondary" data-assign="${vehicle.id}">Взять</button>` : ''}
        ${canEdit ? `<button class="ghost" data-edit-vehicle="${vehicle.id}">Изменить</button>` : ''}
      </div></td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-assign]').forEach((button) => {
    button.addEventListener('click', async () => {
      await runAction(() => api(`/api/vehicles/${button.dataset.assign}/assign-free`, {
        method: 'POST',
        body: { driverId: state.actorId }
      }));
    });
  });
  tbody.querySelectorAll('[data-edit-vehicle]').forEach((button) => {
    button.addEventListener('click', () => openVehicleEditor(vehicleById(button.dataset.editVehicle)));
  });
}

function openVehicleEditor(vehicle) {
  const dialog = document.querySelector('#vehicleEditDialog');
  const form = document.querySelector('#vehicleEditForm');
  form.elements.vehicleId.value = vehicle.id;
  form.elements.plateNumber.value = vehicle.plateNumber;
  form.elements.title.value = vehicle.title;
  dialog.showModal();
}

function renderTransferOptions() {
  const currentVehicles = state.data.vehicles.filter((vehicle) =>
    vehicle.currentDriverId === state.actorId && vehicle.status === 'ASSIGNED'
  );
  fillOptions('#transferVehicle', currentVehicles, vehicleLabel);
  fillOptions('#returnVehicle', currentVehicles, vehicleLabel);
  fillOptions('#transferDriver', state.data.users.filter((user) =>
    user.id !== state.actorId && ['DRIVER', 'FLEET_MANAGER'].includes(user.role)
  ), (user) => user.name);
}

function renderTransfers() {
  const container = document.querySelector('#transferList');
  const pending = state.data.transfers.filter((transfer) => transfer.status === 'PENDING');
  if (pending.length === 0) {
    container.innerHTML = '<p>Ожидающих операций нет.</p>';
    return;
  }

  container.innerHTML = pending.map((transfer) => {
    const vehicle = vehicleLabel(vehicleById(transfer.vehicleId));
    const isIncoming = transfer.toDriverId === state.actorId;
    const canConfirm = currentUser().role === 'FLEET_MANAGER' && transfer.type === 'RETURN_TO_FLEET';
    return `<article class="row-card">
      <header>
        <strong>${transfer.type === 'RETURN_TO_FLEET' ? 'Сдача в автопарк' : 'Передача водителю'}</strong>
        <span class="badge pending">Ожидает</span>
      </header>
      <div>${vehicle}<br>От: ${userName(transfer.fromDriverId)}${transfer.toDriverId ? `<br>Кому: ${userName(transfer.toDriverId)}` : ''}</div>
      <div class="actions">
        ${isIncoming ? `<button class="primary" data-accept="${transfer.id}">Принять</button><button class="ghost" data-reject="${transfer.id}">Отклонить</button>` : ''}
        ${canConfirm ? `<button class="primary" data-confirm="${transfer.id}">Подтвердить приемку</button>` : ''}
      </div>
    </article>`;
  }).join('');

  container.querySelectorAll('[data-accept]').forEach((button) => {
    button.addEventListener('click', () => runAction(() => api(`/api/transfers/${button.dataset.accept}/accept`, {
      method: 'POST',
      body: {}
    })));
  });
  container.querySelectorAll('[data-reject]').forEach((button) => {
    button.addEventListener('click', () => {
      const reason = prompt('Причина отказа');
      if (reason) {
        runAction(() => api(`/api/transfers/${button.dataset.reject}/reject`, {
          method: 'POST',
          body: { reason }
        }));
      }
    });
  });
  container.querySelectorAll('[data-confirm]').forEach((button) => {
    button.addEventListener('click', () => runAction(() => api(`/api/transfers/${button.dataset.confirm}/confirm-return`, {
      method: 'POST',
      body: {}
    })));
  });
}

function renderWaybillOptions() {
  const date = document.querySelector('#waybillForm [name="waybillDate"]').value;
  const assignedVehicles = state.data.vehicles.filter((vehicle) => wasAssignedOnDate(vehicle.id, state.actorId, date));
  fillOptions('#waybillVehicle', assignedVehicles, vehicleLabel);
}

function renderWaybills() {
  const tbody = document.querySelector('#waybillsTable');
  tbody.innerHTML = [...state.data.waybills]
    .sort((a, b) => b.waybillDate.localeCompare(a.waybillDate))
    .map((waybill) => {
      const revisions = state.data.waybillRevisions.filter((revision) => revision.waybillId === waybill.id).length;
      const files = state.data.waybillFiles.filter((file) => file.waybillId === waybill.id).length;
      return `<tr>
      <td>${waybill.waybillDate}</td>
      <td>${vehicleLabel(vehicleById(waybill.vehicleId))}</td>
      <td>${userName(waybill.driverId)}</td>
      <td>${waybill.startOdometer ?? '-'} -> ${waybill.endOdometer ?? '-'}</td>
      <td>${waybill.startFuel ?? '-'} -> ${waybill.endFuel ?? '-'}</td>
      <td>${statusBadge(waybill.status)}${revisions ? `<div class="revision-count">Исправлений: ${revisions}</div>` : ''}
        <div class="table-actions waybill-actions">
          ${driverCanEdit(waybill) ? `<button class="ghost compact" data-edit-waybill="${waybill.id}">Изменить</button>` : ''}
          <button class="ghost compact" data-files-waybill="${waybill.id}">${files ? `Файлы: ${files}` : 'Файлы'}</button>
          ${driverCanSubmit(waybill) ? `<button class="secondary compact" data-submit-waybill="${waybill.id}">Отправить на проверку</button>` : ''}
        </div>
      </td>
    </tr>`;
    }).join('');

  tbody.querySelectorAll('[data-submit-waybill]').forEach((button) => {
    button.addEventListener('click', () => runAction(() => api(`/api/waybills/${button.dataset.submitWaybill}/status`, {
      method: 'PATCH',
      body: { status: 'ACCOUNTING_REVIEW' }
    })));
  });
  tbody.querySelectorAll('[data-edit-waybill]').forEach((button) => {
    button.addEventListener('click', () => openWaybillEditor(
      state.data.waybills.find((waybill) => waybill.id === button.dataset.editWaybill)
    ));
  });
  tbody.querySelectorAll('[data-files-waybill]').forEach((button) => {
    button.addEventListener('click', () => openWaybillFiles(button.dataset.filesWaybill));
  });
}

function openWaybillEditor(waybill) {
  const dialog = document.querySelector('#waybillEditDialog');
  const form = document.querySelector('#waybillEditForm');
  form.querySelector('[name="waybillId"]').value = waybill.id;
  form.querySelector('[name="distanceKm"]').value = waybill.distanceKm;
  form.querySelector('[name="fuelAdded"]').value = waybill.fuelAdded;
  form.querySelector('[name="fuelSpent"]').value = waybill.fuelSpent;
  form.querySelector('[name="note"]').value = waybill.note ?? '';
  dialog.showModal();
}

function openWaybillFiles(waybillId) {
  state.fileWaybillId = waybillId;
  renderWaybillFilesDialog();
  document.querySelector('#waybillFilesDialog').showModal();
}

function renderWaybillFilesDialog() {
  const waybill = state.data.waybills.find((item) => item.id === state.fileWaybillId);
  if (!waybill) return;
  document.querySelector('#waybillFilesTitle').textContent = `Файлы листа от ${waybill.waybillDate}`;
  document.querySelector('#waybillFileUploadForm').hidden = !driverCanEdit(waybill);
  const files = state.data.waybillFiles.filter((file) => file.waybillId === waybill.id);
  const list = document.querySelector('#waybillFilesList');
  list.innerHTML = files.length ? files.map((file) => `<article class="file-row">
    <div class="file-details">
      <strong>${escapeHtml(file.originalName)}</strong>
      <span>${formatFileSize(file.sizeBytes)} · ${escapeHtml(userName(file.uploadedBy))}</span>
    </div>
    <div class="table-actions">
      <button class="secondary compact" data-download-file="${file.id}">Скачать</button>
      ${driverCanEdit(waybill) ? `<button class="ghost compact" data-remove-file="${file.id}">Удалить</button>` : ''}
    </div>
  </article>`).join('') : '<p>Файлов пока нет.</p>';

  list.querySelectorAll('[data-download-file]').forEach((button) => {
    button.addEventListener('click', () => downloadWaybillFile(button.dataset.downloadFile));
  });
  list.querySelectorAll('[data-remove-file]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (!confirm('Удалить этот файл?')) return;
      const removed = await runAction(() => api(`/api/waybill-files/${button.dataset.removeFile}`, {
        method: 'DELETE'
      }));
      if (removed) renderWaybillFilesDialog();
    });
  });
}

function renderAccounting() {
  const container = document.querySelector('#accountingList');
  if (state.data.waybills.length === 0) {
    container.innerHTML = '<p>Путевых листов пока нет.</p>';
    return;
  }
  const queue = state.data.waybills.filter((waybill) => waybill.status === 'ACCOUNTING_REVIEW');
  if (queue.length === 0) {
    container.innerHTML = '<p>Листов на проверке нет.</p>';
    return;
  }
  container.innerHTML = queue.map((waybill) => `<article class="row-card">
    <header>
      <strong>${waybill.waybillDate} · ${vehicleLabel(vehicleById(waybill.vehicleId))}</strong>
      ${statusBadge(waybill.status)}
    </header>
    <div>Водитель: ${userName(waybill.driverId)} · Пробег: ${waybill.startOdometer ?? '-'} -> ${waybill.endOdometer ?? '-'}</div>
    <div class="actions">
      <button class="primary" data-status="${waybill.id}:PROCESSED">Обработано</button>
      <button class="ghost" data-status="${waybill.id}:DRIVER_CORRECTION">Вернуть водителю</button>
      <button class="danger" data-status="${waybill.id}:REJECTED">Отклонить</button>
    </div>
  </article>`).join('');

  container.querySelectorAll('[data-status]').forEach((button) => {
    button.addEventListener('click', () => {
      const [waybillId, status] = button.dataset.status.split(':');
      runAction(() => api(`/api/waybills/${waybillId}/status`, {
        method: 'PATCH',
        body: { status }
      }));
    });
  });
}

function renderUserManagement() {
  const tbody = document.querySelector('#usersTable');
  tbody.innerHTML = state.data.users.map((user) => `<tr>
    <td><strong>${escapeHtml(user.name)}</strong></td>
    <td>${user.bitrixUserId ?? 'Локальный пользователь'}</td>
    <td>
      <select data-user-role="${user.id}" aria-label="Роль пользователя ${escapeHtml(user.name)}">
        ${roleOptions(user.role)}
      </select>
    </td>
    <td><button class="secondary" data-save-role="${user.id}">Сохранить</button></td>
  </tr>`).join('');

  tbody.querySelectorAll('[data-save-role]').forEach((button) => {
    button.addEventListener('click', () => {
      const userId = button.dataset.saveRole;
      const role = tbody.querySelector(`[data-user-role="${userId}"]`).value;
      runAction(() => api(`/api/users/${userId}/role`, {
        method: 'PATCH',
        body: { role }
      }));
    });
  });
}

function renderReports() {
  fillReportOptions('#reportVehicle', state.data.vehicles, vehicleLabel, 'Все автомобили');
  fillReportOptions('#reportDriver', state.data.users.filter((user) =>
    ['DRIVER', 'FLEET_MANAGER'].includes(user.role)
  ), (user) => user.name, 'Все водители');
}

function renderAudit() {
  const container = document.querySelector('#auditList');
  container.innerHTML = state.data.auditLog.map((entry) => `<article class="row-card">
    <header>
      <strong>${auditActionLabel(entry.action)}</strong>
      <span>${new Date(entry.createdAt).toLocaleString('ru-RU')}</span>
    </header>
    <div>Пользователь: ${userName(entry.actorId)}</div>
  </article>`).join('');
}

function bindNavigation() {
  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      state.view = button.dataset.view;
      renderChrome();
    });
  });
  document.querySelector('#actorSelect').addEventListener('change', (event) => {
    state.actorId = event.target.value;
    refresh().catch((error) => showMessage(error.message, true));
  });
}

function bindForms() {
  document.querySelector('#vehicleForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    runAction(() => api('/api/vehicles', {
      method: 'POST',
      body: {
        plateNumber: form.get('plateNumber'),
        title: form.get('title'),
        startOdometer: Number(form.get('startOdometer')),
        startFuel: Number(form.get('startFuel')),
        startAt: form.get('startAt')
      }
    }));
  });

  document.querySelector('#vehicleEditForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const saved = await runAction(() => api(`/api/vehicles/${form.get('vehicleId')}`, {
      method: 'PATCH',
      body: { plateNumber: form.get('plateNumber'), title: form.get('title') }
    }));
    if (saved) document.querySelector('#vehicleEditDialog').close();
  });
  document.querySelector('#cancelVehicleEdit').addEventListener('click', closeVehicleEditor);
  document.querySelector('#closeVehicleEdit').addEventListener('click', closeVehicleEditor);

  document.querySelector('#waybillEditForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const saved = await runAction(() => api(`/api/waybills/${form.get('waybillId')}`, {
      method: 'PATCH',
      body: {
        distanceKm: Number(form.get('distanceKm')),
        fuelAdded: Number(form.get('fuelAdded')),
        fuelSpent: Number(form.get('fuelSpent')),
        note: form.get('note')
      }
    }));
    if (saved) document.querySelector('#waybillEditDialog').close();
  });
  document.querySelector('#cancelWaybillEdit').addEventListener('click', closeWaybillEditor);
  document.querySelector('#closeWaybillEdit').addEventListener('click', closeWaybillEditor);

  document.querySelector('#waybillFileUploadForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const input = event.currentTarget.querySelector('input[type="file"]');
    const file = input.files[0];
    if (!file) return showMessage('Выберите файл.', true);
    const uploaded = await runAction(() => uploadWaybillFile(state.fileWaybillId, file));
    if (uploaded) {
      input.value = '';
      renderWaybillFilesDialog();
    }
  });
  document.querySelector('#closeWaybillFiles').addEventListener('click', closeWaybillFiles);

  document.querySelector('#transferForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const vehicle = vehicleById(form.get('vehicleId'));
    runAction(() => api('/api/transfers/driver-to-driver', {
      method: 'POST',
      body: { fromDriverId: state.actorId, vehicleId: vehicle.id, toDriverId: form.get('toDriverId') }
    }));
  });

  document.querySelector('#returnForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    runAction(() => api('/api/transfers/return-to-fleet', {
      method: 'POST',
      body: { driverId: state.actorId, vehicleId: form.get('vehicleId'), note: form.get('note') }
    }));
  });
  document.querySelector('#waybillForm [name="waybillDate"]').addEventListener('change', renderWaybillOptions);

  document.querySelector('#waybillForm').addEventListener('submit', (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    runAction(() => api('/api/waybills', {
      method: 'POST',
      body: {
        driverId: state.actorId,
        vehicleId: form.get('vehicleId'),
        waybillDate: form.get('waybillDate'),
        distanceKm: Number(form.get('distanceKm')),
        fuelAdded: Number(form.get('fuelAdded')),
        fuelSpent: Number(form.get('fuelSpent')),
        note: form.get('note')
      }
    }));
  });

  document.querySelector('#reportForm').addEventListener('submit', (event) => {
    event.preventDefault();
    downloadReport(event.submitter?.dataset.format ?? 'xlsx');
  });
}

async function downloadReport(format) {
  try {
    const params = new URLSearchParams();
    for (const [key, value] of new FormData(document.querySelector('#reportForm'))) {
      if (value) params.set(key, value);
    }
    const headers = {};
    if (state.session.authMode === 'local') headers['x-autopark-user-id'] = state.actorId;
    const response = await fetch(`/api/reports/waybills.${format}?${params}`, {
      headers,
      credentials: 'same-origin'
    });
    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload.error ?? 'Не удалось сформировать отчет.');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `autopark-waybills.${format}`;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showMessage(`Отчет ${format.toUpperCase()} сформирован`);
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function runAction(action) {
  try {
    state.data = await action();
    showMessage('Готово');
    render();
    return true;
  } catch (error) {
    showMessage(error.message, true);
    return false;
  }
}

function closeVehicleEditor() {
  document.querySelector('#vehicleEditDialog').close();
}

function closeWaybillEditor() {
  document.querySelector('#waybillEditDialog').close();
}

function closeWaybillFiles() {
  document.querySelector('#waybillFilesDialog').close();
  state.fileWaybillId = null;
}

async function api(path, options = {}) {
  const method = options.method ?? 'GET';
  const headers = { 'content-type': 'application/json' };
  if (state.session.authMode === 'local') headers['x-autopark-user-id'] = state.actorId;
  if (method !== 'GET' && state.session.csrfToken) headers['x-csrf-token'] = state.session.csrfToken;
  const response = await fetch(path, {
    method,
    headers,
    credentials: 'same-origin',
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? 'Ошибка API');
  return payload;
}

async function uploadWaybillFile(waybillId, file) {
  const headers = {
    'content-type': file.type || 'application/octet-stream',
    'x-file-name': encodeURIComponent(file.name)
  };
  if (state.session.authMode === 'local') headers['x-autopark-user-id'] = state.actorId;
  if (state.session.csrfToken) headers['x-csrf-token'] = state.session.csrfToken;
  const response = await fetch(`/api/waybills/${waybillId}/files`, {
    method: 'POST',
    headers,
    credentials: 'same-origin',
    body: file
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? 'Не удалось загрузить файл.');
  return payload;
}

async function downloadWaybillFile(fileId) {
  try {
    const file = state.data.waybillFiles.find((item) => item.id === fileId);
    const headers = {};
    if (state.session.authMode === 'local') headers['x-autopark-user-id'] = state.actorId;
    const response = await fetch(`/api/waybill-files/${fileId}`, { headers, credentials: 'same-origin' });
    if (!response.ok) {
      const payload = await response.json();
      throw new Error(payload.error ?? 'Не удалось скачать файл.');
    }
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = file.originalName;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    showMessage('Файл скачан');
  } catch (error) {
    showMessage(error.message, true);
  }
}

function fillOptions(selector, items, labeler) {
  const select = document.querySelector(selector);
  select.innerHTML = items.map((item) => `<option value="${item.id}">${escapeHtml(labeler(item))}</option>`).join('');
}

function fillReportOptions(selector, items, labeler, emptyLabel) {
  const select = document.querySelector(selector);
  const selected = select.value;
  select.innerHTML = `<option value="">${emptyLabel}</option>${items.map((item) =>
    `<option value="${item.id}">${escapeHtml(labeler(item))}</option>`
  ).join('')}`;
  if ([...select.options].some((option) => option.value === selected)) select.value = selected;
}

function showMessage(text, isError = false) {
  const message = document.querySelector('#message');
  message.textContent = text;
  message.hidden = false;
  message.classList.toggle('error', isError);
  clearTimeout(showMessage.timer);
  showMessage.timer = setTimeout(() => { message.hidden = true; }, 3500);
}

function currentUser() {
  return state.data.users.find((user) => user.id === state.actorId);
}

function renderPermissions() {
  const role = currentUser().role;
  document.querySelectorAll('[data-roles]').forEach((element) => {
    element.hidden = !element.dataset.roles.split(',').includes(role);
  });
}

function driverCanSubmit(waybill) {
  return waybill.driverId === state.actorId
    && ['DRIVER', 'FLEET_MANAGER'].includes(currentUser().role)
    && ['DRAFT', 'DRIVER_CORRECTION'].includes(waybill.status);
}

function driverCanEdit(waybill) {
  return waybill.driverId === state.actorId
    && ['DRIVER', 'FLEET_MANAGER'].includes(currentUser().role)
    && ['DRAFT', 'DRIVER_CORRECTION'].includes(waybill.status);
}

function wasAssignedOnDate(vehicleId, driverId, date) {
  if (!date) return false;
  const dayStart = new Date(`${date}T00:00:00.000Z`).getTime();
  const dayEnd = new Date(`${date}T23:59:59.999Z`).getTime();
  return state.data.assignments.some((assignment) => {
    if (assignment.vehicleId !== vehicleId || assignment.driverId !== driverId) return false;
    const start = new Date(assignment.startAt).getTime();
    const end = assignment.endAt ? new Date(assignment.endAt).getTime() : Number.POSITIVE_INFINITY;
    return start <= dayEnd && dayStart <= end;
  });
}

function userName(userId) {
  if (!userId) return '';
  return state.data.users.find((user) => user.id === userId)?.name ?? userId;
}

function vehicleById(vehicleId) {
  return state.data.vehicles.find((vehicle) => vehicle.id === vehicleId);
}

function vehicleLabel(vehicle) {
  if (!vehicle) return '';
  return `${vehicle.plateNumber} · ${vehicle.title}`;
}

function roleLabel(role) {
  return {
    DRIVER: 'водитель',
    FLEET_MANAGER: 'заведующий',
    ACCOUNTANT: 'бухгалтер',
    ADMIN: 'администратор'
  }[role] ?? role;
}

function roleOptions(selectedRole) {
  return Object.entries({
    DRIVER: 'Водитель',
    FLEET_MANAGER: 'Заведующий автопарком',
    ACCOUNTANT: 'Бухгалтер',
    ADMIN: 'Администратор'
  }).map(([value, label]) =>
    `<option value="${value}"${value === selectedRole ? ' selected' : ''}>${label}</option>`
  ).join('');
}

function actorOptionLabel(user) {
  const role = roleLabel(user.role);
  return user.name.toLocaleLowerCase('ru-RU').includes(role) ? user.name : `${user.name} · ${role}`;
}

function auditActionLabel(action) {
  return {
    VEHICLE_CREATED: 'Автомобиль добавлен',
    VEHICLE_REFERENCE_UPDATED: 'Основные данные автомобиля изменены',
    VEHICLE_ASSIGNED: 'Автомобиль взят водителем',
    TRANSFER_INITIATED: 'Передача инициирована',
    TRANSFER_ACCEPTED: 'Передача принята',
    TRANSFER_REJECTED: 'Передача отклонена',
    RETURN_INITIATED: 'Сдача в автопарк инициирована',
    RETURN_CONFIRMED: 'Сдача в автопарк подтверждена',
    WAYBILL_CREATED: 'Путевой лист создан',
    WAYBILL_UPDATED: 'Путевой лист исправлен',
    WAYBILL_STATUS_CHANGED: 'Статус путевого листа изменен',
    USER_CREATED_FROM_BITRIX: 'Пользователь добавлен из Bitrix24',
    USER_PROFILE_UPDATED: 'Профиль пользователя обновлен',
    USER_ROLE_CHANGED: 'Роль пользователя изменена'
  }[action] ?? action;
}

function statusBadge(status) {
  const label = {
    FREE: 'Свободен',
    ASSIGNED: 'Закреплен',
    TRANSFER_PENDING: 'Передача',
    RETURN_PENDING: 'Приемка',
    DRAFT: 'Черновик',
    ACCOUNTING_REVIEW: 'Проверка',
    DRIVER_CORRECTION: 'Корректировка',
    PROCESSED: 'Обработано',
    REJECTED: 'Отклонено'
  }[status] ?? status;
  const kind = status === 'FREE' ? 'free' : status.includes('PENDING') ? 'pending' : '';
  return `<span class="badge ${kind}">${label}</span>`;
}

function formatFileSize(bytes) {
  if (bytes < 1024) return `${bytes} Б`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} КБ`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} МБ`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#039;'
  }[char]));
}

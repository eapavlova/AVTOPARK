const state = {
  data: null,
  view: 'vehicles',
  actorId: 'u-driver-1',
  session: null,
  fileWaybillId: null,
  registryFilters: {},
  registrySort: { key: 'recordedAt', direction: 'desc' },
  registrySuggestionsOpen: false
};

const titles = {
  vehicles: ['Взять автомобиль', 'Свободные автомобили, доступные для закрепления.'],
  vehicleRegistry: ['Реестр автомобилей', 'Все автомобили, их статус и текущие показатели.'],
  takeVehicle: ['Взять автомобиль', 'Доступные автомобили для закрепления.'],
  driverTransfers: ['Передать другому водителю', 'Передача автомобиля другому водителю.'],
  pendingTransfers: ['Ожидает приёмки', 'Автомобили, переданные вам и ожидающие вашего решения.'],
  fleetReturns: ['Сдать в автопарк', 'Передача автомобиля на приемку в автопарк.'],
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
  renderCurrentVehicleSummary();
  renderVehicles();
  renderVehicleRegistry();
  renderAvailableVehicles();
  renderTransferOptions();
  renderPendingTransfers();
  renderPendingTransfersCount();
  renderWaybillOptions();
  renderWaybills();
  renderAccounting();
  renderReports();
  renderUserManagement();
  renderAudit();
}

function renderChrome() {
  if (document.querySelector(`.nav-item[data-view="${state.view}"]`)?.hidden) {
    state.view = document.querySelector('.nav-item:not([hidden])')?.dataset.view ?? 'vehicles';
  }
  const [title, subtitle] = titles[state.view];
  document.querySelector('#viewTitle').textContent = title;
  document.querySelector('#viewSubtitle').textContent = subtitle;
  document.querySelector('#refreshButton').hidden = state.view === 'addVehicle';
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

function renderCurrentVehicleSummary() {
  const container = document.querySelector('#currentVehicleSummary');
  const user = currentUser();
  if (!['DRIVER', 'FLEET_MANAGER'].includes(user.role)) {
    container.hidden = true;
    return;
  }

  const vehicle = currentVehicleForCurrentUser();
  container.hidden = false;
  container.classList.toggle('has-vehicle', Boolean(vehicle));
  container.classList.toggle('no-vehicle', !vehicle);
  if (!vehicle) {
    container.innerHTML = '<small>Статус автомобиля</small><strong>За вами не закреплен автомобиль</strong>';
    return;
  }

  container.innerHTML = `
    <small>Статус автомобиля</small>
    <strong>За вами закреплен автомобиль</strong>
    <span>${escapeHtml(vehicleLabel(vehicle))}</span>
  `;
}

function renderVehicles() {
  const assignedVehicle = currentVehicleForCurrentUser();
  const canTakeVehicle = currentUser().role === 'DRIVER' && !assignedVehicle;
  const vehicles = state.data.vehicles
    .filter((vehicle) => vehicle.status === 'FREE')
    .toSorted((left, right) => new Date(right.startRecordedAt) - new Date(left.startRecordedAt));
  renderTakeVehicleStatus('#vehiclesTakeStatus', '#vehiclesTakePanel', assignedVehicle);
  renderVehicleRows('#vehiclesTable', vehicles, {
    canAssign: canTakeVehicle,
    canEdit: false,
    showAssign: currentUser().role === 'DRIVER',
    assignmentBlocked: Boolean(assignedVehicle)
  });
}

function renderVehicleRegistry() {
  renderRegistryControls();
  const vehicles = state.data.vehicles
    .map((vehicle) => registryRow(vehicle))
    .filter(matchesRegistryFilters)
    .toSorted(compareRegistryRows);
  const tbody = document.querySelector('#vehicleRegistryTable');
  tbody.innerHTML = vehicles.map(({ vehicle, metrics, owner, soldAt }) => {
    return `<tr>
      <td><strong>${escapeHtml(vehicle.plateNumber)}</strong><br><span>${escapeHtml(vehicle.title)}</span></td>
      <td>${statusBadge(vehicle.status)}</td>
      <td>${escapeHtml(owner)}</td>
      <td>${formatNumber(metrics.odometer)} км</td>
      <td>${formatNumber(metrics.fuel)} л</td>
      <td>${formatDate(vehicle.startAt)}<br><span>${formatNumber(vehicle.startOdometer)} км · ${formatNumber(vehicle.startFuel)} л</span></td>
      <td>${soldAt ? formatDate(soldAt) : '—'}</td>
      <td><div class="table-actions">
        <button class="ghost" data-edit-vehicle="${vehicle.id}">Изменить</button>
        ${canSellVehicle(vehicle) ? `<button class="danger" data-sell-vehicle="${vehicle.id}">Продать</button>` : ''}
      </div></td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-edit-vehicle]').forEach((button) => {
    button.addEventListener('click', () => openVehicleEditor(vehicleById(button.dataset.editVehicle)));
  });
  tbody.querySelectorAll('[data-sell-vehicle]').forEach((button) => {
    button.addEventListener('click', () => openVehicleSaleDialog(vehicleById(button.dataset.sellVehicle)));
  });
}

function registryRow(vehicle) {
  return {
    vehicle,
    metrics: vehicleCurrentMetrics(vehicle),
    owner: vehicleOwnerText(vehicle),
    soldAt: soldAtFor(vehicle)
  };
}

function matchesRegistryFilters({ vehicle, metrics, owner, soldAt }) {
  const filters = state.registryFilters;
  const search = (filters.search ?? '').trim().toLocaleLowerCase('ru-RU');
  const vehicleText = `${vehicle.plateNumber} ${vehicle.title}`.toLocaleLowerCase('ru-RU');
  const ownerText = owner.toLocaleLowerCase('ru-RU');
  if (filters.vehicleId && vehicle.id !== filters.vehicleId) return false;
  if (search && !filters.vehicleId && !vehicleText.includes(search)) return false;
  if (filters.status && vehicle.status !== filters.status) return false;
  if (filters.owner && !ownerText.includes(filters.owner.trim().toLocaleLowerCase('ru-RU'))) return false;
  if (!isWithinRange(metrics.odometer, filters.odometerFrom, filters.odometerTo)) return false;
  if (!isWithinRange(metrics.fuel, filters.fuelFrom, filters.fuelTo)) return false;
  return true;
}

function isWithinRange(value, from, to) {
  const lower = from === '' || from === undefined ? null : Number(from);
  const upper = to === '' || to === undefined ? null : Number(to);
  return (lower === null || value >= lower) && (upper === null || value <= upper);
}

function compareRegistryRows(left, right) {
  const key = state.registrySort.key;
  const direction = state.registrySort.direction === 'asc' ? 1 : -1;
  const values = {
    vehicle: (row) => `${row.vehicle.plateNumber} ${row.vehicle.title}`,
    status: (row) => vehicleStatusLabel(row.vehicle.status),
    owner: (row) => row.owner,
    odometer: (row) => row.metrics.odometer,
    fuel: (row) => row.metrics.fuel,
    startAt: (row) => row.vehicle.startAt,
    soldAt: (row) => row.soldAt,
    recordedAt: (row) => row.vehicle.startRecordedAt
  };
  const leftValue = values[key](left);
  const rightValue = values[key](right);
  if (leftValue === rightValue) {
    return right.vehicle.id.localeCompare(left.vehicle.id, 'ru', { numeric: true });
  }
  if (leftValue === null || leftValue === undefined) return 1;
  if (rightValue === null || rightValue === undefined) return -1;
  const comparison = typeof leftValue === 'number'
    ? leftValue - rightValue
    : String(leftValue).localeCompare(String(rightValue), 'ru');
  return comparison * direction;
}

function renderRegistryControls() {
  const form = document.querySelector('#registryFilters');
  for (const [name, value] of Object.entries(state.registryFilters)) {
    if (form.elements[name]) form.elements[name].value = value;
  }
  document.querySelectorAll('[data-registry-sort]').forEach((button) => {
    const active = button.dataset.registrySort === state.registrySort.key;
    button.classList.toggle('active', active);
    button.textContent = `${registryColumnLabel(button.dataset.registrySort)}${active
      ? state.registrySort.direction === 'asc' ? ' ↑' : ' ↓'
      : ''}`;
  });
  renderRegistryVehicleSuggestions();
}

function renderRegistryVehicleSuggestions() {
  const menu = document.querySelector('#registryVehicleSuggestions');
  const query = String(state.registryFilters.search ?? '').trim().toLocaleLowerCase('ru-RU');
  const matches = query ? state.data.vehicles
    .filter((vehicle) => `${vehicle.plateNumber} ${vehicle.title}`.toLocaleLowerCase('ru-RU').includes(query))
    .slice(0, 8) : [];

  menu.hidden = !state.registrySuggestionsOpen || matches.length === 0;
  menu.innerHTML = matches.map((vehicle) => `<button type="button" class="autocomplete-option" role="option" data-registry-vehicle="${vehicle.id}">
    <strong>${escapeHtml(vehicle.plateNumber)}</strong><span>${escapeHtml(vehicle.title)}</span>
  </button>`).join('');
  menu.querySelectorAll('[data-registry-vehicle]').forEach((button) => {
    button.addEventListener('mousedown', (event) => event.preventDefault());
    button.addEventListener('click', () => selectRegistryVehicle(button.dataset.registryVehicle));
  });
}

function selectRegistryVehicle(vehicleId) {
  const vehicle = vehicleById(vehicleId);
  if (!vehicle) return;
  state.registryFilters = {
    ...state.registryFilters,
    search: `${vehicle.plateNumber} · ${vehicle.title}`,
    vehicleId
  };
  state.registrySuggestionsOpen = false;
  renderVehicleRegistry();
}

function registryColumnLabel(key) {
  return {
    vehicle: 'Автомобиль', status: 'Статус', owner: 'Кому принадлежит', odometer: 'Текущий пробег',
    fuel: 'Топливо в баке', startAt: 'Старт учета', soldAt: 'Дата продажи', recordedAt: ''
  }[key];
}

function renderAvailableVehicles() {
  const assignedVehicle = currentVehicleForCurrentUser();
  const canTakeVehicle = currentUser().role === 'FLEET_MANAGER' && !assignedVehicle;
  const vehicles = state.data.vehicles
    .filter((vehicle) => vehicle.status === 'FREE')
    .toSorted((left, right) => new Date(right.startRecordedAt) - new Date(left.startRecordedAt));
  renderTakeVehicleStatus('#managerTakeVehicleStatus', '#managerTakeVehiclePanel', assignedVehicle);
  renderVehicleRows('#availableVehiclesTable', vehicles, {
    canAssign: canTakeVehicle,
    canEdit: false,
    showAssign: currentUser().role === 'FLEET_MANAGER',
    assignmentBlocked: Boolean(assignedVehicle)
  });
}

function renderTakeVehicleStatus(blockerSelector, panelSelector, assignedVehicle) {
  const blocker = document.querySelector(blockerSelector);
  const panel = document.querySelector(panelSelector);
  const isBlocked = Boolean(assignedVehicle);
  blocker.hidden = !isBlocked;
  blocker.textContent = assignedVehicle
    ? `Автомобиль взять нельзя, так как за вами уже закреплен автомобиль ${vehicleLabel(assignedVehicle)}.`
    : '';
  panel.classList.toggle('is-disabled', isBlocked);
}

function renderVehicleRows(selector, vehicles, { canAssign, canEdit, showAssign = canAssign, assignmentBlocked = false }) {
  const tbody = document.querySelector(selector);
  tbody.innerHTML = vehicles.map((vehicle) => {
    const driver = userName(vehicle.currentDriverId);
    const metrics = vehicleCurrentMetrics(vehicle);
    const assignButton = showAssign && vehicle.status === 'FREE'
      ? `<button class="secondary" data-assign="${vehicle.id}" ${canAssign ? '' : 'disabled'}>Взять</button>`
      : '';
    return `<tr class="${assignmentBlocked ? 'vehicle-row-disabled' : ''}">
      <td><strong>${escapeHtml(vehicle.plateNumber)}</strong><br><span>${escapeHtml(vehicle.title)}</span></td>
      <td>${statusBadge(vehicle.status)}</td>
      <td>${driver || 'Не закреплен'}</td>
      <td>${formatNumber(metrics.odometer)} км<br>${formatNumber(metrics.fuel)} л</td>
      <td><div class="table-actions">
        ${assignButton}
        ${canEdit ? `<button class="ghost" data-edit-vehicle="${vehicle.id}">Изменить</button>` : ''}
      </div></td>
    </tr>`;
  }).join('');

  tbody.querySelectorAll('[data-assign]').forEach((button) => {
    button.addEventListener('click', async () => {
      if (currentVehicleForCurrentUser()) {
        showMessage('Автомобиль взять нельзя, так как за вами уже закреплен автомобиль.', true);
        return;
      }
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
  const canEditInitialMetrics = !state.data.waybills.some((waybill) => waybill.vehicleId === vehicle.id);
  form.elements.vehicleId.value = vehicle.id;
  form.elements.plateNumber.value = vehicle.plateNumber;
  form.elements.title.value = vehicle.title;
  form.elements.startOdometer.value = vehicle.startOdometer;
  form.elements.startFuel.value = vehicle.startFuel;
  form.dataset.initialMetricsEditable = String(canEditInitialMetrics);
  document.querySelector('#initialMetricsFields').hidden = !canEditInitialMetrics;
  document.querySelector('#initialMetricsLocked').hidden = canEditInitialMetrics;
  dialog.showModal();
}

function openVehicleSaleDialog(vehicle) {
  const dialog = document.querySelector('#vehicleSaleDialog');
  const form = document.querySelector('#vehicleSaleForm');
  form.elements.vehicleId.value = vehicle.id;
  form.elements.vehicleLabel.value = vehicleLabel(vehicle);
  form.elements.soldAt.value = new Date().toISOString().slice(0, 10);
  dialog.showModal();
}

function openVehicleAddDialog() {
  const dialog = document.querySelector('#vehicleAddDialog');
  const form = document.querySelector('#vehicleForm');
  form.reset();
  form.elements.startOdometer.value = '0';
  form.elements.startFuel.value = '0';
  const today = new Date().toISOString().slice(0, 10);
  form.elements.startAt.max = today;
  form.elements.startAt.value = today;
  dialog.showModal();
}

function renderTransferOptions() {
  const currentVehicles = state.data.vehicles.filter((vehicle) =>
    vehicle.currentDriverId === state.actorId && vehicle.status === 'ASSIGNED'
  );
  fillOptions('#transferVehicle', currentVehicles, vehicleLabel);
  fillOptions('#returnVehicle', currentVehicles, vehicleLabel);
  document.querySelector('#returnForm button[type="submit"]').textContent = currentUser().role === 'FLEET_MANAGER'
    ? 'Вернуть в автопарк'
    : 'Отправить на приемку';
  renderReturnWaybillStatus();
  fillOptions('#transferDriver', state.data.users.filter((user) =>
    user.id !== state.actorId && user.role === 'DRIVER'
  ), (user) => user.name);
  renderDriverTransferStatus();
}

function renderDriverTransferStatus() {
  const select = document.querySelector('#transferVehicle');
  const form = document.querySelector('#transferForm');
  const blocker = document.querySelector('#transferVehicleStatus');
  const button = document.querySelector('#transferForm button[type="submit"]');
  const hasVehicle = Boolean(select.value);
  const blockerText = hasVehicle
    ? ''
    : 'За вами сейчас не закреплен автомобиль. Передать автомобиль другому водителю нельзя.';
  const isBlocked = Boolean(blockerText);

  blocker.hidden = !isBlocked;
  blocker.textContent = blockerText;
  setFormControlsDisabled(form, isBlocked);
  button.disabled = isBlocked;
}

function renderReturnWaybillStatus() {
  const select = document.querySelector('#returnVehicle');
  const form = document.querySelector('#returnForm');
  const blocker = document.querySelector('#returnWaybillStatus');
  const button = document.querySelector('#returnForm button[type="submit"]');
  const hasVehicle = Boolean(select.value);
  const missingDates = missingWaybillDatesForReturn(select.value);
  const blockerText = !hasVehicle
    ? 'За вами сейчас не закреплен автомобиль. Сдать автомобиль в автопарк нельзя.'
    : missingDates.length > 0
      ? returnWaybillMissingMessage(missingDates)
      : '';
  const isBlocked = Boolean(blockerText);

  blocker.hidden = !isBlocked;
  blocker.textContent = blockerText;
  setFormControlsDisabled(form, isBlocked);
  button.disabled = isBlocked;
}

function missingWaybillDatesForReturn(vehicleId) {
  if (!vehicleId) return [];
  const assignment = state.data.assignments.find((item) =>
    item.vehicleId === vehicleId && item.driverId === state.actorId && item.endAt === null
  );
  if (!assignment) return [];

  const coveredDates = new Set(state.data.waybills
    .filter((waybill) =>
      waybill.vehicleId === vehicleId
      && waybill.driverId === state.actorId
      && waybill.status !== 'REJECTED'
    )
    .map((waybill) => waybill.waybillDate));

  return datesBetween(datePartFromInstant(assignment.startAt), todayDate())
    .filter((date) => !coveredDates.has(date));
}

function returnWaybillMissingMessage(missingDates) {
  return `Нельзя сдать автомобиль: сначала сдайте путевые листы за даты ${formatDateList(missingDates)}.`;
}

function pendingTransfersForCurrentUser() {
  const role = currentUser().role;
  return state.data.transfers.filter((transfer) =>
    transfer.status === 'PENDING' && (
      (transfer.type === 'DRIVER_TO_DRIVER' && transfer.toDriverId === state.actorId)
      || (transfer.type === 'RETURN_TO_FLEET'
        && ['FLEET_MANAGER', 'ADMIN'].includes(role)
        && !(role === 'FLEET_MANAGER' && transfer.fromDriverId === state.actorId))
    )
  );
}

function renderPendingTransfers() {
  renderTransfers(pendingTransfersForCurrentUser(), '#pendingTransferList');
}

function renderTransfers(pending, containerSelector) {
  const container = document.querySelector(containerSelector);
  if (pending.length === 0) {
    container.innerHTML = '<p>Ожидающих операций нет.</p>';
    return;
  }

  container.innerHTML = pending.map((transfer) => {
    const vehicle = vehicleLabel(vehicleById(transfer.vehicleId));
    const isIncoming = transfer.toDriverId === state.actorId;
    const isFleetManagerSelfReturn = currentUser().role === 'FLEET_MANAGER'
      && transfer.type === 'RETURN_TO_FLEET'
      && transfer.fromDriverId === state.actorId;
    const canConfirm = ['FLEET_MANAGER', 'ADMIN'].includes(currentUser().role)
      && transfer.type === 'RETURN_TO_FLEET'
      && !isFleetManagerSelfReturn;
    return `<article class="row-card">
      <header>
        <strong><button class="transfer-title-link" type="button" data-transfer-details="${transfer.id}">${transfer.type === 'RETURN_TO_FLEET' ? 'Сдача в автопарк' : 'Передача водителю'}</button></strong>
        <span class="badge pending">Ожидает</span>
      </header>
      <div>${vehicle}<br>От: ${userName(transfer.fromDriverId)}${transfer.toDriverId ? `<br>Кому: ${userName(transfer.toDriverId)}` : ''}</div>
      <div class="actions">
        ${isIncoming ? `<button class="primary" data-accept="${transfer.id}">Принять в личное пользование</button><button class="ghost" data-reject="${transfer.id}">Отклонить</button>` : ''}
        ${canConfirm ? `<button class="primary" data-confirm="${transfer.id}">Принять в автопарк</button>` : ''}
      </div>
    </article>`;
  }).join('');

  container.querySelectorAll('[data-transfer-details]').forEach((button) => {
    button.addEventListener('click', () => openTransferDetails(button.dataset.transferDetails));
  });

  container.querySelectorAll('[data-accept]').forEach((button) => {
    button.addEventListener('click', () => {
      const transfer = state.data.transfers.find((item) => item.id === button.dataset.accept);
      return runAction(() => api(`/api/transfers/${button.dataset.accept}/accept`, {
      method: 'POST',
      body: {}
      }), `Автомобиль ${vehicleLabel(vehicleById(transfer.vehicleId))} принят в личное пользование.`);
    });
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
    button.addEventListener('click', () => {
      const transfer = state.data.transfers.find((item) => item.id === button.dataset.confirm);
      return runAction(() => api(`/api/transfers/${button.dataset.confirm}/confirm-return`, {
      method: 'POST',
      body: {}
      }), `Автомобиль ${vehicleLabel(vehicleById(transfer.vehicleId))} принят в автопарк.`);
    });
  });
}

function renderPendingTransfersCount() {
  const count = pendingTransfersForCurrentUser().length;
  const badge = document.querySelector('#pendingTransfersCount');
  badge.hidden = count === 0;
  badge.textContent = String(count);
}

async function openTransferDetails(transferId) {
  const transfer = state.data.transfers.find((item) => item.id === transferId);
  if (!transfer) return;
  const handover = transfer.handover;
  const documentLabels = { STS: 'СТС', SERVICE_BOOK: 'Сервисная книжка', FUEL_CARD: 'Топливная карта', INSURANCE_POLICY: 'Страховой полис' };
  const files = (state.data.transferFiles ?? []).filter((file) => file.transferId === transfer.id);
  const dialog = document.querySelector('#transferDetailsDialog');
  document.querySelector('#transferDetailsTitle').textContent = transfer.type === 'RETURN_TO_FLEET' ? 'Сдача автомобиля в автопарк' : 'Передача автомобиля водителю';
  document.querySelector('#transferDetailsContent').innerHTML = `
    <dl class="transfer-details"><dt>Автомобиль</dt><dd>${escapeHtml(vehicleLabel(vehicleById(transfer.vehicleId)))}</dd><dt>Отправитель</dt><dd>${escapeHtml(userName(transfer.fromDriverId))}</dd>${transfer.toDriverId ? `<dt>Получатель</dt><dd>${escapeHtml(userName(transfer.toDriverId))}</dd>` : ''}<dt>Текущий пробег</dt><dd>${handover ? `${formatNumber(handover.odometer)} км` : 'Не указан для ранее созданной передачи'}</dd><dt>Документы</dt><dd>${handover?.documents?.length ? handover.documents.map((item) => documentLabels[item]).join(', ') : 'Не указаны'}</dd><dt>Комментарий</dt><dd>${escapeHtml(handover?.comment || transfer.reason || '—')}</dd></dl>
    <h3>Фотографии</h3>
    <div class="transfer-photo-grid">${files.length ? files.map((file) => `<figure><img data-transfer-photo="${file.id}" alt="${escapeHtml(file.originalName)}"><figcaption>${escapeHtml(transferPhotoLabel(file.category))}</figcaption></figure>`).join('') : '<p>Фотографии не приложены к ранее созданной передаче.</p>'}</div>`;
  dialog.showModal();
  await Promise.all(files.map(async (file) => {
    const image = dialog.querySelector(`[data-transfer-photo="${file.id}"]`);
    if (!image) return;
    try { image.src = await transferPhotoUrl(file.id); } catch { image.alt = 'Фотографию не удалось загрузить'; }
  }));
}

function transferPhotoLabel(category) {
  return { VEHICLE: 'Автомобиль', DASHBOARD: 'Приборная панель', EXTRA: 'Дополнительное фото' }[category] ?? 'Фото';
}

function renderWaybillOptions() {
  prepareWaybillFormDefaults();
  const vehicle = currentAssignedVehicle();
  const form = document.querySelector('#waybillForm');
  const vehicleLabelInput = document.querySelector('#waybillVehicleLabel');
  const vehicleIdInput = document.querySelector('#waybillVehicleId');
  const blocker = document.querySelector('#waybillVehicleStatus');
  const submitButton = document.querySelector('#waybillForm button[type="submit"]');
  const isBlocked = !vehicle;

  vehicleLabelInput.value = vehicle ? vehicleLabel(vehicle) : '';
  vehicleIdInput.value = vehicle?.id ?? '';
  blocker.hidden = !isBlocked;
  blocker.textContent = vehicle
    ? ''
    : 'За вами сейчас не закреплен автомобиль. Путевой лист создать нельзя.';
  setFormControlsDisabled(form, isBlocked);
  submitButton.disabled = isBlocked;
  if (isBlocked) {
    document.querySelector('#waybillReceiptStatus').hidden = true;
    document.querySelector('#waybillReceiptRequiredMark').hidden = true;
    form.elements.fuelReceiptFiles.required = false;
  } else {
    renderWaybillReceiptRequirement();
  }
}

function prepareWaybillFormDefaults() {
  const form = document.querySelector('#waybillForm');
  const dateInput = form.elements.waybillDate;
  if (form.dataset.actorId !== state.actorId) {
    form.dataset.actorId = state.actorId;
    dateInput.value = todayDate();
    form.elements.endOdometer.value = '';
    form.elements.fuelAdded.value = '';
    form.elements.endFuel.value = '';
    form.elements.fuelReceiptFiles.value = '';
    form.elements.note.value = '';
    return;
  }
  if (!dateInput.value) dateInput.value = todayDate();
}

function renderWaybillReceiptRequirement() {
  const form = document.querySelector('#waybillForm');
  const fuelAdded = Number(form.elements.fuelAdded.value);
  const receiptInput = form.elements.fuelReceiptFiles;
  const hint = document.querySelector('#waybillReceiptStatus');
  const requiredMark = document.querySelector('#waybillReceiptRequiredMark');
  const needsReceipt = Number.isFinite(fuelAdded) && fuelAdded > 0;
  receiptInput.required = needsReceipt;
  requiredMark.hidden = !needsReceipt;
  hint.hidden = !needsReceipt;
  hint.textContent = needsReceipt ? 'При заправке автомобиля приложите чек.' : '';
}

function currentAssignedVehicle() {
  return state.data.vehicles.find((vehicle) =>
    vehicle.currentDriverId === state.actorId && vehicle.status === 'ASSIGNED'
  );
}

function currentVehicleForCurrentUser() {
  return state.data.vehicles.find((vehicle) =>
    vehicle.currentDriverId === state.actorId && !['FREE', 'SOLD'].includes(vehicle.status)
  );
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
  form.querySelector('[name="endOdometer"]').value = waybill.endOdometer ?? '';
  form.querySelector('[name="fuelAdded"]').value = waybill.fuelAdded;
  form.querySelector('[name="endFuel"]').value = waybill.endFuel ?? '';
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
  const registryFilters = document.querySelector('#registryFilters');
  const vehicleSearch = registryFilters.elements.search;
  const updateRegistryFilters = (event) => {
    const vehicleId = event?.target?.name === 'search' ? undefined : state.registryFilters.vehicleId;
    state.registryFilters = {
      ...Object.fromEntries(new FormData(registryFilters)),
      ...(vehicleId ? { vehicleId } : {})
    };
    renderVehicleRegistry();
  };
  registryFilters.addEventListener('input', updateRegistryFilters);
  registryFilters.addEventListener('change', updateRegistryFilters);
  vehicleSearch.addEventListener('input', () => {
    state.registrySuggestionsOpen = true;
    renderRegistryVehicleSuggestions();
  });
  vehicleSearch.addEventListener('focus', () => { state.registrySuggestionsOpen = true; renderRegistryVehicleSuggestions(); });
  vehicleSearch.addEventListener('blur', () => {
    setTimeout(() => {
      state.registrySuggestionsOpen = false;
      renderRegistryVehicleSuggestions();
    }, 120);
  });
  document.querySelector('#resetRegistryFilters').addEventListener('click', () => {
    registryFilters.reset();
    state.registryFilters = {};
    state.registrySuggestionsOpen = false;
    renderVehicleRegistry();
  });
  document.querySelectorAll('[data-registry-sort]').forEach((button) => {
    button.addEventListener('click', () => {
      const key = button.dataset.registrySort;
      state.registrySort = {
        key,
        direction: state.registrySort.key === key && state.registrySort.direction === 'asc' ? 'desc' : 'asc'
      };
      renderVehicleRegistry();
    });
  });

  document.querySelectorAll('#vehicleForm [name="startOdometer"], #vehicleForm [name="startFuel"]').forEach((input) => {
    input.addEventListener('focus', () => {
      if (input.value === '0') input.select();
    });
    input.addEventListener('input', () => {
      input.value = input.value.replace(/^0+(?=\d)/, '');
    });
  });

  document.querySelector('#openVehicleAdd').addEventListener('click', openVehicleAddDialog);
  document.querySelector('#vehicleForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const plateNumber = form.get('plateNumber');
    const title = form.get('title');
    const saved = await runAction(() => api('/api/vehicles', {
      method: 'POST',
      body: {
        plateNumber,
        title,
        startOdometer: Number(form.get('startOdometer')),
        startFuel: Number(form.get('startFuel')),
        startAt: form.get('startAt')
      }
    }), `Автомобиль ${plateNumber} · ${title} добавлен в реестр автомобилей.`);
    if (saved) {
      state.registrySort = { key: 'recordedAt', direction: 'desc' };
      renderVehicleRegistry();
      closeVehicleAddDialog();
    }
  });
  document.querySelector('#cancelVehicleAdd').addEventListener('click', closeVehicleAddDialog);
  document.querySelector('#closeVehicleAdd').addEventListener('click', closeVehicleAddDialog);

  document.querySelector('#vehicleEditForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const vehicle = vehicleById(form.get('vehicleId'));
    const saved = await runAction(async () => {
      let result = await api(`/api/vehicles/${form.get('vehicleId')}`, {
        method: 'PATCH',
        body: { plateNumber: form.get('plateNumber'), title: form.get('title') }
      });
      const initialMetricsChanged = Number(form.get('startOdometer')) !== vehicle.startOdometer
        || Number(form.get('startFuel')) !== vehicle.startFuel;
      if (event.currentTarget.dataset.initialMetricsEditable === 'true' && initialMetricsChanged) {
        result = await api(`/api/vehicles/${form.get('vehicleId')}/initial-metrics`, {
          method: 'PATCH',
          body: {
            startOdometer: Number(form.get('startOdometer')),
            startFuel: Number(form.get('startFuel'))
          }
        });
      }
      return result;
    });
    if (saved) document.querySelector('#vehicleEditDialog').close();
  });
  document.querySelector('#cancelVehicleEdit').addEventListener('click', closeVehicleEditor);
  document.querySelector('#closeVehicleEdit').addEventListener('click', closeVehicleEditor);

  document.querySelector('#vehicleSaleForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const vehicle = vehicleById(form.get('vehicleId'));
    const saved = await runAction(() => api(`/api/vehicles/${form.get('vehicleId')}/sell`, {
      method: 'POST',
      body: { soldAt: form.get('soldAt') }
    }), `Автомобиль ${vehicleLabel(vehicle)} отмечен как проданный.`);
    if (saved) closeVehicleSaleDialog();
  });
  document.querySelector('#cancelVehicleSale').addEventListener('click', closeVehicleSaleDialog);
  document.querySelector('#closeVehicleSale').addEventListener('click', closeVehicleSaleDialog);

  document.querySelector('#waybillEditForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const saved = await runAction(() => api(`/api/waybills/${form.get('waybillId')}`, {
      method: 'PATCH',
      body: {
        endOdometer: Number(form.get('endOdometer')),
        fuelAdded: Number(form.get('fuelAdded')),
        endFuel: Number(form.get('endFuel')),
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
  document.querySelector('#closeTransferDetails').addEventListener('click', () => document.querySelector('#transferDetailsDialog').close());

  document.querySelector('#transferForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const vehicle = vehicleById(form.get('vehicleId'));
    if (!vehicle) {
      showMessage('За вами сейчас не закреплен автомобиль. Передать автомобиль другому водителю нельзя.', true);
      return;
    }
    const recipientName = userName(form.get('toDriverId'));
    await createTransferWithEvidence('/api/transfers/driver-to-driver', {
      fromDriverId: state.actorId, vehicleId: vehicle.id, toDriverId: form.get('toDriverId'), handover: handoverFromForm(form)
    }, event.currentTarget, `Автомобиль ${vehicleLabel(vehicle)} передан сотруднику ${recipientName}.`);
  });

  document.querySelector('#returnForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const vehicle = vehicleById(form.get('vehicleId'));
    if (!vehicle) {
      showMessage('За вами сейчас не закреплен автомобиль. Сдать автомобиль в автопарк нельзя.', true);
      return;
    }
    const missingDates = missingWaybillDatesForReturn(form.get('vehicleId'));
    if (missingDates.length > 0) {
      return showMessage(returnWaybillMissingMessage(missingDates), true);
    }
    const successMessage = currentUser().role === 'FLEET_MANAGER'
      ? `Автомобиль ${vehicleLabel(vehicle)} возвращен в автопарк.`
      : `Автомобиль ${vehicleLabel(vehicle)} отправлен на приемку в автопарк.`;
    await createTransferWithEvidence('/api/transfers/return-to-fleet', {
      driverId: state.actorId, vehicleId: form.get('vehicleId'), note: form.get('comment'), handover: handoverFromForm(form)
    }, event.currentTarget, successMessage);
  });
  document.querySelector('#returnVehicle').addEventListener('change', renderReturnWaybillStatus);
  document.querySelector('#waybillForm [name="waybillDate"]').addEventListener('change', renderWaybillOptions);
  document.querySelector('#waybillForm [name="fuelAdded"]').addEventListener('input', renderWaybillReceiptRequirement);

  document.querySelector('#waybillForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!form.get('vehicleId')) {
      showMessage('За вами сейчас не закреплен автомобиль. Путевой лист создать нельзя.', true);
      return;
    }
    await createWaybillWithReceipts(event.currentTarget, {
      driverId: state.actorId,
      vehicleId: form.get('vehicleId'),
      waybillDate: form.get('waybillDate'),
      endOdometer: Number(form.get('endOdometer')),
      fuelAdded: Number(form.get('fuelAdded')),
      endFuel: Number(form.get('endFuel')),
      note: form.get('note')
    });
  });

  document.querySelector('#reportForm').addEventListener('submit', (event) => {
    event.preventDefault();
    downloadReport(event.submitter?.dataset.format ?? 'xlsx');
  });
}

async function createWaybillWithReceipts(formElement, body) {
  const receiptFiles = [...formElement.elements.fuelReceiptFiles.files];
  if (body.fuelAdded > 0 && receiptFiles.length === 0) {
    showMessage('При заправке автомобиля приложите чек.', true);
    return;
  }
  try {
    const previousWaybillIds = new Set((state.data.waybills ?? []).map((item) => item.id));
    state.data = await api('/api/waybills', {
      method: 'POST',
      body
    });
    const waybill = [...state.data.waybills].reverse().find((item) =>
      !previousWaybillIds.has(item.id)
      && item.driverId === state.actorId
      && item.vehicleId === body.vehicleId
      && item.waybillDate === body.waybillDate
    );
    if (!waybill) throw new Error('Не удалось определить созданный путевой лист.');
    for (const file of receiptFiles) state.data = await uploadWaybillFile(waybill.id, file);
    showMessage(`Путевой лист по автомобилю ${vehicleLabel(vehicleById(body.vehicleId))} создан.`);
    formElement.reset();
    render();
  } catch (error) {
    showMessage(error.message, true);
  }
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

function handoverFromForm(form) {
  return { odometer: Number(form.get('odometer')), documents: form.getAll('documents'), comment: form.get('comment') };
}

async function createTransferWithEvidence(path, body, formElement, successMessage) {
  const vehiclePhotos = [...formElement.elements.vehiclePhotos.files];
  const dashboardPhotos = [...formElement.elements.dashboardPhotos.files];
  const extraPhotos = [...formElement.elements.extraPhotos.files];
  if (vehiclePhotos.length < 4) return showMessage('Добавьте не менее четырех фотографий автомобиля.', true);
  if (dashboardPhotos.length < 1) return showMessage('Добавьте фото приборной панели.', true);
  try {
    const previousTransferIds = new Set((state.data.transfers ?? []).map((item) => item.id));
    state.data = await api(path, { method: 'POST', body });
    const transfer = [...state.data.transfers].reverse().find((item) =>
      !previousTransferIds.has(item.id)
      && item.createdBy === state.actorId
      && item.vehicleId === body.vehicleId
      && ['PENDING', 'CONFIRMED'].includes(item.status)
    );
    if (!transfer) throw new Error('Не удалось определить созданную передачу.');
    for (const [category, files] of [['VEHICLE', vehiclePhotos], ['DASHBOARD', dashboardPhotos], ['EXTRA', extraPhotos]]) {
      for (const file of files) state.data = await uploadTransferFile(transfer.id, file, category);
    }
    showMessage(successMessage);
    formElement.reset();
    render();
  } catch (error) {
    showMessage(error.message, true);
  }
}

async function runAction(action, successMessage = 'Готово') {
  try {
    state.data = await action();
    showMessage(successMessage);
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

function closeVehicleAddDialog() {
  document.querySelector('#vehicleAddDialog').close();
}

function closeVehicleSaleDialog() {
  document.querySelector('#vehicleSaleDialog').close();
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

async function uploadTransferFile(transferId, file, category) {
  const headers = { 'content-type': file.type || 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name), 'x-transfer-file-category': category };
  if (state.session.authMode === 'local') headers['x-autopark-user-id'] = state.actorId;
  if (state.session.csrfToken) headers['x-csrf-token'] = state.session.csrfToken;
  const response = await fetch(`/api/transfers/${transferId}/files`, { method: 'POST', headers, credentials: 'same-origin', body: file });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error ?? 'Не удалось загрузить фотографию передачи.');
  return payload;
}

async function transferPhotoUrl(fileId) {
  const headers = {};
  if (state.session.authMode === 'local') headers['x-autopark-user-id'] = state.actorId;
  const response = await fetch(`/api/transfer-files/${fileId}`, { headers, credentials: 'same-origin' });
  if (!response.ok) throw new Error('Не удалось загрузить фотографию.');
  return URL.createObjectURL(await response.blob());
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

function setFormControlsDisabled(form, disabled) {
  form.classList.toggle('is-disabled', disabled);
  form.querySelectorAll('input, select, textarea, button').forEach((control) => {
    control.disabled = disabled;
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

function vehicleCurrentMetrics(vehicle) {
  const lastWaybill = state.data.waybills
    .filter((waybill) => waybill.vehicleId === vehicle.id && waybill.status !== 'REJECTED')
    .sort(compareWaybillDates)
    .at(-1);
  return {
    odometer: lastWaybill?.endOdometer ?? vehicle.startOdometer,
    fuel: lastWaybill?.endFuel ?? vehicle.startFuel
  };
}

function compareWaybillDates(left, right) {
  const byDate = left.waybillDate.localeCompare(right.waybillDate);
  if (byDate !== 0) return byDate;
  return left.createdAt.localeCompare(right.createdAt);
}

function vehicleOwnerText(vehicle) {
  if (vehicle.currentDriverId) return userName(vehicle.currentDriverId);
  if (vehicle.status === 'FREE') return 'Автопарк';
  if (['RETIRED', 'SOLD'].includes(vehicle.status)) return 'Продан';
  return 'Не закреплен';
}

function canSellVehicle(vehicle) {
  return vehicle.status === 'FREE' && ['FLEET_MANAGER', 'ADMIN'].includes(currentUser().role);
}

function soldAtFor(vehicle) {
  return vehicle.soldAt ?? vehicle.retiredAt ?? null;
}

function formatNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString('ru-RU') : '-';
}

function formatDate(value) {
  return new Date(`${value}T00:00:00`).toLocaleDateString('ru-RU');
}

function formatDateList(dates) {
  return dates.map(formatDate).join(', ');
}

function todayDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function datePartFromInstant(value) {
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return value;
  return new Date(value).toISOString().slice(0, 10);
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
    VEHICLE_INITIAL_METRICS_UPDATED: 'Стартовые показатели автомобиля изменены',
    VEHICLE_ASSIGNED: 'Автомобиль взят водителем',
    TRANSFER_INITIATED: 'Передача инициирована',
    TRANSFER_ACCEPTED: 'Передача принята',
    TRANSFER_REJECTED: 'Передача отклонена',
    RETURN_INITIATED: 'Сдача в автопарк инициирована',
    RETURN_CONFIRMED: 'Сдача в автопарк подтверждена',
    VEHICLE_SOLD: 'Автомобиль продан',
    WAYBILL_CREATED: 'Путевой лист создан',
    WAYBILL_UPDATED: 'Путевой лист исправлен',
    WAYBILL_STATUS_CHANGED: 'Статус путевого листа изменен',
    USER_CREATED_FROM_BITRIX: 'Пользователь добавлен из Bitrix24',
    USER_PROFILE_UPDATED: 'Профиль пользователя обновлен',
    USER_ROLE_CHANGED: 'Роль пользователя изменена'
  }[action] ?? action;
}

function statusBadge(status) {
  const label = vehicleStatusLabel(status);
  const kind = status === 'FREE' ? 'free' : status.includes('PENDING') ? 'pending' : '';
  return `<span class="badge ${kind}">${label}</span>`;
}

function vehicleStatusLabel(status) {
  return {
    FREE: 'Свободен',
    ASSIGNED: 'Закреплен',
    TRANSFER_PENDING: 'Передача',
    RETURN_PENDING: 'Приемка',
    RETIRED: 'Продан',
    SOLD: 'Продан',
    DRAFT: 'Черновик',
    ACCOUNTING_REVIEW: 'Проверка',
    DRIVER_CORRECTION: 'Корректировка',
    PROCESSED: 'Обработано',
    REJECTED: 'Отклонено'
  }[status] ?? status;
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

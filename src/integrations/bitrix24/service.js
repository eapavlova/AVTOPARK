import { Bitrix24Client, Bitrix24Error, normalizedDomain } from './client.js';
import { createBitrixInstallationStore } from './installation-store.js';

export function createBitrix24Service(environment = process.env, options = {}) {
  const installations = options.installations ?? createBitrixInstallationStore(environment);
  const allowedDomains = String(environment.BITRIX_ALLOWED_DOMAINS ?? '')
    .split(',')
    .map((domain) => domain.trim().toLowerCase())
    .filter(Boolean);
  if (!installations || !environment.BITRIX_CLIENT_ID || !environment.BITRIX_CLIENT_SECRET || allowedDomains.length === 0) return null;
  const client = new Bitrix24Client({
    clientId: environment.BITRIX_CLIENT_ID,
    clientSecret: environment.BITRIX_CLIENT_SECRET,
    installations,
    allowedDomains,
    fetchImpl: options.fetchImpl
  });
  return new Bitrix24Service({
    client,
    installations,
    appBaseUrl: environment.APP_BASE_URL,
    bindLeftMenu: environment.BITRIX_BIND_LEFT_MENU !== 'false',
    allowedDomains
  });
}

export class Bitrix24Service {
  constructor({ client, installations, appBaseUrl, bindLeftMenu = true, allowedDomains = [] }) {
    this.client = client;
    this.installations = installations;
    this.appBaseUrl = appBaseUrl;
    this.bindLeftMenu = bindLeftMenu;
    this.allowedDomains = allowedDomains;
  }

  async install(auth) {
    const installation = normalizeInstallation(auth, this.allowedDomains);
    const profile = await this.client.callWithAccessToken(
      installation.domain,
      installation.accessToken,
      'profile'
    );
    const authenticatedUserId = requirePositiveInteger(profile?.ID, 'ID пользователя');
    if (installation.installedByBitrixUserId !== null
      && installation.installedByBitrixUserId !== authenticatedUserId) {
      throw new Bitrix24Error('INSTALLER_MISMATCH', 'Пользователь установочного токена не совпадает с user_id.');
    }
    const isPortalAdmin = Boolean(await this.client.callWithAccessToken(
      installation.domain,
      installation.accessToken,
      'user.admin'
    ));
    if (!isPortalAdmin) {
      throw new Bitrix24Error('INSTALLER_NOT_ADMIN', 'Установить приложение может только администратор Bitrix24.');
    }
    installation.installedByBitrixUserId = authenticatedUserId;
    await this.installations.save(installation);
    if (this.bindLeftMenu) {
      if (!this.appBaseUrl) throw new Error('Для привязки меню задайте APP_BASE_URL.');
      await this.client.call(installation.memberId, 'placement.bind', {
        PLACEMENT: 'LEFT_MENU',
        HANDLER: `${this.appBaseUrl.replace(/\/$/, '')}/bitrix/app`,
        TITLE: 'Автопарк'
      });
    }
    return { memberId: installation.memberId, domain: installation.domain };
  }

  async notify(memberId, bitrixUserId, message, tag) {
    return this.client.call(memberId, 'im.notify.personal.add', {
      USER_ID: bitrixUserId,
      MESSAGE: message,
      TAG: tag
    });
  }

  async upsertVehicle(memberId, { entityTypeId, itemId, fields }) {
    if (itemId) {
      await this.client.call(memberId, 'crm.item.update', { entityTypeId, id: itemId, fields });
      return itemId;
    }
    const result = await this.client.call(memberId, 'crm.item.add', { entityTypeId, fields });
    const createdId = Number(result?.item?.id ?? result?.id);
    if (!Number.isInteger(createdId) || createdId <= 0) {
      throw new Error('Bitrix24 не вернул идентификатор созданной карточки автомобиля.');
    }
    return createdId;
  }

  async authenticateFrame(body) {
    const auth = parseInstallationForm(body);
    const memberId = requireIdentifier(auth.memberId, 'member_id');
    const domain = normalizedDomain(auth.domain, this.allowedDomains);
    const installation = await this.installations.get(memberId);
    if (!installation) {
      throw new Bitrix24Error('INSTALLATION_NOT_FOUND', 'Портал Bitrix24 не установлен.');
    }
    if (installation.domain !== domain) {
      throw new Bitrix24Error('INSTALLATION_DOMAIN_MISMATCH', 'Домен не соответствует сохраненной установке Bitrix24.');
    }
    const accessToken = required(auth.accessToken, 'AUTH_ID');
    const profile = await this.client.callWithAccessToken(domain, accessToken, 'profile');
    const isPortalAdmin = Boolean(await this.client.callWithAccessToken(domain, accessToken, 'user.admin'));
    const bitrixUserId = requirePositiveInteger(profile?.ID, 'ID пользователя');
    const name = [profile?.NAME, profile?.LAST_NAME].filter(Boolean).join(' ').trim();
    if (!name) throw new Error('Bitrix24 не вернул имя текущего пользователя.');
    return { memberId, domain, bitrixUserId, name, isPortalAdmin };
  }

  async close() {
    await this.installations.close?.();
  }
}

export function parseInstallationForm(body) {
  const form = new URLSearchParams(body);
  return {
    accessToken: form.get('auth[access_token]') ?? form.get('AUTH_ID'),
    refreshToken: form.get('auth[refresh_token]') ?? form.get('REFRESH_ID'),
    expiresIn: form.get('auth[expires_in]') ?? form.get('AUTH_EXPIRES'),
    memberId: form.get('auth[member_id]') ?? form.get('member_id'),
    domain: form.get('auth[domain]') ?? form.get('DOMAIN'),
    userId: form.get('auth[user_id]') ?? form.get('USER_ID')
  };
}

function normalizeInstallation(auth, allowedDomains) {
  const accessToken = required(auth.accessToken, 'access_token');
  const refreshToken = required(auth.refreshToken, 'refresh_token');
  const memberId = required(auth.memberId, 'member_id');
  const expiresIn = Number(auth.expiresIn ?? 3600);
  if (!Number.isFinite(expiresIn) || expiresIn <= 0) throw new Error('Некорректное время жизни токена Bitrix24.');
  return {
    memberId,
    domain: normalizedDomain(auth.domain, allowedDomains),
    accessToken,
    refreshToken,
    expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString(),
    installedByBitrixUserId: auth.userId ? requirePositiveInteger(auth.userId, 'user_id') : null
  };
}

function required(value, name) {
  if (!value) throw new Error(`Bitrix24 не передал ${name}.`);
  return value;
}

function requireIdentifier(value, name) {
  const identifier = required(value, name);
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(identifier)) {
    throw new Error(`Bitrix24 передал некорректный ${name}.`);
  }
  return identifier;
}

function requirePositiveInteger(value, name) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) throw new Error(`Bitrix24 передал некорректный ${name}.`);
  return number;
}

export class Bitrix24Client {
  constructor({ clientId, clientSecret, installations, allowedDomains, fetchImpl = fetch }) {
    this.clientId = required(clientId, 'BITRIX_CLIENT_ID');
    this.clientSecret = required(clientSecret, 'BITRIX_CLIENT_SECRET');
    this.installations = installations;
    this.allowedDomains = allowedDomains;
    this.fetch = fetchImpl;
  }

  async call(memberId, method, params = {}) {
    let installation = await this.installations.get(memberId);
    if (!installation) throw new Bitrix24Error('INSTALLATION_NOT_FOUND', 'Портал Bitrix24 не установлен.');

    let response = await this.request(installation, method, params);
    if (response.error === 'expired_token') {
      installation = await this.refresh(installation);
      response = await this.request(installation, method, params);
    }
    if (response.error) {
      throw new Bitrix24Error(response.error, response.error_description ?? 'Ошибка Bitrix24 REST API.');
    }
    return response.result;
  }

  async callWithAccessToken(domain, accessToken, method, params = {}) {
    const installation = {
      domain: normalizedDomain(domain, this.allowedDomains),
      accessToken: required(accessToken, 'AUTH_ID')
    };
    const response = await this.request(installation, method, params);
    if (response.error) {
      throw new Bitrix24Error(response.error, response.error_description ?? 'Ошибка Bitrix24 REST API.');
    }
    return response.result;
  }

  async request(installation, method, params) {
    const response = await this.fetch(`https://${installation.domain}/rest/${method}.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify({ ...params, auth: installation.accessToken })
    });
    const payload = await response.json();
    if (!response.ok && !payload.error) {
      throw new Bitrix24Error('HTTP_ERROR', `Bitrix24 вернул HTTP ${response.status}.`);
    }
    return payload;
  }

  async refresh(installation) {
    const url = new URL('https://oauth.bitrix.info/oauth/token/');
    url.search = new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: this.clientId,
      client_secret: this.clientSecret,
      refresh_token: installation.refreshToken
    });
    const response = await this.fetch(url, { headers: { accept: 'application/json' } });
    const payload = await response.json();
    if (!response.ok || payload.error) {
      throw new Bitrix24Error(payload.error ?? 'TOKEN_REFRESH_FAILED', payload.error_description ?? 'Не удалось обновить токен Bitrix24.');
    }
    const refreshed = {
      ...installation,
      domain: normalizedDomain(payload.domain ?? installation.domain, this.allowedDomains),
      accessToken: payload.access_token,
      refreshToken: payload.refresh_token,
      expiresAt: new Date(Date.now() + Number(payload.expires_in ?? 3600) * 1000).toISOString()
    };
    await this.installations.save(refreshed);
    return refreshed;
  }
}

export class Bitrix24Error extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'Bitrix24Error';
    this.code = code;
  }
}

export function normalizedDomain(value, allowedDomains = []) {
  const domain = String(value ?? '').trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9.-]{0,251}[a-z0-9])?$/.test(domain) || domain.includes('..')) {
    throw new Bitrix24Error('INVALID_DOMAIN', 'Некорректный домен Bitrix24.');
  }
  if (allowedDomains.length > 0 && !allowedDomains.includes(domain)) {
    throw new Bitrix24Error('DOMAIN_NOT_ALLOWED', 'Домен Bitrix24 отсутствует в списке разрешенных.');
  }
  return domain;
}

function required(value, name) {
  if (!value) throw new Error(`Не задана переменная ${name}.`);
  return value;
}

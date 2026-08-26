import test from 'node:test';
import assert from 'node:assert/strict';
import { Bitrix24Client } from '../src/integrations/bitrix24/client.js';
import { Bitrix24Service, parseInstallationForm } from '../src/integrations/bitrix24/service.js';
import { TokenCipher } from '../src/integrations/bitrix24/token-cipher.js';

test('installation callback parser reads nested Bitrix24 form fields', () => {
  const parsed = parseInstallationForm(new URLSearchParams({
    'auth[access_token]': 'access-1',
    'auth[refresh_token]': 'refresh-1',
    'auth[expires_in]': '3600',
    'auth[member_id]': 'member-1',
    'auth[domain]': 'company.bitrix24.ru',
    'auth[user_id]': '42'
  }).toString());

  assert.deepEqual(parsed, {
    accessToken: 'access-1',
    refreshToken: 'refresh-1',
    expiresIn: '3600',
    memberId: 'member-1',
    domain: 'company.bitrix24.ru',
    userId: '42'
  });
});

test('Bitrix24 token bundle is encrypted and can be decrypted', () => {
  const cipher = new TokenCipher('a-secure-test-key-that-is-longer-than-32-characters');
  const source = { accessToken: 'access-secret', refreshToken: 'refresh-secret' };
  const encrypted = cipher.encrypt(source);

  assert.doesNotMatch(encrypted, /access-secret|refresh-secret/);
  assert.deepEqual(cipher.decrypt(encrypted), source);
});

test('Bitrix24 client refreshes an expired token once and saves the new pair', async () => {
  const saved = [];
  const installation = {
    memberId: 'member-1',
    domain: 'company.bitrix24.ru',
    accessToken: 'expired-access',
    refreshToken: 'old-refresh'
  };
  const installations = {
    async get() { return saved.at(-1) ?? installation; },
    async save(value) { saved.push(value); }
  };
  const calls = [];
  const fetchImpl = async (url, options) => {
    calls.push({ url: String(url), options });
    if (String(url).startsWith('https://oauth.bitrix.info/')) {
      return jsonResponse({
        access_token: 'new-access',
        refresh_token: 'new-refresh',
        expires_in: 3600,
        domain: 'company.bitrix24.ru'
      });
    }
    if (calls.filter((call) => call.url.includes('/rest/')).length === 1) {
      return jsonResponse({ error: 'expired_token', error_description: 'expired' }, 401);
    }
    return jsonResponse({ result: 777 });
  };
  const client = new Bitrix24Client({
    clientId: 'client-id',
    clientSecret: 'client-secret',
    installations,
    allowedDomains: ['company.bitrix24.ru'],
    fetchImpl
  });

  const result = await client.call('member-1', 'im.notify.personal.add', { USER_ID: 42, MESSAGE: 'Тест' });

  assert.equal(result, 777);
  assert.equal(saved.length, 1);
  assert.equal(saved[0].refreshToken, 'new-refresh');
  assert.equal(JSON.parse(calls[2].options.body).auth, 'new-access');
});

test('frame authentication resolves current employee and portal administrator status', async () => {
  const calls = [];
  const client = {
    async callWithAccessToken(domain, token, method) {
      calls.push({ domain, token, method });
      if (method === 'profile') return { ID: '42', NAME: 'Анна', LAST_NAME: 'Орлова' };
      if (method === 'user.admin') return true;
      throw new Error('Unexpected method');
    }
  };
  const service = new Bitrix24Service({
    client,
    installations: {
      async get() { return { memberId: 'member-1', domain: 'company.bitrix24.ru' }; }
    },
    allowedDomains: ['company.bitrix24.ru']
  });

  const identity = await service.authenticateFrame(new URLSearchParams({
    AUTH_ID: 'frame-access-token',
    member_id: 'member-1',
    DOMAIN: 'company.bitrix24.ru'
  }).toString());

  assert.deepEqual(identity, {
    memberId: 'member-1',
    domain: 'company.bitrix24.ru',
    bitrixUserId: 42,
    name: 'Анна Орлова',
    isPortalAdmin: true
  });
  assert.deepEqual(calls.map((call) => call.method), ['profile', 'user.admin']);
});

test('installation binds LEFT_MENU to the authenticated Bitrix24 entry point', async () => {
  const saved = [];
  const calls = [];
  const service = new Bitrix24Service({
    installations: { async save(value) { saved.push(value); } },
    client: {
      async callWithAccessToken(domain, token, method) {
        calls.push([domain, token, method]);
        return method === 'profile' ? { ID: 1 } : true;
      },
      async call(...args) { calls.push(args); return true; }
    },
    appBaseUrl: 'https://autopark.example/',
    bindLeftMenu: true,
    allowedDomains: ['company.bitrix24.ru']
  });

  await service.install({
    accessToken: 'access',
    refreshToken: 'refresh',
    expiresIn: 3600,
    memberId: 'member-1',
    domain: 'company.bitrix24.ru',
    userId: 1
  });

  assert.equal(saved.length, 1);
  assert.equal(saved[0].installedByBitrixUserId, 1);
  assert.equal(calls[2][1], 'placement.bind');
  assert.deepEqual(calls[2][2], {
    PLACEMENT: 'LEFT_MENU',
    HANDLER: 'https://autopark.example/bitrix/app',
    TITLE: 'Автопарк'
  });
});

test('installation validates the token and portal administrator before saving secrets', async () => {
  const saved = [];
  const service = new Bitrix24Service({
    installations: { async save(value) { saved.push(value); } },
    client: {
      async callWithAccessToken(domain, token, method) {
        return method === 'profile' ? { ID: 42 } : false;
      }
    },
    bindLeftMenu: false,
    allowedDomains: ['company.bitrix24.ru']
  });

  await assert.rejects(service.install({
    accessToken: 'access', refreshToken: 'refresh', memberId: 'member-1',
    domain: 'company.bitrix24.ru', userId: 42
  }), /только администратор/i);
  assert.equal(saved.length, 0);

  await assert.rejects(service.install({
    accessToken: 'access', refreshToken: 'refresh', memberId: 'member-1',
    domain: 'company.bitrix24.ru', userId: 7
  }), /не совпадает/i);
  assert.equal(saved.length, 0);
});

test('frame authentication requires the member and domain of a saved installation', async () => {
  let tokenCalls = 0;
  const service = new Bitrix24Service({
    installations: {
      async get(memberId) {
        return memberId === 'member-1'
          ? { memberId, domain: 'company.bitrix24.ru' }
          : null;
      }
    },
    client: {
      async callWithAccessToken() {
        tokenCalls += 1;
        return {};
      }
    },
    allowedDomains: ['company.bitrix24.ru', 'other.bitrix24.ru']
  });

  await assert.rejects(service.authenticateFrame(new URLSearchParams({
    AUTH_ID: 'token', member_id: 'missing', DOMAIN: 'company.bitrix24.ru'
  }).toString()), /не установлен/i);
  await assert.rejects(service.authenticateFrame(new URLSearchParams({
    AUTH_ID: 'token', member_id: 'member-1', DOMAIN: 'other.bitrix24.ru'
  }).toString()), /не соответствует/i);
  assert.equal(tokenCalls, 0);
});

test('vehicle mirror creates and updates a universal CRM item', async () => {
  const calls = [];
  const service = new Bitrix24Service({
    client: {
      async call(memberId, method, params) {
        calls.push({ memberId, method, params });
        return method === 'crm.item.add' ? { item: { id: 777 } } : {};
      }
    },
    installations: {},
    appBaseUrl: 'https://app.example.test'
  });

  const createdId = await service.upsertVehicle('member-1', {
    entityTypeId: 1302, itemId: null, fields: { title: 'А123АА 77 · Лада Гранта' }
  });
  const updatedId = await service.upsertVehicle('member-1', {
    entityTypeId: 1302, itemId: createdId, fields: { title: 'А123АА 77 · Лада Гранта Cross' }
  });

  assert.equal(createdId, 777);
  assert.equal(updatedId, 777);
  assert.equal(calls[0].method, 'crm.item.add');
  assert.equal(calls[0].params.entityTypeId, 1302);
  assert.equal(calls[1].method, 'crm.item.update');
  assert.equal(calls[1].params.id, 777);
});

function jsonResponse(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

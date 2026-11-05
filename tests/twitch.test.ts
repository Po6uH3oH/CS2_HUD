import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, defaultSettings } from '../packages/core/index.js';
import { defaultTitleTemplate, renderStreamTitle } from '../packages/core/stream-title.js';
import { TwitchTitleService, type TwitchStored } from '../apps/backend/src/twitch.js';

function fixture() {
  const settings = structuredClone(defaultSettings);
  settings.teams[0].name = 'Spirit'; settings.teams[1].name = 'Falcons';
  settings.match.seriesScore = [1, 0]; settings.match.bestOf = 3;
  const state = createInitialState(settings, 'live', 1000);
  state.connected = true; state.teams[0].score = 5; state.teams[1].score = 2;
  return { state, settings };
}
const json = (body: unknown, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });
const validation = { client_id: 'client', user_id: '123', login: 'channel', scopes: ['channel:manage:broadcast'], expires_in: 14400 };

function harness(extra?: (url: string, init?: RequestInit) => Response | undefined, stored?: Partial<TwitchStored>) {
  let now = 100000;
  const snapshot = fixture();
  const calls: { url: string; init?: RequestInit }[] = [];
  const saves: TwitchStored[] = [];
  const service = new TwitchTitleService({ now: () => now, snapshot: () => snapshot,
    stored: { clientId: 'client', template: defaultTitleTemplate, enabled: true, accessToken: 'access-private', refreshToken: 'refresh-private', ...stored },
    save: data => saves.push(structuredClone(data)),
    fetch: (async (input, init) => {
      const url = String(input); calls.push({ url, init });
      const response = extra?.(url, init); if (response) return response;
      if (url.endsWith('/validate')) return json(validation);
      if (url.includes('/helix/channels?')) return new Response(null, { status: 204 });
      if (url.endsWith('/token')) return json({ access_token: 'access-new', refresh_token: 'refresh-new' });
      throw new Error('Unexpected URL');
    }) as typeof fetch,
  });
  return { service, snapshot, calls, saves, advance: (ms: number) => { now += ms; }, patches: () => calls.filter(c => c.init?.method === 'PATCH') };
}

test('title variables use team identity, not CT/T or current team-array order', () => {
  const { state, settings } = fixture();
  state.teams.reverse(); state.teams[0].side = 'T'; state.teams[1].side = 'CT';
  assert.equal(renderStreamTitle('{team1} {score1}:{score2} {team2} [{maps1}:{maps2}] {bo}', state, settings).title, 'Spirit 5:2 Falcons [1:0] BO3');
  assert.equal(renderStreamTitle('{team1} {score1}', state, settings).ready, true);
});
test('unknown variables, malformed braces and oversized titles are rejected; missing scores remain unknown', () => {
  const { state, settings } = fixture();
  for (const input of ['{typo}', '{constructor}', '{team1', 'abc}', ' ', 'a'.repeat(141)]) assert.ok(renderStreamTitle(input, state, settings).error);
  assert.equal(renderStreamTitle('😀'.repeat(140), state, settings).error, null);
  state.teams[0].score = null;
  const result = renderStreamTitle('{score1}', state, settings);
  assert.equal(result.title, '—'); assert.equal(result.ready, false);
});
test('automatic updates debounce, deduplicate and throttle while using only channel title PATCH', async () => {
  const h = harness();
  await h.service.tick(); assert.equal(h.patches().length, 0);
  h.advance(3000); await h.service.tick(); assert.equal(h.patches().length, 1);
  const sent = h.patches()[0]; assert.ok(sent.url.endsWith('broadcaster_id=123'));
  assert.deepEqual(Object.keys(JSON.parse(String(sent.init?.body))), ['title']);
  h.advance(20000); await h.service.tick(); assert.equal(h.patches().length, 1);
  h.snapshot.state.teams[0].score = 6; await h.service.tick();
  h.advance(1000); h.snapshot.state.teams[0].score = 7; await h.service.tick();
  h.advance(3000); await h.service.tick(); assert.equal(h.patches().length, 2);
  assert.match(String(h.patches()[1].init?.body), /7:2/);
  h.snapshot.state.teams[0].score = 8; await h.service.tick(); h.advance(3000); await h.service.tick();
  assert.equal(h.patches().length, 2);
  h.advance(12000); await h.service.tick(); assert.equal(h.patches().length, 3);
});
test('demo, stale data and disabled automation do not publish; manual demo publication is rejected', async () => {
  const h = harness();
  h.snapshot.state.mode = 'demo'; await h.service.tick(); h.advance(30000); await h.service.tick();
  await assert.rejects(() => h.service.apply(), /Демо/);
  h.snapshot.state.mode = 'live'; h.snapshot.state.connected = false; await h.service.tick();
  h.advance(30000); await h.service.tick(); assert.equal(h.patches().length, 0);
  h.snapshot.state.connected = true;
  h.service.configure({ clientId: 'client', template: '{team1}', enabled: false });
  await h.service.tick(); h.advance(30000); await h.service.tick(); assert.equal(h.patches().length, 0);
  await h.service.apply(); assert.equal(h.patches().length, 1);
});
test('401 refreshes credentials once, saves rotated refresh token, never exposes secrets in status', async () => {
  let attempts = 0;
  const h = harness(url => url.includes('/helix/') && attempts++ === 0 ? json({}, 401) : undefined);
  await h.service.apply(); assert.equal(h.patches().length, 2);
  assert.ok(h.saves.some(s => s.refreshToken === 'refresh-new'));
  assert.match(String((h.patches()[1].init?.headers as Record<string,string>).Authorization), /access-new/);
  assert.doesNotMatch(JSON.stringify(h.service.status()), /access-private|refresh-private|access-new|refresh-new/);
});
test('429 waits for Twitch reset, then retries the newest score', async () => {
  let limited = true;
  const h = harness(url => url.includes('/helix/') && limited ? json({}, 429, { 'Ratelimit-Reset': '200' }) : undefined);
  await h.service.tick(); h.advance(3000); await h.service.tick(); assert.equal(h.patches().length, 1);
  h.snapshot.state.teams[0].score = 9; h.advance(60000); await h.service.tick(); assert.equal(h.patches().length, 1);
  limited = false; h.advance(40000); await h.service.tick(); h.advance(3000); await h.service.tick();
  assert.equal(h.patches().length, 2); assert.match(String(h.patches()[1].init?.body), /9:2/);
});
test('device login obeys polling interval, validates identity and leaves auto update off', async () => {
  let tokenCalls = 0;
  const h = harness((url, init) => {
    if (url.endsWith('/device')) {
      assert.equal(new URLSearchParams(String(init?.body)).get('scopes'), 'channel:manage:broadcast');
      return json({ device_code: 'device-private', user_code: 'CODE', verification_uri: 'https://www.twitch.tv/activate?device-code=CODE', expires_in: 1800, interval: 5 });
    }
    if (url.endsWith('/token') && tokenCalls++ === 0) return json({ message: 'authorization_pending' }, 400);
    return undefined;
  }, { accessToken: undefined, refreshToken: undefined });
  await h.service.connect(); assert.doesNotMatch(JSON.stringify(h.service.status()), /device-private/);
  await h.service.tick(); assert.equal(tokenCalls, 0);
  h.advance(5000); await h.service.tick(); assert.equal(tokenCalls, 1);
  h.advance(5000); await h.service.tick();
  assert.equal(h.service.status().connected, true); assert.equal(h.service.status().enabled, false);
  assert.equal(h.patches().length, 0);
});
test('invalid scope disconnects, while restart can refresh an expired token', async () => {
  const invalid = harness(url => url.endsWith('/validate') ? json({ ...validation, scopes: [] }) : undefined);
  await invalid.service.tick(); assert.equal(invalid.service.status().connected, false); assert.equal(invalid.service.status().enabled, false);
  assert.equal(invalid.saves.at(-1)?.accessToken, undefined);
  let validates = 0;
  const expired = harness(url => url.endsWith('/validate') && validates++ === 0 ? json({}, 401) : undefined);
  await expired.service.tick(); assert.equal(expired.service.status().connected, true);
  assert.equal(expired.saves.at(-1)?.refreshToken, 'refresh-new');
  expired.service.disconnect(); expired.advance(60000); await expired.service.tick(); assert.equal(expired.patches().length, 0);
});
test('hourly validation continues with automatic updates disabled', async () => {
  const h = harness(undefined, { enabled: false });
  await h.service.tick(); h.advance(3600001); await h.service.tick();
  assert.equal(h.calls.filter(c => c.url.endsWith('/validate')).length, 2);
  assert.equal(h.patches().length, 0);
  h.service.close(); h.advance(3600001); await h.service.tick(); assert.equal(h.calls.length, 2);
});

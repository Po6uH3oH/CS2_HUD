import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { once } from 'node:events';
import { createHash } from 'node:crypto';
import { WebSocket, WebSocketServer } from 'ws';
import { createApp } from '../apps/backend/index.js';
import { defaultSettings } from '../packages/core/index.js';
import { FaceitClient, FaceitError } from '../apps/backend/src/faceit.js';
import { ObsClient } from '../apps/backend/src/obs.js';

async function harness() {
  const directory = mkdtempSync(join(tmpdir(), 'cs2-hud-test-'));
  const app = createApp({ dataDir: directory, gsiToken: 'gsi-test-token', tickMs: 30 });
  app.server.listen(0, '127.0.0.1');
  await once(app.server, 'listening');
  const address = app.server.address();
  assert.ok(address && typeof address !== 'string');
  const url = `http://127.0.0.1:${address.port}`;
  const request = (path: string, body?: unknown, _legacyHeader = true, method = body === undefined ? 'GET' : 'POST') => fetch(`${url}${path}`, {
    method, headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),  },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  return { ...app, url, request, directory, dispose: async () => { await app.close(); rmSync(directory, { recursive: true, force: true }); } };
}

const packet = (timestamp = 100) => ({
  auth: { token: 'gsi-test-token' }, provider: { name: 'Counter-Strike 2', appid: 730, timestamp, steamid: '76561198000000000' },
  map: { name: 'de_nuke', phase: 'live', round: 7, team_ct: { score: 3 }, team_t: { score: 4 } },
  round: { phase: 'live' }, phase_countdowns: { phase: 'live', phase_ends_in: '78.0' },
  allplayers: { '76561198000000001': { name: 'Observer fixture', team: 'CT', observer_slot: 1, state: { health: 83, armor: 100, helmet: true, money: 4200, equip_value: 5000 }, weapons: { weapon_0: { name: 'weapon_m4a1', type: 'Rifle', state: 'active', ammo_clip: 20, ammo_reserve: 60 } }, match_stats: { kills: 9, deaths: 3, assists: 2 }, position: '100, 200, -300', forward: '1, 0, 0' } },
});

test('GSI selects an unlisted map, awards its winner once and persists the result across restart', async () => {
  const h = await harness();
  try {
    const first = packet(); first.map.name = 'de_cache';
    await h.request('/api/gsi', first);
    assert.equal(h.snapshot().settings.match.map, 'de_cache');
    assert.deepEqual(h.snapshot().settings.match.seriesScore, [0, 0]);
    const finish = packet(101);
    finish.map = { ...finish.map, name: 'de_cache', phase: 'gameover', team_t: { score: 13 }, team_ct: { score: 8 } };
    await h.request('/api/gsi', finish);
    assert.deepEqual(h.snapshot().settings.match.seriesScore, [1, 0]);
    assert.deepEqual(h.snapshot().settings.match.mapDetails.de_cache.scores, { navi: 13, fnatic: 8 });
    finish.provider.timestamp++;
    await h.request('/api/gsi', finish);
    assert.deepEqual(h.snapshot().settings.match.seriesScore, [1, 0]);
    await h.close();
    const reopened = createApp({ dataDir: h.directory, gsiToken: 'gsi-test-token' });
    try {
      reopened.server.listen(0, '127.0.0.1'); await once(reopened.server, 'listening');
      const address = reopened.server.address(); assert.ok(address && typeof address !== 'string');
      finish.provider.timestamp++;
      const response = await fetch(`http://127.0.0.1:${address.port}/api/gsi`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(finish),
      });
      assert.equal(response.status, 200);
      assert.deepEqual(reopened.snapshot().settings.match.seriesScore, [1, 0]);
      assert.deepEqual(reopened.snapshot().settings.match.mapDetails.de_cache.scores, { navi: 13, fnatic: 8 });
    } finally { await reopened.close(); }
  } finally { await h.dispose(); }
});

test('Twitch panel validates templates, persists local settings and cannot publish without live data', async () => {
  const h = await harness();
  try {
    const initial = await (await h.request('/api/twitch')).json();
    assert.equal(initial.enabled, false); assert.equal(initial.connected, false);
    assert.equal((await h.request('/api/twitch/settings', { clientId: '', template: '{typo}', enabled: false })).status, 400);
    const saved = await h.request('/api/twitch/settings', { clientId: 'publicclient', template: '{team1} {score1}:{score2} {team2}', enabled: false });
    assert.equal(saved.status, 200);
    const value = await saved.json(); assert.equal(value.clientId, 'publicclient');
    assert.equal(value.preview.ready, false);
    assert.equal((await h.request('/api/twitch/apply', {})).status, 400);
    const forbidden = await fetch(`${h.url}/api/twitch/settings`, { method: 'POST', headers: { Origin: 'https://example.com', 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: '', template: 'bad', enabled: true }) });
    assert.equal(forbidden.status, 403);
    assert.doesNotMatch(JSON.stringify(await (await h.request('/api/state')).json()), /publicclient|accessToken|refreshToken/);
    await h.close();
    const reopened = createApp({ dataDir: h.directory });
    try {
      reopened.server.listen(0, '127.0.0.1'); await once(reopened.server, 'listening');
      const address = reopened.server.address(); assert.ok(address && typeof address !== 'string');
      const persisted = await (await fetch(`http://127.0.0.1:${address.port}/api/twitch`)).json();
      assert.equal(persisted.clientId, 'publicclient'); assert.equal(persisted.template, value.template);
    } finally { await reopened.close(); }
  } finally { await h.dispose(); }
});

test('GSI recording captures timed packets, redacts nested secrets, stops and downloads', async () => {
  const h = await harness();
  try {
    await h.request('/api/gsi-recording/start', {});
    await h.request('/api/gsi', { ...packet(), previously: { auth: { token: 'nested-secret' } } });
    const status = await (await h.request('/api/gsi-recording')).json();
    assert.equal(status.active, true); assert.equal(status.packets, 1);
    const response = await h.request('/api/gsi-recording/download');
    assert.match(response.headers.get('content-disposition')!, /\.jsonl/);
    const text = await response.text();
    assert.doesNotMatch(text, /gsi-test-token|nested-secret|"auth"/);
    const line = JSON.parse(text.trim());
    assert.ok(line.receivedAt > 0); assert.equal(line.payload.map.name, 'de_nuke');
    await h.request('/api/gsi', packet(101));
    assert.equal((await (await h.request('/api/gsi-recording')).json()).packets, 1);
    await h.request('/api/gsi-recording/start', {});
    assert.equal((await (await h.request('/api/gsi-recording')).json()).packets, 0);
  } finally { await h.dispose(); }
});

test('local panel works without login; external origins and GSI secrets remain protected', async () => {
  const h = await harness();
  try {
    assert.equal((await h.request('/api/settings', undefined, false)).status, 200);
    assert.equal((await h.request('/api/command', { type: 'mode', mode: 'demo' }, false)).status, 200);
    assert.equal((await h.request('/api/diagnostics', undefined, false)).status, 200);
    assert.equal((await h.request('/api/gsi-config', undefined, false)).status, 200);
    const publicText = await (await h.request('/api/state', undefined, false)).text();
    assert.ok(!publicText.includes('gsi-test-token')); assert.ok(!publicText.includes('diagnostics'));
    assert.equal(JSON.parse(publicText).state.mode, 'demo');
    const socket = new WebSocket(h.url.replace('http:', 'ws:') + '/ws');
    const [message] = await once(socket, 'message');
    assert.ok(!message.toString().includes('gsi-test-token')); socket.terminate();
    const foreign = await fetch(`${h.url}/api/command`, { method: 'POST', headers: { Origin: 'https://attacker.example', 'Content-Type': 'application/json' }, body: JSON.stringify({ type: 'mode', mode: 'live' }) });
    assert.equal(foreign.status, 403); assert.equal(h.snapshot().state.mode, 'demo');
    assert.equal(existsSync(join(h.directory, 'operator-token.txt')), false);
  } finally { await h.dispose(); }
});

test('GSI receiver authenticates, merges partial updates, rejects stale packets and separates DEMO', async () => {
  const h = await harness();
  try {
    assert.equal((await h.request('/api/gsi', { ...packet(), auth: { token: 'wrong' } }, false)).status, 401);
    assert.equal((await h.request('/api/gsi', packet(), false)).status, 200);
    const live = h.snapshot(); assert.equal(live.state.players[0]?.health, 83); assert.equal(live.state.connected, true);
    await h.request('/api/gsi', { auth: { token: 'gsi-test-token' }, provider: { timestamp: 101 }, allplayers: { '76561198000000001': { state: { health: 42 } } } }, false);
    assert.equal(h.snapshot().state.players[0]?.health, 42); assert.equal(h.snapshot().state.players[0]?.money, 4200);
    const stale = await h.request('/api/gsi', packet(90), false); assert.equal(stale.status, 202); assert.equal(h.snapshot().state.players[0]?.health, 42);
    await h.request('/api/command', { type: 'mode', mode: 'demo' });
    assert.equal(h.snapshot().state.mode, 'demo');
    assert.equal((await h.request('/api/gsi', packet(200), false)).status, 202);
    await h.request('/api/command', { type: 'mode', mode: 'live' });
    assert.equal(h.snapshot().state.connected, false); assert.equal(h.snapshot().state.players.length, 0);
    assert.equal((await h.request('/api/gsi', packet(201), false)).status, 200); assert.equal(h.snapshot().state.mode, 'live');
  } finally { await h.dispose(); }
});

test('manual pause has explicit source and settings/library persist across restart', async () => {
  const h = await harness();
  try {
    await h.request('/api/gsi', packet(), false);
    await h.request('/api/command', { type: 'pause', kind: 'technical', duration: 60 });
    assert.equal(h.snapshot().state.pause.source, 'manual'); assert.equal(h.snapshot().state.roundTimer.running, false);
    await h.request('/api/command', { type: 'resume' }); assert.equal(h.snapshot().state.pause.active, false);
    const settings = structuredClone(defaultSettings); settings.tournament.name = 'Сохранённый турнир';
    const updated = await h.request('/api/settings', settings, true, 'PUT'); assert.equal(updated.status, 200, await updated.text());
    const save = await h.request('/api/library', { kind: 'tournament', name: 'Архив', data: settings.tournament }); assert.equal(save.status, 201);
    await h.close();
    const second = createApp({ dataDir: h.directory, gsiToken: 'gsi-test-token' });
    try { assert.equal(second.snapshot().settings.tournament.name, 'Сохранённый турнир'); assert.equal(second.snapshot().state.connected, false); } finally { await second.close(); }
  } finally { await h.dispose(); }
});

test('secret settings are write-only and unsafe uploads are rejected', async () => {
  const h = await harness();
  try {
    await h.request('/api/faceit/settings', { apiKey: 'secret-faceit-key', hubId: 'hub-123' });
    await h.request('/api/obs/settings', { url: 'ws://127.0.0.1:4455', password: 'secret-obs-password' });
    for (const path of ['/api/state', '/api/diagnostics', '/api/faceit/settings', '/api/obs/settings']) {
      const text = await (await h.request(path)).text(); assert.ok(!text.includes('secret-faceit-key')); assert.ok(!text.includes('secret-obs-password'));
    }
    const unsafe = await h.request('/api/upload', { name: '../../evil.svg', dataUrl: 'data:image/svg+xml;base64,' + Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>').toString('base64') }); assert.equal(unsafe.status, 400);
    const fakePng = await h.request('/api/upload', { name: 'evil.png', dataUrl: 'data:image/png;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==' }); assert.equal(fakePng.status, 400);
    const config = await (await h.request('/api/gsi-config')).text(); assert.ok(config.includes('gsi-test-token')); assert.ok(config.includes('/api/gsi'));
    assert.ok(config.includes('"allgrenades" "1"')); assert.ok(config.includes('"map_round_wins" "1"')); assert.ok(config.includes('"player_position" "1"'));
  } finally { await h.dispose(); }
});

test('fresh installation generates only a GSI secret and never returns it in snapshots', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'cs2-hud-secrets-'));
  const app = createApp({ dataDir: directory });
  try {
    const gsi = readFileSync(join(directory, 'gsi-token.txt'), 'utf8').trim();
    assert.equal(gsi.length, 64); assert.equal(existsSync(join(directory, 'operator-token.txt')), false);
    assert.ok(!JSON.stringify(app.snapshot()).includes(gsi));
  } finally { await app.close(); rmSync(directory, { recursive: true, force: true }); }
});

test('FACEIT retries 429 with backoff, caches identical resources, and keeps credentials server-side', async () => {
  let calls = 0, now = 1000; const sleeps: number[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    calls++; assert.equal(String(input), 'https://open.faceit.com/data/v4/matches/match-1');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer test-key');
    return calls === 1 ? new Response('', { status: 429, headers: { 'Retry-After': '1' } }) : Response.json({ match_id: 'match-1', best_of: 3 });
  };
  const client = new FaceitClient({ apiKey: () => 'test-key', fetch: fetcher, now: () => now, sleep: async ms => { sleeps.push(ms); now += ms; } });
  const data = await client.match('match-1'); assert.deepEqual(data, { match_id: 'match-1', best_of: 3 }); assert.equal(calls, 2); assert.ok(sleeps.some(ms => ms >= 1000));
  assert.deepEqual(await client.match('match-1'), data); assert.equal(calls, 2);
  assert.throws(() => client.match('../../admin'), FaceitError);
  const noKey = new FaceitClient({ apiKey: () => '', fetch: fetcher }); await assert.rejects(() => noKey.match('match-1'), /не настроен/);
});

test('OBS v5 authenticates challenge, lists scenes and sends acknowledged scene/item RPC', async () => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 }); await once(server, 'listening');
  const address = server.address(); assert.ok(address && typeof address !== 'string');
  const requests: Array<Record<string, any>> = [];
  const hash = (s: string) => createHash('sha256').update(s).digest('base64');
  server.on('connection', socket => {
    socket.send(JSON.stringify({ op: 0, d: { rpcVersion: 1, authentication: { salt: 'salt', challenge: 'challenge' } } }));
    socket.on('message', raw => {
      const message = JSON.parse(raw.toString());
      if (message.op === 1) {
        assert.equal(message.d.authentication, hash(hash('passwordsalt') + 'challenge'));
        socket.send(JSON.stringify({ op: 2, d: { negotiatedRpcVersion: 1 } }));
      } else if (message.op === 6) {
        requests.push(message.d);
        socket.send(JSON.stringify({ op: 7, d: { requestId: message.d.requestId, requestType: message.d.requestType, requestStatus: { result: true, code: 100 }, responseData: message.d.requestType === 'GetSceneList' ? { currentProgramSceneName: 'GAME', scenes: [{ sceneName: 'GAME' }] } : {} } }));
      }
    });
  });
  const client = new ObsClient();
  try {
    await client.connect(`ws://127.0.0.1:${address.port}`, 'password'); assert.equal(client.status.connected, true);
    const scenes = await client.scenes(); assert.equal(scenes.currentProgramSceneName, 'GAME');
    await client.setScene('PAUSE'); await client.setItem('PAUSE', 42, false);
    assert.ok(requests.some(request => request.requestType === 'SetCurrentProgramScene' && request.requestData.sceneName === 'PAUSE'));
    assert.ok(requests.some(request => request.requestType === 'SetSceneItemEnabled' && request.requestData.sceneItemEnabled === false));
  } finally { client.disconnect(); for (const socket of server.clients) socket.terminate(); await new Promise<void>(resolveClose => server.close(() => resolveClose())); }
});

test('library supports a complete match bundle and unfiltered listing', async () => {
  const h = await harness();
  try {
    const saved = await h.request('/api/library', { kind: 'match', name: 'Матч с составами', data: { match: defaultSettings.match, teams: defaultSettings.teams, tournament: defaultSettings.tournament } });
    assert.equal(saved.status, 201, await saved.clone().text());
    const item = await saved.json(); const listed = await (await h.request('/api/library')).json();
    assert.equal(listed.filter((v: any) => v.kind === 'team').length, 10); assert.equal(listed.find((v: any) => v.id === item.id).data.teams[1].id, defaultSettings.teams[1].id);
    assert.equal((await h.request(`/api/library/${item.id}`, undefined, true, 'DELETE')).status, 200);
    assert.equal((await (await h.request('/api/library')).json()).length, 10);
  } finally { await h.dispose(); }
});

test('manual pause freezes a coherent economy snapshot while the live receiver continues', async () => {
  const h = await harness();
  try {
    await h.request('/api/gsi', packet(), false);
    await h.request('/api/command', { type: 'pause', kind: 'tactical', duration: 30, teamId: defaultSettings.teams[0].id });
    const paused = h.snapshot();
    const next = packet(101); next.map.round = 8; next.allplayers['76561198000000001'].state.money = 1200;
    await h.request('/api/gsi', next, false);
    assert.equal(h.snapshot().state.players[0].money, paused.state.players[0].money);
    assert.equal(h.snapshot().state.round, paused.state.round);
    assert.equal(h.snapshot().state.pause.timer.source, 'manual');
    await h.request('/api/command', { type: 'resume' });
    assert.equal(h.snapshot().state.players[0].money, 1200); assert.equal(h.snapshot().state.round, 9);
  } finally { await h.dispose(); }
});

test('GSI disconnect freezes timers and a fresh snapshot reconnects with a new timer', async () => {
  const h = await harness();
  try {
    const settings = structuredClone(defaultSettings); settings.staleAfterMs = 1000;
    await h.request('/api/settings', settings, true, 'PUT');
    await h.request('/api/gsi', packet(), false);
    await new Promise(resolve => setTimeout(resolve, 1120));
    assert.equal(h.snapshot().state.connected, false); assert.equal(h.snapshot().state.roundTimer.running, false);
    const disconnected = h.snapshot().state;
    settings.match.autoSides = false;
    await h.request('/api/settings', settings, true, 'PUT');
    assert.equal(h.snapshot().state.connected, false);
    assert.equal(h.snapshot().state.receivedAt, disconnected.receivedAt);
    assert.deepEqual(h.snapshot().state.roundTimer, disconnected.roundTimer);
    await h.request('/api/gsi', packet(102), false);
    assert.equal(h.snapshot().state.connected, true); assert.equal(h.snapshot().state.roundTimer.running, true);
  } finally { await h.dispose(); }
});

 test('shutdown acknowledges request, notifies desktop clients and closes server', async () => {
  const h = await harness();
  const socket = new WebSocket(h.url.replace('http:', 'ws:') + '/ws');
  try {
    await once(socket, 'open');
    const notification = once(socket, 'close');
    const closed = once(h.server, 'close');
    const response = await h.request('/api/shutdown', {});
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {ok: true});
    const [code] = await notification;
    assert.equal(code, 4001);
    await closed;
    assert.equal(h.server.listening, false);
  } finally { socket.terminate(); await h.dispose(); }
 });

test('BO2 records both maps for a sweep or draw and ignores repeated gameover', async () => {
  for (const draw of [false, true]) {
    const h = await harness();
    try {
      const settings = structuredClone(defaultSettings);
      settings.match.bestOf = 2; settings.match.maps = ['de_nuke', 'de_mirage'];
      settings.match.mapDetails = {
        de_nuke: { pickTeamId: 'navi', decider: false, scores: {}, startingCTTeamId: 'fnatic' },
        de_mirage: { pickTeamId: 'fnatic', decider: false, scores: {}, startingCTTeamId: 'navi' },
      };
      assert.equal((await h.request('/api/settings', settings, true, 'PUT')).status, 200);
      for (const [i, map] of settings.match.maps.entries()) {
        const p = packet(100 + i);
        p.map = { ...p.map, name: map, phase: 'gameover', team_t: { score: i === 0 || draw ? 13 : 8 }, team_ct: { score: i === 0 || draw ? 8 : 13 } };
        p.allplayers = {} as typeof p.allplayers;
        assert.equal((await h.request('/api/gsi', p)).status, 200);
        await h.request('/api/gsi', p);
      }
      assert.deepEqual(h.snapshot().settings.match.seriesScore, draw ? [1, 1] : [2, 0]);
      assert.deepEqual(h.snapshot().settings.match.mapDetails.de_mirage.scores, draw ? { navi: 8, fnatic: 13 } : { navi: 13, fnatic: 8 });
    } finally { await h.dispose(); }
  }
});


test('side corrections apply immediately to cached GSI, pause and subsequent packets without restart', async () => {
  const h = await harness();
  try {
    await h.request('/api/gsi', packet());
    const before = h.snapshot();
    assert.equal(before.state.players[0].teamId, 'fnatic');
    const swapped = await h.request('/api/command', { type: 'swap-sides' });
    assert.equal(swapped.status, 200);
    let s = h.snapshot();
    assert.equal(s.settings.match.autoSides, false);
    assert.equal(s.state.players[0].side, 'CT'); // Server side must NEVER be fabricated.
    assert.equal(s.state.players[0].teamId, 'navi');
    assert.deepEqual(s.state.teams.map(t => t.side), ['CT', 'T']);
    assert.deepEqual(s.state.teams.map(t => t.score), [3, 4]);
    assert.equal(s.state.receivedAt, before.state.receivedAt);
    await h.request('/api/gsi', packet(101));
    assert.equal(h.snapshot().state.players[0].teamId, 'navi');
    await h.request('/api/command', { type: 'pause', kind: 'tactical', duration: 60, teamId: 'navi' });
    const paused = h.snapshot();
    const next = structuredClone(paused.settings);
    next.match.autoSides = true;
    next.teams[1].steamIds = ['76561198000000001'];
    const saved = await h.request('/api/settings', next, true, 'PUT');
    assert.equal(saved.status, 200);
    s = h.snapshot();
    assert.equal(s.state.players[0].teamId, 'fnatic');
    assert.equal(s.state.pause.active, true);
    assert.equal(s.state.pause.teamId, 'fnatic');
    assert.equal(s.state.roundTimer.remaining, paused.state.roundTimer.remaining);
    assert.equal(s.state.players[0].money, paused.state.players[0].money);
    await h.request('/api/command', { type: 'resume' });
    assert.equal(h.snapshot().state.players[0].teamId, 'fnatic');
    await h.request('/api/gsi', packet(102));
    assert.equal(h.snapshot().state.players[0].teamId, 'fnatic');
    await h.request('/api/gsi', { ...packet(103), map: { ...packet().map, team_ct: { score: 3, consecutive_round_losses: 2 } } });
    await h.request('/api/command', { type: 'pause', kind: 'tactical', duration: 60 });
    const bonusSettings = h.snapshot().settings;
    bonusSettings.match.lossBonus[1] = 999;
    await h.request('/api/settings', bonusSettings, true, 'PUT');
    assert.equal(h.snapshot().state.teams[1].lossBonus, 999);
    bonusSettings.match.lossBonus[1] = null;
    await h.request('/api/settings', bonusSettings, true, 'PUT');
    assert.equal(h.snapshot().state.teams[1].lossBonus, 2400);
  } finally { await h.dispose(); }
});

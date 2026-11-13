import { completedMap } from '../../packages/core/series-result.js';
import { TwitchTitleService, TwitchError, type TwitchStored } from './src/twitch.js';
import { GsiRecorder } from './src/gsi-recorder.js';
import { upgradeRadarMaps } from '../../packages/core/radar-migration.js';
import express, { type Request, type Response, type NextFunction } from 'express';
import { createServer } from 'node:http';
import { randomBytes, randomUUID, timingSafeEqual, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer, WebSocket } from 'ws';
import { z } from 'zod';
import { defaultSettings, createInitialState, GsiNormalizer, DemoEngine, remaining } from '../../packages/core/index.js';
import type { Settings, WireSnapshot, GameState, PauseState, Timer, Diagnostics, LibraryItem, OperatorCommand, TeamConfig } from '../../packages/shared/types.js';
import { Persistence, type EntityKind } from './src/persistence.js';
import { FaceitClient, FaceitError } from './src/faceit.js';
import { ObsClient } from './src/obs.js';
import { decodeUpload } from './src/images.js';
import { settingsSchema, commandSchema, entitySchemas, faceitSettingsSchema, obsSettingsSchema } from './src/validation.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const appVersion = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version;
const installationId = createHash('sha256').update(root.toLowerCase()).digest('hex').slice(0, 16);
const equal = (a: string, b: string): boolean => {
  const left = Buffer.from(a), right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
};
const token = (directory: string, filename: string, provided?: string): string => {
  if (provided) return provided;
  const path = join(directory, filename);
  if (existsSync(path)) return readFileSync(path, 'utf8').trim();
  const value = randomBytes(32).toString('hex');
  writeFileSync(path, `${value}\n`, { mode: 0o600 });
  return value;
};
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const unsafeKey = (value: unknown): boolean => {
  if (!value || typeof value !== 'object') return false;
  return Object.entries(value).some(([key, child]) => ['__proto__', 'prototype', 'constructor'].includes(key) || unsafeKey(child));
};
type FaceitSettings = { apiKey: string; hubId: string; matchId: string; autoSync: boolean; intervalSeconds: number };
type ObsSettings = { url: string; password: string };
type Options = { onShutdown?: () => void; dataDir?: string; gsiToken?: string; faceitFetch?: typeof globalThis.fetch; twitchFetch?: typeof globalThis.fetch; tickMs?: number };

export function createApp(options: Options = {}) {
  // Монотонные часы сохраняют отсчёт при переводе системного времени.
  const wallAnchor = Date.now(), monoAnchor = performance.now();
  const clockNow = () => wallAnchor + performance.now() - monoAnchor;
  const dataDir = resolve(options.dataDir ?? process.env.DATA_DIR ?? join(root, 'data'));
  mkdirSync(dataDir, { recursive: true });
  const uploadsDir = join(dataDir, 'uploads');
  mkdirSync(uploadsDir, { recursive: true });
  const gsiToken = token(dataDir, 'gsi-token.txt', options.gsiToken ?? process.env.GSI_TOKEN);
  const db = new Persistence(join(dataDir, 'hud.sqlite'));
  const bundledTeams = join(root, 'assets/library/teams.json');
  if (!db.get<boolean>('bundledTeamsImported') && existsSync(bundledTeams)) {
    const entries = JSON.parse(readFileSync(bundledTeams, 'utf8')) as LibraryItem[];
    for (const entry of entries) if (!db.find('teams', entry.id)) db.save('teams', entry);
    db.set('bundledTeamsImported', true);
  }
  const recordedMaps = db.get<string[]>('completedMaps') ?? [];
  const saved = settingsSchema.safeParse(db.get<Settings>('settings'));
  let settings: Settings = saved.success ? saved.data : structuredClone(defaultSettings);
  settings.radarMaps = upgradeRadarMaps(settings.radarMaps);
  if (settings.hud.radarSize === 440) settings.hud.radarSize = 520;
  let state = createInitialState(settings, 'live', clockNow());
  let overlay: WireSnapshot['overlay'] = 'auto';
  let manualPause: PauseState | null = null;
  let pauseSnapshot: GameState | null = null;
  let frozenTimers: { round: Timer; bomb: Timer; defuse: Timer } | null = null;
  const normalizer = new GsiNormalizer();
  const recorder = new GsiRecorder();
  const demo = new DemoEngine(settings);
  demo.control('pause', {}, clockNow());
  let faceitSettings: FaceitSettings = { apiKey: process.env.FACEIT_API_KEY ?? '', hubId: '', matchId: '', autoSync: false, intervalSeconds: 60, ...db.get<Partial<FaceitSettings>>('faceit') };
  let obsSettings: ObsSettings = { url: 'ws://127.0.0.1:4455', password: process.env.OBS_PASSWORD ?? '', ...db.get<Partial<ObsSettings>>('obs') };
  const faceit = new FaceitClient({ apiKey: () => faceitSettings.apiKey, fetch: options.faceitFetch });
  const obs = new ObsClient();
  let faceitData: unknown = null;
  let nextFaceitSync = 0;
  let faceitBusy = false;
  const diagnostics: Diagnostics = {
    gsi: { packets: 0, rejected: 0, lastPacket: null, fields: [] },
    faceit: { configured: !!faceitSettings.apiKey, connected: false, message: 'Синхронизация не выполнялась', lastSync: null },
    obs: { configured: false, connected: false, message: 'OBS не подключён', lastSync: null },
    logs: [], demo: { playing: false, scenario: demo.scenario, speed: demo.speed, event: demo.event }, mode: 'live',
  };
  const log = (level: 'info' | 'warning' | 'error', message: string) => {
    // В журнал попадают только подготовленные сообщения, не входные JSON и не секреты.
    db.event(level, message);
  };
  const publicState = (): GameState => {
    const current = structuredClone(manualPause && pauseSnapshot ? pauseSnapshot : state);
    current.broadcastAt = clockNow();
    current.teams = current.teams.map((team, index) => ({ ...team,
      name: settings.teams[index]!.name, tag: settings.teams[index]!.tag, logo: settings.teams[index]!.logo,
      color: settings.teams[index]!.color, secondaryColor: settings.teams[index]!.secondaryColor,
      seriesScore: settings.match.seriesScore[index]!,
      ...(settings.match.scoreOverride ? { score: settings.match.scoreOverride[index]! } : {}),
      ...(settings.match.timeouts[index] !== null ? { timeoutsLeft: settings.match.timeouts[index]! } : {}),
      ...(settings.match.lossBonus[index] !== null ? { lossBonus: settings.match.lossBonus[index]! } : {}),
    })) as GameState['teams'];
    if (manualPause) {
      current.pause = structuredClone(manualPause);
      current.phase = 'paused';
      if (frozenTimers) {
        current.roundTimer = { ...frozenTimers.round };
        current.bomb.timer = { ...frozenTimers.bomb };
        current.bomb.defuseTimer = { ...frozenTimers.defuse };
      }
    }
    return current;
  };
  const snapshot = (): WireSnapshot => ({ state: publicState(), settings: structuredClone(settings), overlay });
  const getDiagnostics = (): Diagnostics => ({ ...diagnostics,
    logs: db.events().map(event => ({ time: Date.parse(event.at), level: event.level, message: event.message })),
    mode: state.mode, demo: { playing: state.mode === 'demo' && demo.playing, scenario: demo.scenario, speed: demo.speed, event: demo.event },
  });
  const twitch = new TwitchTitleService({ stored: db.get<TwitchStored>('twitch'), save: value => db.set('twitch', value), snapshot, fetch: options.twitchFetch });
  const twitchTimer = setInterval(() => { void twitch.tick(); }, 1000);
  twitchTimer.unref();
  const app = express();
  app.disable('x-powered-by');
  const server = createServer(app);
  const websocket = new WebSocketServer({ noServer: true, maxPayload: 1024 });
  const broadcast = () => {
    const json = JSON.stringify(snapshot());
    for (const client of websocket.clients) {
      if (client.readyState !== WebSocket.OPEN) continue;
      if (client.bufferedAmount > 2 * 1024 * 1024) { client.terminate(); continue; }
      client.send(json);
    }
  };
  const allowedHost = (hostname: string) => ['localhost', '127.0.0.1', '[::1]', '::1'].includes(hostname);
  const validOrigin = (origin: string | undefined): boolean => {
    if (!origin) return true;
    try { const url = new URL(origin); return ['http:', 'https:'].includes(url.protocol) && allowedHost(url.hostname); } catch { return false; }
  };
  server.on('upgrade', (request, socket, head) => {
    let host = '';
    try { host = new URL(`http://${request.headers.host ?? ''}`).hostname; } catch { /* rejected below */ }
    if (request.url !== '/ws' || !allowedHost(host) || !validOrigin(request.headers.origin)) { socket.destroy(); return; }
    websocket.handleUpgrade(request, socket, head, client => websocket.emit('connection', client));
  });
  websocket.on('connection', client => {
    client.send(JSON.stringify(snapshot()));
    client.on('error', () => {});
    // Public clients are read-only; no command protocol is exposed on this socket.
    client.on('message', () => client.close(1008, 'Read only'));
  });
  app.use((request, response, next) => {
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Referrer-Policy', 'no-referrer');
    if (!allowedHost(request.hostname) || !validOrigin(request.headers.origin)) { response.status(403).json({ error: 'Разрешено только локальное подключение' }); return; }
    next();
  });
  app.use('/api/gsi', express.json({ limit: '1mb' }));
  app.use(express.json({ limit: '4mb' }));
  app.use('/api', (_request, response, next) => { response.setHeader('Cache-Control', 'no-store'); next(); });
  app.get('/api/health', (_request, response) => response.json({ ok: true, application: 'cs2-hud', version: appVersion, installationId, mode: state.mode, gsiConnected: state.connected && state.mode === 'live' }));
  let shuttingDown = false;
  app.post('/api/shutdown', (_request, response) => {
    if (shuttingDown) { response.json({ ok: true }); return; }
    shuttingDown = true;
    response.once('finish', () => {
      for (const client of websocket.clients) client.close(4001, 'HUD shutdown');
      setTimeout(() => { void close().then(() => options.onShutdown?.()); }, 300);
    });
    response.json({ ok: true });
  });
  app.get('/api/state', (_request, response) => response.json(snapshot()));
  app.post('/api/gsi', (request, response) => {
    if (!object(request.body) || !object(request.body.auth) || typeof request.body.auth.token !== 'string' || !equal(request.body.auth.token, gsiToken)) {
      diagnostics.gsi.rejected++; response.status(401).json({ error: 'Неверный GSI token' }); return;
    }
    if (unsafeKey(request.body) || !['provider', 'map', 'player', 'allplayers', 'round', 'bomb', 'phase_countdowns', 'grenades'].some(key => key in request.body)) {
      diagnostics.gsi.rejected++; response.status(400).json({ error: 'Некорректный GSI пакет' }); return;
    }
    recorder.capture(request.body);
    diagnostics.gsi.packets++;
    diagnostics.gsi.lastPacket = Date.now();
    diagnostics.gsi.fields = Object.keys(request.body).filter(key => !['auth', 'previously', 'added'].includes(key));
    if (state.mode === 'demo') { response.status(202).json({ accepted: false, reason: 'demo-mode' }); return; }
    const payload = { ...request.body }; delete payload.auth;
    const result = normalizer.ingest(payload, settings, clockNow());
    if (!result.accepted) { diagnostics.gsi.rejected++; response.status(202).json({ accepted: false, reason: result.reason }); return; }
    const wasConnected = state.connected;
    state = result.state;
    if (state.connected && state.map && settings.match.map !== state.map) {
      settings.match.map = state.map; db.set('settings', settings);
    }
    const completed = completedMap(state, settings, recordedMaps);
    if (completed) {
      recordedMaps.push(completed.key);
      settings.match.seriesScore[completed.winner] = Math.min((settings.match.bestOf === 2 ? 2 : Math.ceil(settings.match.bestOf / 2)), settings.match.seriesScore[completed.winner] + 1);
      settings.match.mapDetails[state.map] = {
        ...(settings.match.mapDetails[state.map] ?? { pickTeamId: null, decider: false }),
        scores: Object.fromEntries(state.teams.map(team => [team.id, team.score!])),
      };
      if (!settings.match.maps.includes(state.map) && settings.match.maps.length < settings.match.bestOf) settings.match.maps.push(state.map);
      db.database.exec('BEGIN');
      try { db.set('settings', settings); db.set('completedMaps', recordedMaps); db.database.exec('COMMIT'); }
      catch (error) { db.database.exec('ROLLBACK'); throw error; }
    }
    if (!wasConnected) log('info', 'GSI подключён: получен актуальный пакет');
    broadcast(); response.json({ accepted: true });
  });
  app.get('/api/gsi-recording', (_request, response) => response.json(recorder.status()));
  app.post('/api/gsi-recording/start', (_request, response) => response.json(recorder.start()));
  app.post('/api/gsi-recording/stop', (_request, response) => { recorder.stop(); response.json(recorder.status()); });
  app.get('/api/gsi-recording/download', (_request, response) => response.type('application/x-ndjson').attachment(`gsi-${Date.now()}.jsonl`).send(recorder.download()));
  app.get('/api/settings', (_request, response) => response.json(settings));
  const saveSettings = (next: Settings) => {
    const previousSettings = settings;
    const matchChanged = next.match.id !== settings.match.id || next.match.map !== settings.match.map || next.teams.some((team, i) => team.id !== settings.teams[i].id);
    settings = next; db.set('settings', settings); demo.setSettings(settings);
    if (matchChanged && state.mode === 'live') { normalizer.reset(); state = createInitialState(settings, 'live', clockNow()); manualPause = null; frozenTimers = null; pauseSnapshot = null; }
    else if (state.mode === 'live') {
      const before = state;
      state = normalizer.reconfigure(settings) ?? createInitialState(settings, 'live', state.receivedAt);
      state.connected = before.connected;
      if (!before.connected) {
        state.roundTimer = before.roundTimer;
        state.bomb.timer = before.bomb.timer; state.bomb.defuseTimer = before.bomb.defuseTimer;
        state.pause.timer = before.pause.timer;
        state.warnings = [...new Set([...state.warnings, ...before.warnings])];
      }
      if (pauseSnapshot) {
        const oldTeams = pauseSnapshot.teams;
        const remap = (id: string) => state.teams.find(t => t.side === oldTeams.find(old => old.id === id)?.side)?.id ?? id;
        pauseSnapshot.teams = state.teams.map((team, index) => {
          const old = oldTeams.find(t => t.side === team.side)!;
          return { ...team, score: settings.match.scoreOverride?.[index] ?? old.score,
            lossBonus: previousSettings.match.lossBonus[index] !== settings.match.lossBonus[index] ? team.lossBonus : old.lossBonus,
            timeoutsLeft: settings.match.timeouts[index] ?? old.timeoutsLeft };
        }) as GameState['teams'];
        pauseSnapshot.players = pauseSnapshot.players.map(p => ({ ...p, teamId: state.teams.find(t => t.side === p.side)!.id }));
        pauseSnapshot.roundHistory = pauseSnapshot.roundHistory.map(r => ({ ...r, teamId: remap(r.teamId) }));
        if (pauseSnapshot.winner) pauseSnapshot.winner = remap(pauseSnapshot.winner);
        if (manualPause?.teamId) manualPause.teamId = remap(manualPause.teamId);
      }
    }
    else { state = structuredClone(demo.state); }
    broadcast();
  };
  app.put('/api/settings', (request, response) => {
    saveSettings(settingsSchema.parse(request.body)); log('info', 'Настройки сохранены оператором'); response.json(settings);
  });
  app.get('/api/diagnostics', (_request, response) => response.json({ ...getDiagnostics(), state: publicState(), faceitData }));
  app.get('/api/gsi-config', (request, response) => {
    const address = server.address();
    const port = address && typeof address !== 'string' ? address.port : 3190;
    const config = `"CS2 Broadcast HUD"\n{\n  "uri" "http://127.0.0.1:${port}/api/gsi"\n  "timeout" "5.0"\n  "buffer" "0.0"\n  "throttle" "0.05"\n  "heartbeat" "1.0"\n  "auth" { "token" "${gsiToken}" }\n  "data"\n  {\n    "provider" "1"\n    "map" "1"\n    "round" "1"\n    "player_id" "1"\n    "player_state" "1"\n    "player_weapons" "1"\n    "player_match_stats" "1"\n    "allplayers_id" "1"\n    "allplayers_state" "1"\n    "allplayers_match_stats" "1"\n    "allplayers_weapons" "1"\n    "allplayers_position" "1"\n    "phase_countdowns" "1"\n    "bomb" "1"\n    "allgrenades" "1"\n    "map_round_wins" "1"\n    "player_position" "1"\n  }\n}\n`;
    response.type('text/plain').attachment('gamestate_integration_broadcast.cfg').send(config);
  });
  const freeze = (timer: Timer): Timer => ({ ...timer, remaining: remaining(timer, clockNow()), running: false, updatedAt: clockNow() });
  app.post('/api/command', (request, response) => {
    const command: OperatorCommand = commandSchema.parse(request.body);
    if (command.type === 'mode') {
      manualPause = null; frozenTimers = null; pauseSnapshot = null; normalizer.reset();
      state = command.mode === 'demo' ? demo.control('restart', { scenario: 'live' }, clockNow()) : createInitialState(settings, 'live', clockNow());
      if (command.mode === 'live') demo.control('pause', {}, clockNow());
      log('info', command.mode === 'demo' ? 'Включён DEMO: искусственные данные' : 'Включён LIVE: ожидание нового пакета GSI');
    } else if (command.type === 'pause') {
      if (command.teamId && !settings.teams.some(team => team.id === command.teamId)) { response.status(400).json({ error: 'Команда не найдена' }); return; }
      pauseSnapshot = structuredClone(state);
      manualPause = { active: true, kind: command.kind, teamId: command.teamId ?? null, source: 'manual', timer: {
        remaining: command.duration || null, duration: command.duration || null, running: command.duration > 0, updatedAt: clockNow(), source: 'manual',
      } };
      frozenTimers = { round: freeze(state.roundTimer), bomb: freeze(state.bomb.timer), defuse: freeze(state.bomb.defuseTimer) };
      log('info', 'Оператор включил оверлей паузы. Команда в CS2 не отправляется.');
    } else if (command.type === 'resume') { manualPause = null; frozenTimers = null; pauseSnapshot = null; overlay = 'auto'; }
    else if (command.type === 'overlay') overlay = command.overlay;
    else if (command.type === 'demo') {
      if (state.mode !== 'demo') { response.status(409).json({ error: 'Сначала включите DEMO режим' }); return; }
      manualPause = null; frozenTimers = null; pauseSnapshot = null;
      state = demo.control(command.action, { scenario: command.scenario, speed: command.speed }, clockNow());
    } else if (command.type === 'swap-sides') {
      const next = structuredClone(settings);
      next.match.autoSides = false;
      next.teams.forEach(team => { team.side = state.teams.find(t => t.id === team.id)?.side === 'CT' ? 'T' : 'CT'; });
      saveSettings(next);
    } else if (command.type === 'reset') {
      normalizer.reset(); manualPause = null; frozenTimers = null; pauseSnapshot = null;
      state = state.mode === 'demo' ? demo.control('restart', {}, clockNow()) : createInitialState(settings, 'live', clockNow());
    }
    broadcast(); response.json(snapshot());
  });
  const kinds = { team: 'teams', match: 'matches', tournament: 'tournaments' } as const;
  app.get('/api/library', (request, response) => {
    const kind = z.enum(['team', 'match', 'tournament']).optional().parse(request.query.kind);
    response.json(kind ? db.list<LibraryItem>(kinds[kind]) : Object.values(kinds).flatMap(k => db.list<LibraryItem>(k)).sort((a, b) => b.updatedAt - a.updatedAt));
  });
  app.post('/api/library', (request, response) => {
    const body = z.object({ kind: z.enum(['team', 'match', 'tournament']), name: z.string().min(1).max(200), data: z.unknown(), id: z.string().uuid().optional() }).parse(request.body);
    const data = body.kind === 'match' && object(body.data) && 'match' in body.data
      ? z.object({ match: entitySchemas.match, teams: settingsSchema.shape.teams, tournament: entitySchemas.tournament }).parse(body.data)
      : entitySchemas[body.kind].parse(body.data);
    const item: LibraryItem = { id: body.id ?? randomUUID(), kind: body.kind, name: body.name, data, updatedAt: Date.now() };
    db.save(kinds[body.kind], item); response.status(201).json(item);
  });
  app.delete('/api/library/:id', (request, response) => {
    const id = z.string().uuid().parse(request.params.id);
    const deleted = Object.values(kinds).map(kind => db.remove(kind, id)).some(Boolean);
    response.status(deleted ? 200 : 404).json(deleted ? { ok: true } : { error: 'Запись не найдена' });
  });
  app.post('/api/upload', async (request, response) => {
    const body = z.object({ name: z.string().max(200), dataUrl: z.string().max(3_000_000) }).parse(request.body);
    try {
      const image = await decodeUpload(body.dataUrl);
      const filename = `${randomUUID()}.png`;
      writeFileSync(join(uploadsDir, filename), image, { flag: 'wx' });
      response.status(201).json({ url: `/uploads/${filename}` });
    } catch (error) {
      response.status(400).json({ error: error instanceof Error && error.message.startsWith('SVG') ? error.message : 'Неверное изображение: PNG/WebP или простой SVG без внешних ресурсов, до 2 МБ и 4096 × 4096.' });
    }
  });
  const faceitPublic = () => ({ configured: !!faceitSettings.apiKey, hasApiKey: !!faceitSettings.apiKey, hubId: faceitSettings.hubId, matchId: faceitSettings.matchId, autoSync: faceitSettings.autoSync, intervalSeconds: faceitSettings.intervalSeconds });
  const syncFaceit = async () => {
    if (faceitBusy) return faceitData;
    faceitBusy = true;
    try {
      if (faceitSettings.matchId) faceitData = await faceit.match(faceitSettings.matchId);
      else if (faceitSettings.hubId) faceitData = await faceit.hub(faceitSettings.hubId);
      else throw new FaceitError('Укажите FACEIT Hub ID или Match ID', 400);
      diagnostics.faceit = { configured: !!faceitSettings.apiKey, connected: true, message: 'Метаданные получены. Изменения применяются явным импортом.', lastSync: Date.now() };
      return faceitData;
    } catch (error) {
      diagnostics.faceit = { ...diagnostics.faceit, configured: !!faceitSettings.apiKey, connected: false, message: error instanceof FaceitError ? error.message : 'Ошибка FACEIT' };
      throw error;
    } finally { faceitBusy = false; nextFaceitSync = Date.now() + faceitSettings.intervalSeconds * 1000; }
  };
  const twitchSettingsSchema = z.object({ clientId: z.string().trim().regex(/^[a-zA-Z0-9]*$/).max(100), template: z.string().max(1000), enabled: z.boolean() }).strict();
  app.get('/api/twitch', (_request, response) => response.json(twitch.status()));
  app.post('/api/twitch/settings', (request, response) => { twitch.configure(twitchSettingsSchema.parse(request.body)); response.json(twitch.status()); });
  app.post('/api/twitch/connect', async (_request, response) => { await twitch.connect(); response.json(twitch.status()); });
  app.post('/api/twitch/disconnect', (_request, response) => { twitch.disconnect(); response.json(twitch.status()); });
  app.post('/api/twitch/apply', async (_request, response) => { await twitch.apply(); response.json(twitch.status()); });
  app.get('/api/faceit/settings', (_request, response) => response.json(faceitPublic()));
  app.post('/api/faceit/settings', (request, response) => {
    faceitSettings = { ...faceitSettings, ...faceitSettingsSchema.parse(request.body) };
    db.set('faceit', faceitSettings); faceit.clearCache(); nextFaceitSync = 0;
    diagnostics.faceit = { ...diagnostics.faceit, configured: !!faceitSettings.apiKey, connected: false, message: 'Настройки сохранены. Требуется синхронизация.' };
    response.json(faceitPublic());
  });
  app.post('/api/faceit/sync', async (_request, response) => response.json({ data: await syncFaceit(), status: diagnostics.faceit }));
  app.get('/api/faceit/matches', async (_request, response) => response.json(await faceit.hubMatches(faceitSettings.hubId)));
  app.post('/api/faceit/import', async (request, response) => {
    const body = z.object({ matchId: z.string().min(1).max(100) }).parse(request.body);
    const raw = await faceit.match(body.matchId);
    if (!object(raw) || !object(raw.teams)) throw new FaceitError('В матче отсутствуют команды', 422);
    const factions = [raw.teams.faction1, raw.teams.faction2];
    if (!factions.every(object)) throw new FaceitError('FACEIT не вернул обе команды', 422);
    const next = structuredClone(settings);
    next.teams = factions.map((faction, index): TeamConfig => {
      const team = faction as Record<string, unknown>;
      const roster = Array.isArray(team.roster) ? team.roster.filter(object).map(player => ({ steamId: String(player.game_player_id ?? ''), name: String(player.nickname ?? '').slice(0, 200) })).filter(player => /^\d{1,20}$/.test(player.steamId)) : [];
      const logo = typeof team.avatar === 'string' && team.avatar.startsWith('https://') ? team.avatar : '';
      return { ...next.teams[index]!, name: String(team.name ?? next.teams[index]!.name).slice(0, 200), tag: String(team.name ?? next.teams[index]!.tag).slice(0, 20), logo, faceitId: String(team.faction_id ?? ''), steamIds: roster.map(player => player.steamId), roster };
    }) as Settings['teams'];
    next.match.faceitMatchId = body.matchId;
    if (settings.match.faceitMatchId !== body.matchId) {
      next.match.id = `faceit-${body.matchId}`.slice(0, 100);
      next.match.scoreOverride = null; next.match.seriesScore = [0, 0]; next.match.mapDetails = {};
    }
    next.match.name = `${next.teams[0].name} vs ${next.teams[1].name}`;
    if ([1, 2, 3, 5].includes(Number(raw.best_of))) next.match.bestOf = Number(raw.best_of) as 1 | 2 | 3 | 5;
    if (typeof raw.competition_name === 'string') next.tournament.name = raw.competition_name.slice(0, 200);
    const voting = object(raw.voting) && object(raw.voting.map) ? raw.voting.map : null;
    if (voting && Array.isArray(voting.pick)) {
      next.match.maps = voting.pick.filter((map): map is string => typeof map === 'string').slice(0, 10);
      if (settings.match.faceitMatchId !== body.matchId && next.match.maps[0]) next.match.map = next.match.maps[0];
    }
    saveSettings(settingsSchema.parse(next));
    faceitSettings.matchId = body.matchId; db.set('faceit', faceitSettings);
    faceitData = raw; log('info', 'Оператор импортировал метаданные FACEIT; новый матч ожидает новый снимок GSI');
    response.json(settings);
  });
  const obsPublic = () => ({ url: obsSettings.url, hasPassword: !!obsSettings.password, ...obs.status });
  obs.onChange = () => { diagnostics.obs = { configured: !!obsSettings.url, connected: obs.status.connected, message: obs.status.error ?? (obs.status.connected ? `OBS: ${obs.status.currentScene ?? 'подключён'}` : obs.status.connecting ? 'Подключение к OBS…' : 'OBS не подключён'), lastSync: obs.status.connected ? Date.now() : diagnostics.obs.lastSync }; };
  app.get('/api/obs/settings', (_request, response) => response.json(obsPublic()));
  app.post('/api/obs/settings', (request, response) => { obsSettings = { ...obsSettings, ...obsSettingsSchema.parse(request.body) }; db.set('obs', obsSettings); response.json(obsPublic()); });
  app.post('/api/obs/connect', async (_request, response) => { await obs.connect(obsSettings.url, obsSettings.password); response.json(obsPublic()); });
  app.post('/api/obs/disconnect', (_request, response) => { obs.disconnect(); response.json(obsPublic()); });
  app.get('/api/obs/scenes', async (_request, response) => response.json(await obs.scenes()));
  app.post('/api/obs/scene', async (request, response) => { const body = z.object({ sceneName: z.string().min(1).max(200) }).parse(request.body); await obs.setScene(body.sceneName); response.json({ ok: true }); });
  app.get('/api/obs/items', async (request, response) => response.json(await obs.items(z.string().min(1).max(200).parse(request.query.sceneName))));
  app.post('/api/obs/item', async (request, response) => { const body = z.object({ sceneName: z.string().min(1).max(200), sceneItemId: z.number().int().min(0), enabled: z.boolean() }).parse(request.body); await obs.setItem(body.sceneName, body.sceneItemId, body.enabled); response.json({ ok: true }); });
  app.use('/api', (_request, response) => response.status(404).json({ error: 'Маршрут не найден' }));
  app.use('/uploads', express.static(uploadsDir, { fallthrough: false, dotfiles: 'deny', immutable: true, maxAge: '7d' }));
  app.use('/assets', express.static(join(root, 'assets'), { dotfiles: 'deny' }));
  const webDir = join(root, 'dist', 'web');
  if (existsSync(webDir)) {
    app.use(express.static(webDir));
    app.get(['/admin', '/preview', '/overlay/game', '/overlay/pause', '/overlay/production', '/'], (_request, response) => response.sendFile('index.html', { root: webDir }));
  }
  app.use((error: unknown, _request: Request, response: Response, _next: NextFunction) => {
    if (error instanceof z.ZodError) { response.status(400).json({ error: 'Некорректные данные', details: error.issues.map(issue => ({ path: issue.path.join('.'), message: issue.message })) }); return; }
    if (error instanceof TwitchError) { response.status(error.status).json({ error: error.message }); return; }
    if (error instanceof FaceitError) { response.status(error.status >= 400 && error.status <= 599 ? error.status : 502).json({ error: error.message }); return; }
    const known = error as { type?: string; status?: number };
    if (known?.type === 'entity.too.large') { response.status(413).json({ error: 'Размер запроса превышен' }); return; }
    if (known?.type === 'entity.parse.failed') { response.status(400).json({ error: 'Некорректный JSON' }); return; }
    log('error', 'Ошибка обработки запроса оператора');
    response.status(500).json({ error: error instanceof Error && error.message.startsWith('OBS') ? error.message : 'Не удалось выполнить запрос' });
  });
  const timer = setInterval(() => {
    const now = clockNow();
    if (state.mode === 'demo') { state = demo.tick(now); broadcast(); }
    else if (state.connected && now - state.receivedAt > settings.staleAfterMs) {
      const freezeAt = state.receivedAt + settings.staleAfterMs;
      const stale = (value: Timer): Timer => ({ ...value, remaining: remaining(value, freezeAt), running: false, updatedAt: freezeAt });
      state.connected = false; state.roundTimer = stale(state.roundTimer); state.bomb.timer = stale(state.bomb.timer); state.bomb.defuseTimer = stale(state.bomb.defuseTimer);
      state.warnings = [...new Set([...state.warnings, 'GSI: данные устарели, ожидается подключение'])];
      log('warning', 'Потеря GSI: отображаемые таймеры остановлены'); broadcast();
    }
    if (faceitSettings.autoSync && faceitSettings.apiKey && !faceitBusy && now >= nextFaceitSync) void syncFaceit().catch(() => {});
  }, options.tickMs ?? 50);
  timer.unref();
  let closed = false;
  const close = async () => {
    if (closed) return; closed = true;
    clearInterval(timer); clearInterval(twitchTimer); twitch.close(); obs.disconnect();
    for (const client of websocket.clients) client.terminate();
    websocket.close();
    await new Promise<void>(resolveClose => {
      if (!server.listening) { resolveClose(); return; }
      server.close(() => resolveClose()); server.closeAllConnections();
    });
    db.close();
  };
  log('info', 'Backend запущен в LIVE; ожидание GSI');
  return { app, server, close, snapshot, getDiagnostics, dataDir };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const runtime = createApp({ onShutdown: () => process.exit(0) });
  const port = Number(process.env.PORT ?? 3190);
  runtime.server.listen(port, '127.0.0.1', () => {
    console.log(`CS2 Broadcast: http://127.0.0.1:${port}/admin`);
    console.log('LIVE ожидает GSI. Демонстрация включается явно в панели оператора.');
  });
  const stop = () => { void runtime.close().then(() => process.exit(0)); };
  process.once('SIGINT', stop); process.once('SIGTERM', stop);
}

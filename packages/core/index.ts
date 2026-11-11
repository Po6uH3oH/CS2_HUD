import { resolveTeamSides } from './team-assignment.js';
import type { BombState, Economy, GameState, Mode, Player, RadarMap, Settings, Side, Source, TeamState, Timer, Vec3, Weapon } from '../shared/types.js';
import { observerKey, observerOrder } from './presentation.js';
export { defaultSettings } from './defaults.js';
export { DemoEngine, demoScenarios } from './demo.js';
export { observerKey, observerOrder, presentationState } from './presentation.js';
export { builtInRadarMaps } from './radar-presets.js';
export { upgradeRadarMaps } from './radar-migration.js';

type Obj = Record<string, unknown>;
const forbidden = new Set(['__proto__', 'prototype', 'constructor']);
const object = (value: unknown): Obj => value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Obj : {};
const has = (value: Obj, key: string) => Object.prototype.hasOwnProperty.call(value, key);
const number = (value: unknown): number | null => (typeof value === 'number' || typeof value === 'string' && value.trim() !== '') && Number.isFinite(Number(value)) ? Number(value) : null;
const nonnegative = (value: unknown) => { const n = number(value); return n === null ? null : Math.max(0, n); };
const string = (value: unknown, fallback = '') => typeof value === 'string' ? value : fallback;
const bool = (value: unknown) => typeof value === 'boolean' ? value : null;
const side = (value: unknown): Side | null => value === 'CT' || value === 'T' ? value : null;
const clone = <T>(value: T): T => structuredClone(value);

export function timer(value: number | null = null, duration: number | null = null, source: Source = 'unknown', now = Date.now(), running = true): Timer {
  return { remaining: value, duration, source, updatedAt: now, running: value !== null && running };
}
export function remaining(value: Timer, now = Date.now()): number | null {
  if (value.remaining === null || !Number.isFinite(value.remaining)) return null;
  return Math.max(0, value.remaining - (value.running ? Math.max(0, now - value.updatedAt) / 1000 : 0));
}
export const timerRemaining = remaining;

/** Небольшой джиттер пакетов сглаживается, существенное расхождение исправляется сразу. */
function syncTimer(previous: Timer, value: number | null, duration: number | null, now: number): Timer {
  const projected = remaining(previous, now);
  const smoothed = value !== null && projected !== null && previous.source === 'gsi' && previous.running && Math.abs(projected - value) < 0.25
    ? value * 0.65 + projected * 0.35 : value;
  return timer(smoothed, duration, 'gsi', now);
}

export function parseVector(value: unknown): Vec3 | null {
  const parts = typeof value === 'string' ? value.split(',').map(v => v.trim()) : Array.isArray(value) ? value : [object(value).x, object(value).y, object(value).z];
  if (parts.length !== 3 || parts.some(v => number(v) === null)) return null;
  return { x: Number(parts[0]), y: Number(parts[1]), z: Number(parts[2]) };
}

export function worldToRadar(position: Vec3, map: RadarMap): { x: number; y: number } {
  if (!(map.scale > 0) || !(map.size > 0)) return { x: NaN, y: NaN };
  const x = (position.x - map.originX) / map.scale, y = (map.originY - position.y) / map.scale;
  const angle = map.rotation * Math.PI / 180, center = map.size / 2;
  return { x: center + (x - center) * Math.cos(angle) - (y - center) * Math.sin(angle), y: center + (x - center) * Math.sin(angle) + (y - center) * Math.cos(angle) };
}
function inPolygon(p: Vec3, vertices: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const [xi, yi] = vertices[i], [xj, yj] = vertices[j];
    if ((yi > p.y) !== (yj > p.y) && p.x < (xj - xi) * (p.y - yi) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
export function selectRadarLayer(position: Vec3, map: RadarMap): string {
  const region = map.regions.find(r => position.z >= r.minZ && position.z < r.maxZ && inPolygon(position, r.polygon));
  return region?.layer ?? map.layers.find(l => position.z >= l.minZ && position.z < l.maxZ)?.id ?? 'unknown';
}

export function economy(players: Player[]): Economy {
  const complete = players.length === 5 && players.every(p => p.money !== null && p.equipmentValue !== null && p.health !== null && p.inventoryKnown);
  const sum = (key: 'money' | 'equipmentValue') => players.length === 5 && players.every(p => p[key] !== null) ? players.reduce((acc, p) => acc + p[key]!, 0) : null;
  const grenades: Record<string, number> = {};
  for (const p of players) for (const w of p.weapons) if (w.type.toLowerCase() === 'grenade') grenades[w.name] = (grenades[w.name] ?? 0) + w.count;
  const count = Object.values(grenades).reduce((a, b) => a + b, 0);
  return { money: sum('money'), equipmentValue: sum('equipmentValue'), alive: players.filter(p => p.alive && p.health !== null).length, grenades, utilityLevel: complete ? count >= 15 ? 'full' : count >= 6 ? 'partial' : 'low' : 'unknown', complete };
}
export const calculateEconomy = economy;

function emptyBomb(now: number): BombState { return { state: 'unknown', position: null, playerId: null, timer: timer(null, null, 'unknown', now), defuseTimer: timer(null, null, 'unknown', now), defuserHasKit: null }; }
export function createInitialState(settings: Settings, mode: Mode = 'live', now = Date.now()): GameState {
  return { revision: 0, mode, receivedAt: now, connected: false, map: settings.match.map, phase: 'unknown', round: 0,
    teams: settings.teams.map((team, i) => ({ ...clone(team), score: settings.match.scoreOverride?.[i] ?? null, seriesScore: settings.match.seriesScore[i], timeoutsLeft: settings.match.timeouts[i], lossBonus: settings.match.lossBonus[i] })) as [TeamState, TeamState],
    players: [], observedId: null, roundTimer: timer(null, null, 'unknown', now), bomb: emptyBomb(now),
    pause: { active: false, kind: 'paused', teamId: null, timer: timer(null, null, 'unknown', now), source: 'unknown' },
    roundHistory: [], grenades: [], capabilities: [], warnings: ['Ожидание данных наблюдателя CS2.'], winner: null };
}

function merge(base: Obj, patch: Obj, path = ''): Obj {
  const result: Obj = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (forbidden.has(key) || ['auth', 'previously', 'added', 'removed'].includes(key) && path === '') continue;
    if (value === null) { delete result[key]; continue; }
    if (value !== null && typeof value === 'object' && !Array.isArray(value)) {
      const nextPath = path ? `${path}.${key}` : key;
      if (['weapons', 'flames', 'round_wins'].includes(key)) result[key] = merge({}, object(value), nextPath);
      else if (key === 'allplayers' || key === 'grenades') {
        const collection: Obj = {};
        for (const [id, entry] of Object.entries(object(value))) if (!forbidden.has(id) && entry !== null) {
          const old = object(object(base[key])[id]), incoming = object(entry);
          const reused = key === 'grenades' && (has(incoming, 'type') && incoming.type !== old.type || number(incoming.lifetime) !== null && number(old.lifetime) !== null && number(incoming.lifetime)! < number(old.lifetime)!);
          collection[id] = merge(reused ? {} : old, incoming, `${nextPath}.${id}`);
        }
        result[key] = collection;
      } else result[key] = merge(object(base[key]), object(value), nextPath);
    } else result[key] = value;
  }
  return result;
}
function removePrevious(target: Obj, previous: Obj, current: Obj): void {
  for (const [key, value] of Object.entries(previous)) {
    if (forbidden.has(key)) continue;
    if (!has(current, key)) delete target[key];
    else if (value && typeof value === 'object' && !Array.isArray(value)) removePrevious(object(target[key]), object(value), object(current[key]));
  }
}
function removeExplicit(target: Obj, removed: unknown): void {
  if (Array.isArray(removed)) {
    for (const path of removed) if (typeof path === 'string') {
      const keys = path.split('.'); if (keys.some(k => forbidden.has(k))) continue;
      let node = target; for (const key of keys.slice(0, -1)) node = object(node[key]); delete node[keys.at(-1)!];
    }
  } else for (const [key, value] of Object.entries(object(removed))) {
    if (forbidden.has(key)) continue;
    if (value === true || value === null) delete target[key]; else removeExplicit(object(target[key]), value);
  }
}

function weapons(value: unknown): Weapon[] {
  return Object.values(object(value)).flatMap(entry => {
    const w = object(entry), name = string(w.name); if (!name) return [];
    const type = string(w.type, 'Unknown'), count = type.toLowerCase() === 'grenade' ? Math.max(1, nonnegative(w.ammo_reserve) ?? 1) : 1;
    return [{ name, type, state: string(w.state, 'holstered'), ammoClip: nonnegative(w.ammo_clip) ?? undefined, ammoClipMax: nonnegative(w.ammo_clip_max) ?? undefined, ammoReserve: nonnegative(w.ammo_reserve) ?? undefined, count }];
  });
}

/** Reads only the public GSI HTTP payload. It never synthesizes live kills or missing telemetry. */
export class GsiNormalizer {
  private raw: Obj = {};
  private lastTimestamp: number | null = null;
  private matchId = '';
  private flashRange: 1 | 255 = 1;
  private state: GameState | null = null;
  reset(): void { this.raw = {}; this.lastTimestamp = null; this.matchId = ''; this.state = null; this.flashRange = 1; }

  /** Apply operator corrections to cached telemetry without inventing a fresh GSI heartbeat. */
  reconfigure(settings: Settings): GameState | null {
    if (!this.state) return null;
    const before = clone(this.state);
    const updated = this.ingest({ map: {} }, settings, before.receivedAt).state;
    if (before.teams[0].side !== updated.teams[0].side) {
      const remap = (id: string) => updated.teams.find(t => t.side === before.teams.find(old => old.id === id)?.side)?.id ?? id;
      updated.roundHistory = before.roundHistory.map(r => ({ ...r, teamId: remap(r.teamId) }));
      updated.grenades = updated.grenades.map(g => ({ ...g, ownerTeamId: g.ownerTeamId ? remap(g.ownerTeamId) : undefined }));
    }
    this.state = clone(updated);
    return updated;
  }

  ingest(payload: unknown, settings: Settings, now = Date.now()): { accepted: boolean; state: GameState; reason?: string } {
    const initial = this.state ?? createInitialState(settings, 'live', now);
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return { accepted: false, state: clone(initial), reason: 'GSI packet must be an object' };
    const patch = object(payload), provider = object(patch.provider), timestamp = number(provider.timestamp);
    if (!Object.keys(patch).some(k => ['provider', 'map', 'round', 'player', 'allplayers', 'bomb', 'phase_countdowns', 'grenades', 'removed', 'previously'].includes(k))) return { accepted: false, state: clone(initial), reason: 'GSI packet contains no state fields' };
    if (provider.appid !== undefined && number(provider.appid) !== 730) return { accepted: false, state: clone(initial), reason: 'Unsupported provider appid' };
    if (timestamp !== null && this.lastTimestamp !== null && timestamp < this.lastTimestamp) return { accepted: false, state: clone(initial), reason: 'Out-of-order GSI packet' };
    const previousMap = object(this.raw.map), incomingMap = object(patch.map);
    const oldRound = number(previousMap.round), newRound = number(incomingMap.round);
    const newContext = this.matchId !== '' && this.matchId !== settings.match.id ||
      !!string(previousMap.name) && !!string(incomingMap.name) && previousMap.name !== incomingMap.name ||
      !!string(object(this.raw.provider).steamid) && !!string(provider.steamid) && object(this.raw.provider).steamid !== provider.steamid ||
      oldRound !== null && newRound !== null && newRound < oldRound ||
      incomingMap.phase === 'warmup' && previousMap.phase !== undefined && previousMap.phase !== 'warmup';
    let prev = initial;
    if (newContext) { this.raw = {}; this.flashRange = 1; prev = createInitialState(settings, 'live', now); }
    const roundChanged = !newContext && oldRound !== null && newRound !== null && newRound !== oldRound;
    if (roundChanged) {
      delete this.raw.bomb; delete this.raw.round; delete this.raw.phase_countdowns; delete this.raw.grenades;
      for (const entry of [...Object.values(object(this.raw.allplayers)), this.raw.player]) { const p = object(entry); p.state = {}; delete p.weapons; delete p.position; delete p.forward; }
      prev = { ...prev, bomb: emptyBomb(now), roundTimer: timer(null, null, 'unknown', now), pause: { ...prev.pause, active: false }, winner: null };
    }
    const incomingPlayer = object(patch.player);
    // A newly observed player must not inherit the previous target's flash/state.
    if (string(incomingPlayer.steamid) && incomingPlayer.steamid !== object(this.raw.player).steamid) delete object(this.raw.player).state;
    this.raw = merge(this.raw, patch);
    removePrevious(this.raw, object(patch.previously), patch);
    removeExplicit(this.raw, patch.removed);
    this.matchId = settings.match.id;
    if (timestamp !== null) this.lastTimestamp = timestamp;
    const raw = this.raw, map = object(raw.map), round = object(raw.round), phase = object(raw.phase_countdowns), bomb = object(raw.bomb);
    const activePlayer = object(raw.player);
    // A fresh player-state flash is newer than a cached allplayers value (including 0).
    const activeId = string(activePlayer.steamid), freshFlash = object(incomingPlayer.state);
    const allPlayer = object(object(raw.allplayers)[activeId]);
    if (has(freshFlash, 'flashed') && !has(object(object(object(patch.allplayers)[activeId]).state), 'flashed') && Object.keys(allPlayer).length) {
      const allState = object(allPlayer.state);
      if (freshFlash.flashed === null) delete allState.flashed; else allState.flashed = freshFlash.flashed;
      allPlayer.state = allState;
    }
    const observedCandidate = string(activePlayer.spectarget) || string(activePlayer.steamid);
    const oldById = new Map(prev.players.map(p => [p.steamId, p]));
    const sourcePlayers = Object.keys(object(raw.allplayers)).length ? object(raw.allplayers) : string(activePlayer.steamid) && side(activePlayer.team) ? { [string(activePlayer.steamid)]: activePlayer } : {};
    const identities = Object.entries(sourcePlayers).flatMap(([steamId, entry]) => {
      const playerSide = side(object(entry).team);
      return playerSide ? [{ steamId, side: playerSide }] : [];
    });
    const assignment = resolveTeamSides(settings, identities, newContext || !this.state ? null : prev, string(map.name, settings.match.map));
    const sides = assignment.sides;
    // Some CS2 demos report 0/1 instead of the legacy byte range. Once byte data
    // is observed, keep that scale for this source context, including its fading tail.
    if ([...Object.values(sourcePlayers), activePlayer].some(p => (nonnegative(object(object(p).state).flashed) ?? 0) > 1)) this.flashRange = 255;
    const players: Player[] = Object.entries(sourcePlayers).flatMap(([id, entry]) => {
      const p = object(entry), s = object(p.state), stats = object(p.match_stats), playerSide = side(p.team); if (!playerSide) return [];
      const team = settings.teams[sides.indexOf(playerSide)] ?? settings.teams[0];
      const health = nonnegative(s.health), inventory = weapons(p.weapons);
      const flashed = nonnegative(s.flashed) ?? (id === string(activePlayer.steamid) ? nonnegative(object(activePlayer.state).flashed) : null);
      return [{ steamId: id, name: string(p.name, team.roster?.find(r => r.steamId === id)?.name ?? id), teamId: team.id, side: playerSide, slot: observerKey(p.observer_slot),
        health, flashed: flashed == null ? null : Math.min(255, flashed / this.flashRange * 255), armor: nonnegative(s.armor), helmet: bool(s.helmet), money: nonnegative(s.money), alive: health !== null && health > 0, defuseKit: bool(s.defusekit),
        hasBomb: inventory.some(w => w.name === 'weapon_c4') || bomb.state === 'carried' && bomb.player === id, weapons: inventory, inventoryKnown: has(p, 'weapons'),
        kills: nonnegative(stats.kills), assists: nonnegative(stats.assists), deaths: nonnegative(stats.deaths), roundKills: nonnegative(s.round_kills), roundDamage: nonnegative(s.round_totaldmg), equipmentValue: nonnegative(s.equip_value),
        position: parseVector(p.position), deathPosition: health === 0 ? (!roundChanged ? oldById.get(id)?.deathPosition : null) ?? parseVector(p.position) ?? (!roundChanged ? oldById.get(id)?.position : null) ?? null : null, forward: parseVector(p.forward), observed: id === observedCandidate }];
    }).sort((a, b) => observerOrder(a.slot) - observerOrder(b.slot) || a.steamId.localeCompare(b.steamId));
    const teams = settings.teams.map((team, i) => {
      const stats = object(map[sides[i] === 'CT' ? 'team_ct' : 'team_t']);
      const losses = nonnegative(stats.consecutive_round_losses);
      return { ...clone(team), side: sides[i], score: settings.match.scoreOverride?.[i] ?? nonnegative(stats.score) ?? (newContext ? null : prev.teams.find(t => t.side === sides[i])?.score ?? null),
        seriesScore: settings.match.seriesScore[i], timeoutsLeft: settings.match.timeouts[i] ?? nonnegative(stats.timeouts_remaining), lossBonus: settings.match.lossBonus[i] ?? (losses === null ? null : 1400 + Math.min(4, Math.floor(losses)) * 500) };
    }) as [TeamState, TeamState];
    const phaseName = map.phase === 'gameover' ? 'gameover' : ['paused', 'timeout_ct', 'timeout_t'].includes(string(phase.phase)) ? string(phase.phase) : round.phase === 'over' ? 'over' : string(phase.phase, string(round.phase, string(map.phase, 'unknown')));
    const phaseRemaining = nonnegative(phase.phase_ends_in), incomingPhase = object(patch.phase_countdowns);
    const freshPhase = has(incomingPhase, 'phase_ends_in');
    const phaseChanged = phaseName !== prev.phase;
    let roundTimer = phaseChanged ? timer(null, null, 'unknown', now) : clone(prev.roundTimer);
    if (freshPhase && ['live', 'freezetime', 'warmup', 'over'].includes(phaseName)) roundTimer = syncTimer(phaseChanged ? timer() : prev.roundTimer, phaseRemaining, phaseChanged ? phaseRemaining : prev.roundTimer.duration ?? phaseRemaining, now);
    if (phaseName === 'paused') roundTimer = timer(remaining(prev.roundTimer, now), prev.roundTimer.duration, prev.roundTimer.source, now, false);

    const allowedBomb = ['carried', 'dropped', 'planting', 'planted', 'defusing', 'defused', 'exploded'];
    const incomingBomb = object(patch.bomb), freshBomb = has(incomingBomb, 'countdown');
    // A partial bomb update may keep "dropped" after pickup. A newly acquired C4
    // in a fresh inventory is stronger evidence than that cached state.
    const freshCarrier = players.find(p => p.health !== 0 && p.weapons.some(w => w.name === 'weapon_c4') &&
      has(object(object(patch.allplayers)[p.steamId]), 'weapons')) ??
      players.find(p => p.steamId === string(object(patch.player).steamid) && p.health !== 0 && has(object(patch.player), 'weapons') && p.weapons.some(w => w.name === 'weapon_c4'));
    const roundBomb = string(object(patch.round).bomb);
    let stateName = !has(incomingBomb, 'state') && allowedBomb.includes(roundBomb) ? roundBomb : string(bomb.state, string(round.bomb));
    if (!has(incomingBomb, 'state') && allowedBomb.includes(roundBomb)) { bomb.state = roundBomb; raw.bomb = bomb; }
    if (freshCarrier && ['unknown', '', 'dropped', 'carried'].includes(stateName)) {
      stateName = 'carried'; bomb.state = stateName; bomb.player = freshCarrier.steamId;
      delete bomb.position; raw.bomb = bomb;
    }
    const bombState: BombState['state'] = allowedBomb.includes(stateName) ? stateName as BombState['state'] : 'unknown';
    if (has(incomingBomb, 'state') && incomingBomb.state !== prev.bomb.state && !has(incomingBomb, 'player') && !['carried', 'planting'].includes(bombState)) delete bomb.player;
    let bombTimer = clone(prev.bomb.timer), defuseTimer = clone(prev.bomb.defuseTimer);
    if (!['planted', 'defusing'].includes(bombState)) { bombTimer = timer(null, null, 'unknown', now); defuseTimer = timer(null, null, 'unknown', now); }
    else {
      if (phaseName === 'bomb' && freshPhase) bombTimer = syncTimer(prev.bomb.timer, phaseRemaining, prev.bomb.timer.duration ?? Math.max(settings.bombDuration, phaseRemaining ?? 0), now);
      else if (bombState === 'planted' && freshBomb) bombTimer = syncTimer(prev.bomb.timer, nonnegative(bomb.countdown), prev.bomb.timer.duration ?? Math.max(settings.bombDuration, nonnegative(bomb.countdown) ?? 0), now);
      else if (bombState === 'planted' && ['carried', 'dropped', 'planting'].includes(prev.bomb.state)) {
        // Только наблюдаемый переход к установке. При подключении посреди раунда оценка запрещена.
        bombTimer = timer(settings.bombDuration, settings.bombDuration, 'estimate', now);
      }
      if (bombState === 'defusing') {
        const countdown = freshBomb ? nonnegative(bomb.countdown) : phaseName === 'defuse' && freshPhase ? phaseRemaining : null;
        if (countdown !== null) defuseTimer = syncTimer(prev.bomb.state === 'defusing' ? prev.bomb.defuseTimer : timer(), countdown, prev.bomb.state === 'defusing' ? prev.bomb.defuseTimer.duration ?? countdown : countdown, now);
        else if (prev.bomb.state === 'planted') {
          const kit = players.find(p => p.steamId === string(bomb.player))?.defuseKit;
          if (kit !== null && kit !== undefined) { const duration = kit ? settings.defuseWithKit : settings.defuseWithoutKit; defuseTimer = timer(duration, duration, 'estimate', now); }
        }
      } else defuseTimer = timer(null, null, 'unknown', now);
    }
    const playerId = bombState === 'defusing' ? string(bomb.player) || null : ['carried', 'planting'].includes(bombState) ? string(bomb.player) || players.find(p => p.hasBomb)?.steamId || null : null;
    for (const player of players) {
      if (['dropped', 'planted', 'defusing', 'defused', 'exploded'].includes(bombState)) player.hasBomb = false;
      else if (playerId) player.hasBomb = player.steamId === playerId && player.health !== 0;
    }
    const normalizedBomb: BombState = { state: bombState, position: bombState === 'carried' ? null : parseVector(bomb.position), playerId, timer: bombTimer, defuseTimer, defuserHasKit: bombState === 'defusing' ? players.find(p => p.steamId === playerId)?.defuseKit ?? null : null };
    const isPause = ['paused', 'timeout_ct', 'timeout_t'].includes(phaseName);
    if (isPause) {
      const freeze = (value: Timer) => ({ ...value, remaining: remaining(value, now), updatedAt: now, running: false });
      roundTimer = freeze(roundTimer); normalizedBomb.timer = freeze(normalizedBomb.timer); normalizedBomb.defuseTimer = freeze(normalizedBomb.defuseTimer);
    }
    if (['over', 'gameover', 'intermission'].includes(phaseName)) {
      roundTimer = timer(null, null, 'unknown', now);
      normalizedBomb.timer = timer(null, null, 'unknown', now); normalizedBomb.defuseTimer = timer(null, null, 'unknown', now);
    }
    const pauseTeam = phaseName === 'timeout_ct' ? 'CT' : phaseName === 'timeout_t' ? 'T' : null;
    const pause = { active: settings.autoPause && isPause, kind: (pauseTeam ? 'tactical' : 'paused') as GameState['pause']['kind'], teamId: pauseTeam ? teams.find(t => t.side === pauseTeam)?.id ?? null : null,
      timer: isPause && freshPhase ? timer(phaseRemaining, phaseChanged ? phaseRemaining : prev.pause.timer.duration ?? phaseRemaining, 'gsi', now, phaseName !== 'paused') : isPause ? clone(prev.pause.timer) : timer(null, null, 'unknown', now), source: (isPause ? 'gsi' : 'unknown') as Source };
    const reportedWins = Object.entries(object(map.round_wins));
    const history = newContext ? [] : clone(prev.roundHistory);
    const currentRound = (nonnegative(map.round) ?? 0) + 1;
    // Full GSI history is authoritative, including when joining a match mid-round.
    if (reportedWins.length) {
      const reported = new Set(reportedWins.map(([r]) => Number(r)));
      for (let i = history.length - 1; i >= 0; i--) if (!reported.has(history[i].round)) history.splice(i, 1);
    }
    for (const [r, reason] of reportedWins) {
      const n = number(r); if (n === null || history.some(h => h.round === n)) continue;
      const reasonText = string(reason), winningSide = reasonText.startsWith('ct_') ? 'CT' : reasonText.startsWith('t_') ? 'T' : null;
      if (!winningSide) continue;
      // Regulation CS2 uses MR12. Do not guess historical team ownership in overtime.
      const referenceRound = round.phase === 'over' ? Math.max(1, nonnegative(map.round) ?? 1) : currentRound;
      const swapped = n <= 24 && referenceRound <= 24 && (n <= 12) !== (referenceRound <= 12);
      const currentSide = swapped ? winningSide === 'CT' ? 'T' : 'CT' : winningSide;
      const teamId = n <= 24 && referenceRound <= 24 ? teams.find(t => t.side === currentSide)?.id ?? '' : '';
      history.push({ round: n, side: winningSide, teamId, method: reasonText });
    }
    const winSide = side(round.win_team);
    if (!reportedWins.length && winSide && round.phase === 'over' && !history.some(h => h.round === currentRound)) history.push({ round: currentRound, side: winSide, teamId: teams.find(t => t.side === winSide)!.id, method: bombState === 'defused' ? 'defuse' : bombState === 'exploded' ? 'bomb' : 'round' });
    const capabilities = [Object.keys(object(raw.allplayers)).length > 0 && 'allplayers', players.some(p => p.position !== null) && 'positions', players.some(p => p.forward !== null) && 'directions', phaseRemaining !== null && 'countdowns', bombState !== 'unknown' && 'bomb', has(raw, 'grenades') && 'grenades', players.some(p => p.equipmentValue !== null) && 'equipment', teams.some(t => t.timeoutsLeft !== null) && 'timeouts'].filter(Boolean) as string[];
    const warnings = [assignment.warning, !capabilities.includes('allplayers') && 'Нет полного состава наблюдателя; проверьте режим и подписки GSI.', !capabilities.includes('positions') && 'GSI не сообщает координаты игроков.', bombState === 'planted' && bombTimer.remaining === null && 'Источник не сообщает таймер бомбы.', !settings.radarMaps.find(m => m.id === string(map.name))?.calibrated && 'Радар этой карты не откалиброван.'].filter(Boolean) as string[];
    const grenades = Object.entries(object(raw.grenades)).flatMap(([id, entry]) => {
      const g = object(entry), flames = Object.values(object(g.flames)).map(parseVector).filter((p): p is Vec3 => p !== null);
      const position = parseVector(g.position) ?? (flames.length ? flames.reduce((sum, p) => ({ x: sum.x + p.x / flames.length, y: sum.y + p.y / flames.length, z: sum.z + p.z / flames.length }), { x: 0, y: 0, z: 0 }) : null);
      const type = string(g.type, 'unknown'), lifetime = nonnegative(g.lifetime);
      const previous = !newContext && !roundChanged ? prev.grenades.find(old => old.id === id && old.type === type && !(lifetime !== null && old.lifetime !== null && lifetime < old.lifetime)) : undefined;
      const reportedOwner = string(g.owner);
      const owner = previous?.ownerTeamId || previous?.ownerSide ? previous.owner : (reportedOwner && reportedOwner !== '0' ? reportedOwner : previous?.owner);
      const thrower = players.find(p => p.steamId === owner) ?? oldById.get(owner ?? '');
      // Throw ownership belongs to the grenade, not to the owner's current life/team state.
      return position ? [{ id, type, position, owner, ownerTeamId: previous?.ownerTeamId ?? thrower?.teamId, ownerSide: previous?.ownerSide ?? thrower?.side,
        velocity: parseVector(g.velocity), effectTime: nonnegative(g.effecttime), lifetime, flames }] : [];
    });
    this.state = { revision: initial.revision + 1, mode: 'live', receivedAt: now, connected: true, map: string(map.name, settings.match.map), phase: phaseName, round: currentRound,
      teams, players, observedId: players.some(p => p.steamId === observedCandidate) ? observedCandidate : null, roundTimer, bomb: normalizedBomb, pause, roundHistory: history.sort((a, b) => a.round - b.round), grenades,
      capabilities, warnings, winner: winSide ? teams.find(t => t.side === winSide)?.id ?? null : null };
    return { accepted: true, state: clone(this.state) };
  }
}

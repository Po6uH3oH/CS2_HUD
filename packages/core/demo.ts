import type { GameState, Player, Settings, Side, Timer, Weapon } from '../shared/types.js';
import { createInitialState, timer } from './index.js';

export const demoScenarios = ['live', 'warmup', 'freezetime', 'bomb', 'defuse', 'exploded', 'round-end', 'map-end', 'tactical', 'technical', 'swap-sides', 'overtime', 'disconnected'] as const;
const names = [['b1t', 'iM', 'Aleksib', 'jL', 'w0nderful'], ['KRIMZ', 'blameF', 'MATYS', 'bodyy', 'afro']];
const durations: Record<string, number> = { live: 30, warmup: 15, freezetime: 15, bomb: 24, defuse: 10, exploded: 6, 'round-end': 7, 'map-end': 10, tactical: 20, technical: 15, 'swap-sides': 15, overtime: 20, disconnected: 8 };
const aliases: Record<string, string> = { game: 'live', pause: 'tactical', timeout: 'tactical', planted: 'bomb', defusing: 'defuse', buy: 'freezetime', round: 'round-end', end: 'map-end', sides: 'swap-sides', offline: 'disconnected' };
const clone = <T>(value: T) => structuredClone(value);

/** Synthetic fixtures are isolated from GSI. All timers and capabilities are labelled demo. */
export class DemoEngine {
  state: GameState;
  playing = true;
  scenario = 'live';
  speed = 1;
  event = 0;
  private settings: Settings;
  private elapsed = 0;
  private lastTick: number;
  constructor(settings: Settings, now = Date.now()) {
    this.settings = clone(settings); this.lastTick = now;
    this.state = createInitialState(settings, 'demo', now);
    this.render(now);
  }
  setSettings(settings: Settings): void { this.settings = clone(settings); this.render(this.lastTick); }
  control(action: 'play' | 'pause' | 'restart' | 'next', options: { scenario?: string; speed?: number } = {}, now = Date.now()): GameState {
    this.advance(now);
    if (options.speed !== undefined && Number.isFinite(options.speed)) this.speed = Math.max(0.25, Math.min(4, options.speed));
    if (options.scenario) { const candidate = aliases[options.scenario] ?? options.scenario; if (candidate !== this.scenario && demoScenarios.includes(candidate as typeof demoScenarios[number])) { this.scenario = candidate; this.elapsed = 0; this.event++; } }
    if (action === 'play') this.playing = true;
    if (action === 'pause') this.playing = false;
    if (action === 'restart') { this.elapsed = 0; this.event = 0; this.playing = true; }
    if (action === 'next') this.next();
    this.lastTick = now; this.render(now); return clone(this.state);
  }
  tick(now = Date.now()): GameState { this.advance(now); this.render(now); return clone(this.state); }
  private next(): void {
    const index = demoScenarios.indexOf(this.scenario as typeof demoScenarios[number]);
    this.scenario = demoScenarios[(index + 1) % demoScenarios.length]; this.elapsed = 0; this.event++;
  }
  private advance(now: number): void {
    if (this.playing) this.elapsed += Math.max(0, now - this.lastTick) / 1000 * this.speed;
    this.lastTick = now;
    // Ignore excessive elapsed time after a sleeping computer instead of racing through events.
    if (this.elapsed > (durations[this.scenario] ?? 20)) this.next();
  }
  private render(now: number): void {
    const settings = this.settings, elapsed = this.elapsed, scenario = this.scenario;
    const state = createInitialState(settings, 'demo', now);
    state.revision = this.state.revision + 1; state.connected = scenario !== 'disconnected'; state.phase = scenario === 'warmup' ? 'warmup' : scenario === 'freezetime' ? 'freezetime' : ['round-end', 'exploded'].includes(scenario) ? 'over' : scenario === 'map-end' ? 'gameover' : 'live';
    state.round = 21; state.map = settings.match.map; state.warnings = ['Демонстрационные данные. Не являются состоянием CS2.'];
    state.capabilities = ['demo', 'allplayers', 'positions', 'directions', 'countdowns', 'bomb', 'equipment', 'timeouts', 'grenades'];
    state.teams.forEach((team, index) => {
      team.score = settings.match.scoreOverride?.[index] ?? (index === 0 ? 11 : 9);
      team.timeoutsLeft = settings.match.timeouts[index] ?? (index === 0 ? 2 : 3); team.lossBonus = settings.match.lossBonus[index] ?? (index === 0 ? 2400 : 2900);
      if (scenario === 'swap-sides') team.side = team.side === 'CT' ? 'T' : 'CT';
    });
    const demoTimer = (seconds: number, duration = seconds, running = true): Timer => timer(Math.max(0, seconds), duration, 'demo', now, this.playing && running);
    state.roundTimer = demoTimer(scenario === 'freezetime' ? 15 - elapsed : scenario === 'warmup' ? 45 - elapsed : 94 - elapsed, scenario === 'freezetime' ? 15 : 115);
    state.players = state.teams.flatMap((team, ti) => Array.from({ length: 5 }, (_, pi): Player => {
      const index = ti * 5 + pi, id = team.steamIds[pi] ?? `demo-${ti}-${pi}`, spectatorSlot = ti === 0 ? pi + 1 : (pi + 6) % 10;
      const dead = ['live', 'bomb', 'defuse', 'exploded', 'round-end'].includes(scenario) && (index === 0 || index === 9 || elapsed > 12 && index === 3);
      const primary = pi === 4 ? 'weapon_awp' : team.side === 'T' ? 'weapon_ak47' : 'weapon_m4a1_silencer';
      const inventory: Weapon[] = [{ name: primary, type: pi === 4 ? 'SniperRifle' : 'Rifle', state: 'active', ammoClip: Math.max(0, (pi === 4 ? 5 : team.side === 'CT' ? 20 : 30) - Math.floor(elapsed * 2 + pi) % (pi === 4 ? 6 : team.side === 'CT' ? 21 : 31)), ammoClipMax: pi === 4 ? 5 : team.side === 'CT' ? 20 : 30, ammoReserve: 90, count: 1 },
        { name: team.side === 'T' ? 'weapon_glock' : 'weapon_usp_silencer', type: 'Pistol', state: 'holstered', ammoClip: 20, ammoClipMax: 20, ammoReserve: 100, count: 1 },
        { name: 'weapon_smokegrenade', type: 'Grenade', state: 'holstered', ammoReserve: 1, count: 1 },
        { name: 'weapon_flashbang', type: 'Grenade', state: 'holstered', ammoReserve: pi % 2 ? 2 : 1, count: pi % 2 ? 2 : 1 },
        { name: team.side === 'T' ? 'weapon_molotov' : 'weapon_incgrenade', type: 'Grenade', state: 'holstered', ammoReserve: 1, count: 1 }];
      const hasBomb = team.side === 'T' && pi === 2 && !['bomb', 'defuse', 'exploded', 'round-end'].includes(scenario);
      if (hasBomb) inventory.push({ name: 'weapon_c4', type: 'C4', state: 'holstered', count: 1 });
      const upper = pi !== 3;
      return { steamId: id, name: team.roster?.[pi]?.name ?? names[ti][pi], teamId: team.id, side: team.side, slot: spectatorSlot,
        flashed: !dead && scenario === 'live' && [2,6].includes(index) ? Math.round(255 * Math.max(0, 1 - (elapsed % 8) / 2.5)) : 0, health: dead ? 0 : pi === 1 ? 78 : pi === 2 ? 56 : 100, armor: dead ? 0 : pi === 2 ? 14 : pi === 3 ? 0 : 100, helmet: pi !== 4, money: 350 + pi * 650 + ti * 200,
        alive: !dead, defuseKit: team.side === 'CT' && pi % 2 === 0, hasBomb, weapons: dead ? [] : inventory, inventoryKnown: true, kills: 10 + pi * 3 - ti, assists: 2 + pi % 4, deaths: 7 + pi, roundKills: scenario === 'freezetime' ? 0 : index === 6 ? 2 : index === 2 ? 1 : 0, roundDamage: dead ? 48 + pi * 19 : pi * 26, deathPosition: dead ? { x: -1750 + pi * 620, y: -650 + ti * 180, z: upper ? -350 : -700 } : null, equipmentValue: dead ? 0 : pi === 4 ? 6350 : 4700,
        position: { x: -1750 + pi * 620 + Math.sin(elapsed / 4 + index) * 70, y: -650 + ti * 180 + Math.cos(elapsed / 5 + index) * 160, z: upper ? -350 : -700 },
        forward: { x: Math.cos(elapsed / 4 + index), y: Math.sin(elapsed / 4 + index), z: 0 }, observed: index === 6 };
    }));
    if (scenario === 'overtime') { state.teams[0].score = 15; state.teams[1].score = 15; state.round = 31; }
    state.observedId = state.players[6].steamId;
    const bombPlayer = state.players.find(p => p.hasBomb);
    state.bomb = { ...state.bomb, state: 'carried', playerId: bombPlayer?.steamId ?? null, position: bombPlayer?.position ?? null };
    if (['bomb', 'defuse', 'exploded'].includes(scenario)) {
      state.bomb.state = scenario === 'bomb' ? 'planted' : scenario === 'defuse' ? 'defusing' : 'exploded';
      state.bomb.position = { x: -700, y: -300, z: -350 }; state.bomb.playerId = null;
      state.bomb.timer = demoTimer(scenario === 'defuse' ? 7 - elapsed : scenario === 'exploded' ? 0 : settings.bombDuration - elapsed, settings.bombDuration, scenario !== 'exploded');
      if (scenario === 'defuse') {
        const defuser = state.players.find(p => p.side === 'CT' && p.defuseKit && p.alive)!;
        state.bomb.playerId = defuser.steamId; state.bomb.defuserHasKit = true;
        state.bomb.defuseTimer = demoTimer(settings.defuseWithKit - elapsed, settings.defuseWithKit);
        if (elapsed >= settings.defuseWithKit) { state.bomb.state = 'defused'; state.bomb.timer.running = false; state.bomb.defuseTimer.running = false; state.winner = defuser.teamId; }
      }
    }
    if (scenario === 'tactical' || scenario === 'technical') {
      state.phase = 'paused'; state.roundTimer.running = false;
      state.pause = { active: true, kind: scenario, teamId: scenario === 'tactical' ? state.teams[0].id : null, timer: demoTimer(scenario === 'tactical' ? 60 - elapsed : 120 - elapsed, scenario === 'tactical' ? 60 : 120), source: 'demo' };
    }
    state.roundHistory = Array.from({ length: 20 }, (_, i) => { const ti = [1, 2, 4, 7, 8, 11, 14, 16, 18].includes(i) ? 1 : 0; const historySide: Side = i < 12 ? settings.teams[ti].side : settings.teams[ti].side === 'CT' ? 'T' : 'CT'; return { round: i + 1, teamId: state.teams[ti].id, side: historySide, method: i % 5 === 0 ? 'bomb' : 'elimination' }; });
    if (scenario === 'round-end' || scenario === 'exploded' || scenario === 'map-end') { state.winner = state.teams[0].id; state.roundTimer = demoTimer(0, 115, false); }
    if (scenario === 'map-end') { state.teams[0].score = 13; state.round = 23; }
    if (scenario === 'live') state.grenades = [
      { id: 'demo-smoke', type: 'smoke', position: { x: 200, y: -500, z: -350 }, velocity: { x: 0, y: 0, z: 0 }, effectTime: 3, lifetime: 5, flames: [] },
      { id: 'demo-flight', type: 'flashbang', position: { x: 350 + Math.sin(elapsed) * 200, y: 300, z: -350 }, velocity: { x: 100, y: 0, z: 0 }, effectTime: null, lifetime: 1, flames: [] },
      { id: 'demo-fire', type: 'inferno', position: { x: -300, y: -950, z: -350 }, velocity: null, effectTime: 2, lifetime: 4, flames: [-60, 0, 60].map(x => ({ x: -300 + x, y: -950, z: -350 })) },
    ];
    if (scenario === 'disconnected') {
      state.roundTimer.running = false; state.bomb.timer.running = false; state.phase = 'unknown'; state.warnings.push('Симуляция потери связи.');
    }
    this.state = state;
  }
}

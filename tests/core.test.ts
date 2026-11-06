import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState, defaultSettings, DemoEngine, economy, GsiNormalizer, parseVector, remaining, selectRadarLayer, timer, worldToRadar } from '../packages/core/index.js';
import type { RadarMap, Settings } from '../packages/shared/types.js';

const settings = (): Settings => structuredClone(defaultSettings);
function fixture(time = 100) {
  return { provider: { appid: 730, steamid: 'observer', timestamp: time }, map: { name: 'de_nuke', phase: 'live', round: 3, team_t: { score: 2 }, team_ct: { score: 1 } }, round: { phase: 'live' },
    player: { steamid: 'alice' }, phase_countdowns: { phase: 'live', phase_ends_in: '84.5' },
    allplayers: { alice: { name: 'Alice', team: 'T', observer_slot: 1, state: { health: 78, armor: 100, helmet: true, money: 3200, equip_value: 4500 }, weapons: { weapon_0: { name: 'weapon_ak47', type: 'Rifle', state: 'active', ammo_clip: 25 } }, match_stats: { kills: 4, assists: 1, deaths: 2 }, position: '0, 0, -400', forward: '1, 0, 0' },
      bob: { name: 'Bob', team: 'CT', observer_slot: 6, state: { health: 100, armor: 100, helmet: true, money: 1400, equip_value: 5000, defusekit: true }, weapons: { weapon_0: { name: 'weapon_m4a1', type: 'Rifle', state: 'active' } } } } };
}

test('empty live state has no fabricated players, bomb countdown or capabilities', () => {
  const state = createInitialState(settings(), 'live', 1000);
  assert.equal(state.connected, false); assert.equal(state.players.length, 0); assert.equal(state.bomb.timer.remaining, null); assert.deepEqual(state.capabilities, []);
});

test('C4 pickup reconciles stale dropped telemetry, survives partial packets and disappears from inventory on plant', () => {
  const n = new GsiNormalizer(), config = settings();
  const c4 = { weapon_0: { name: 'weapon_c4', type: 'C4', state: 'holstered' } };
  const player = (inventory: object) => ({ team: 'T', state: { health: 100 }, position: '0,0,-400', weapons: inventory });
  n.ingest({ map: { name: 'de_nuke', round: 1 }, bomb: { state: 'carried', player: 'alice' }, allplayers: { alice: player(c4), bob: player({}) } }, config, 1000);
  let s = n.ingest({ bomb: { state: 'dropped', position: '20,30,-400' }, allplayers: { alice: player({}), bob: player({}) } }, config, 1100).state;
  assert.equal(s.bomb.state, 'dropped'); assert.equal(s.bomb.playerId, null);
  assert.equal(s.players.some(p => p.hasBomb), false);
  s = n.ingest({ allplayers: { alice: player({}), bob: player(c4) } }, config, 1200).state;
  assert.equal(s.bomb.state, 'carried'); assert.equal(s.bomb.playerId, 'bob'); assert.equal(s.bomb.position, null);
  assert.deepEqual(s.players.filter(p => p.hasBomb).map(p => p.steamId), ['bob']);
  s = n.ingest({ bomb: { state: 'dropped', position: '100,30,-400' }, allplayers: { alice: player({}), bob: player(c4) } }, config, 1300).state;
  assert.equal(s.bomb.state, 'carried');
  s = n.ingest({ bomb: { position: '150,30,-400' } }, config, 1400).state;
  assert.equal(s.bomb.state, 'carried'); assert.equal(s.bomb.position, null);
  s = n.ingest({ bomb: { state: 'planted', position: '200,30,-400', countdown: '39' } }, config, 1500).state;
  assert.equal(s.bomb.state, 'planted'); assert.equal(s.players.some(p => p.hasBomb), false);
  s = n.ingest({ round: { bomb: 'exploded' } }, config, 1600).state;
  assert.equal(s.bomb.state, 'exploded');
  assert.equal(n.ingest({ round: { phase: 'over' } }, config, 1700).state.bomb.state, 'exploded');
});

test('cached inventory cannot override a fresh C4 drop without an inventory update', () => {
  const n = new GsiNormalizer(), config = settings();
  n.ingest({ allplayers: { alice: { team: 'T', state: { health: 100 }, weapons: { w: { name: 'weapon_c4' } } } }, bomb: { state: 'carried', player: 'alice' } }, config, 1000);
  const s = n.ingest({ bomb: { state: 'dropped', position: '30,40,-400' } }, config, 1100).state;
  assert.equal(s.bomb.state, 'dropped'); assert.equal(s.players[0].hasBomb, false);
});
test('partial snapshots retain scalars and only replace explicitly present collections', () => {
  const normalizer = new GsiNormalizer(), config = settings();
  normalizer.ingest(fixture(), config, 1000);
  const result = normalizer.ingest({ provider: { timestamp: 101 }, allplayers: { alice: { state: { health: 56 }, weapons: {} } } }, config, 1200);
  assert.equal(result.accepted, true); assert.equal(result.state.players.length, 1);
  const alice = result.state.players[0];
  assert.equal(alice.name, 'Alice'); assert.equal(alice.health, 56); assert.equal(alice.money, 3200); assert.equal(alice.weapons.length, 0); assert.equal(alice.kills, 4);
  assert.equal(remaining(result.state.roundTimer, 1500), 84);
});
test('missing values remain unknown, malformed position never becomes origin', () => {
  const normalizer = new GsiNormalizer();
  const result = normalizer.ingest({ allplayers: { a: { team: 'T', name: 'No data', position: ',,', state: {} } } }, settings(), 1000);
  assert.equal(result.state.players[0].health, null); assert.equal(result.state.players[0].money, null); assert.equal(result.state.players[0].position, null);
  assert.equal(parseVector('NaN, 2, 3'), null); assert.equal(parseVector('1,2'), null); assert.deepEqual(parseVector('0,0,0'), { x: 0, y: 0, z: 0 });
});
test('null, removed and previously removal clear explicit stale values', () => {
  const normalizer = new GsiNormalizer(), config = settings(); normalizer.ingest(fixture(), config, 1000);
  let result = normalizer.ingest({ allplayers: { alice: { state: { armor: null } } }, removed: ['allplayers.alice.position'] }, config, 1200);
  assert.equal(result.state.players[0].armor, null); assert.equal(result.state.players[0].position, null);
  result = normalizer.ingest({ allplayers: { alice: { state: { health: 50 } } }, previously: { allplayers: { alice: { state: { money: 3200 } } } } }, config, 1400);
  assert.equal(result.state.players[0].money, null); assert.equal(result.state.players[0].health, 50);
});
test('rejects old packets but accepts multiple updates within same source second', () => {
  const normalizer = new GsiNormalizer(), config = settings(); normalizer.ingest(fixture(100), config, 1000);
  assert.equal(normalizer.ingest(fixture(99), config, 2000).accepted, false);
  assert.equal(normalizer.ingest({ provider: { timestamp: 100 }, round: { phase: 'over' } }, config, 2100).accepted, true);
  assert.equal(normalizer.ingest({ provider: { appid: 570 } }, config, 2200).accepted, false);
});
test('map/round/match transitions clear stale bomb, inventory and economy', () => {
  const normalizer = new GsiNormalizer(), config = settings(); normalizer.ingest(fixture(), config, 1000);
  normalizer.ingest({ bomb: { state: 'planted', countdown: '30' } }, config, 1200);
  let result = normalizer.ingest({ map: { round: 4 }, round: { phase: 'freezetime' } }, config, 1400);
  assert.equal(result.state.round, 5); assert.equal(result.state.bomb.state, 'unknown'); assert.equal(result.state.bomb.timer.remaining, null);
  assert.equal(result.state.players[0].equipmentValue, null); assert.equal(result.state.players[0].money, null); assert.equal(result.state.players[0].weapons.length, 0);
  result = normalizer.ingest({ map: { name: 'de_mirage', round: 0 } }, config, 1600);
  assert.equal(result.state.players.length, 0); assert.equal(result.state.roundTimer.remaining, null); assert.deepEqual(result.state.roundHistory, []);
  config.match.id = 'different-match'; result = normalizer.ingest({ map: { round: 0 } }, config, 1800); assert.equal(result.state.teams[0].score, null);
});
test('stable teams and score follow their players after switching sides', () => {
  const normalizer = new GsiNormalizer(), config = settings(); normalizer.ingest(fixture(), config, 1000);
  const result = normalizer.ingest({ allplayers: { alice: { team: 'CT' }, bob: { team: 'T' } }, map: { team_t: { score: 5 }, team_ct: { score: 8 } } }, config, 1200);
  assert.equal(result.state.players.find(p => p.steamId === 'alice')?.teamId, 'navi');
  assert.equal(result.state.teams[0].side, 'CT'); assert.equal(result.state.teams[0].score, 8); assert.equal(result.state.teams[1].score, 5);
  config.match.scoreOverride = [9, 10]; assert.equal(normalizer.ingest({ provider: { timestamp: 101 } }, config, 1300).state.teams[0].score, 9);
});
test('bomb and defuse countdowns remain independent; cancel clears defuse', () => {
  const normalizer = new GsiNormalizer(), config = settings(); normalizer.ingest(fixture(), config, 1000);
  normalizer.ingest({ bomb: { state: 'planted', countdown: '30' }, phase_countdowns: { phase: 'bomb', phase_ends_in: '30' } }, config, 2000);
  let result = normalizer.ingest({ bomb: { state: 'defusing', countdown: '4.5', player: 'bob' }, phase_countdowns: { phase: 'defuse', phase_ends_in: '4.5' } }, config, 4000);
  assert.equal(remaining(result.state.bomb.timer, 4000), 28); assert.equal(remaining(result.state.bomb.defuseTimer, 4000), 4.5); assert.equal(result.state.bomb.defuserHasKit, true);
  result = normalizer.ingest({ bomb: { state: 'planted', countdown: '26' }, phase_countdowns: { phase: 'bomb', phase_ends_in: '26' } }, config, 6000);
  assert.equal(result.state.bomb.defuseTimer.remaining, null); assert.equal(result.state.bomb.timer.remaining, 26);
});
test('joining mid-defuse does not manufacture bomb deadline or assume 40 seconds', () => {
  const normalizer = new GsiNormalizer();
  const result = normalizer.ingest({ bomb: { state: 'defusing', countdown: '3' }, phase_countdowns: { phase: 'defuse', phase_ends_in: '3' } }, settings(), 1000);
  assert.equal(result.state.bomb.timer.remaining, null); assert.equal(result.state.bomb.defuseTimer.remaining, 3);
  const second = new GsiNormalizer().ingest({ bomb: { state: 'planted' } }, settings(), 1000); assert.equal(second.state.bomb.timer.remaining, null);
});
test('pause information is source-labelled and no unknown team is guessed', () => {
  const normalizer = new GsiNormalizer(), config = settings();
  let result = normalizer.ingest({ phase_countdowns: { phase: 'paused' } }, config, 1000);
  assert.equal(result.state.pause.active, true); assert.equal(result.state.pause.teamId, null); assert.equal(result.state.pause.timer.remaining, null);
  result = normalizer.ingest({ phase_countdowns: { phase: 'timeout_t', phase_ends_in: '42' } }, config, 1200);
  assert.equal(result.state.pause.kind, 'tactical'); assert.equal(result.state.pause.teamId, config.teams[0].id); assert.equal(result.state.pause.source, 'gsi');
});
test('untrusted packet prototype keys cannot pollute objects or public snapshots', () => {
  const normalizer = new GsiNormalizer();
  const input = JSON.parse('{"auth":{"token":"secret"},"map":{"name":"de_nuke","__proto__":{"polluted":true}},"constructor":{"prototype":{"polluted":true}}}');
  const result = normalizer.ingest(input, settings(), 1000);
  assert.equal(({} as Record<string, unknown>).polluted, undefined); assert.equal(JSON.stringify(result).includes('secret'), false);
});
test('returned state is detached from mutable normalizer storage', () => {
  const normalizer = new GsiNormalizer(), config = settings(), first = normalizer.ingest(fixture(), config, 1000);
  first.state.teams[0].score = 999; first.state.players[0].money = 0;
  const second = normalizer.ingest({ provider: { timestamp: 101 } }, config, 1200);
  assert.equal(second.state.teams[0].score, 2); assert.equal(second.state.players[0].money, 3200);
});
test('economy totals stay separate and incomplete team data is not a full sum', () => {
  const engine = new DemoEngine(settings(), 1000); engine.control('play', { scenario: 'freezetime' }, 1000);
  const players = engine.state.players.filter(p => p.teamId === 'navi'); const value = economy(players);
  assert.equal(value.complete, true); assert.equal(value.money, players.reduce((sum, p) => sum + p.money!, 0)); assert.notEqual(value.money, value.equipmentValue);
  assert.equal(economy(players.slice(0, 4)).money, null); players[0].equipmentValue = null; assert.equal(economy(players).equipmentValue, null);
});
test('radar transform and Nuke XY region override distinguish vertical layers', () => {
  const map: RadarMap = { id: 'test', name: 'test', originX: -100, originY: 100, scale: 2, rotation: 0, size: 100, calibrated: false,
    layers: [{ id: 'upper', name: 'upper', image: '', minZ: 0, maxZ: 100 }, { id: 'lower', name: 'lower', image: '', minZ: -100, maxZ: 0 }],
    regions: [{ name: 'ramp override', polygon: [[0, 0], [10, 0], [10, 10], [0, 10]], minZ: -20, maxZ: 20, layer: 'lower' }], sites: [] };
  assert.deepEqual(worldToRadar({ x: 0, y: 0, z: 0 }, map), { x: 50, y: 50 });
  assert.equal(selectRadarLayer({ x: 5, y: 5, z: 10 }, map), 'lower'); assert.equal(selectRadarLayer({ x: 30, y: 30, z: 10 }, map), 'upper');
  assert.equal(selectRadarLayer({ x: 30, y: 30, z: 200 }, map), 'unknown');
  const rotated = worldToRadar({ x: 20, y: 0, z: 0 }, { ...map, rotation: 90 }); assert.equal(Math.round(rotated.x), 50); assert.equal(Math.round(rotated.y), 60);
});
test('timers clamp at zero and do not advance when paused or time goes backwards', () => {
  assert.equal(remaining(timer(5, 5, 'gsi', 1000), 2000), 4); assert.equal(remaining(timer(5, 5, 'gsi', 1000), 9000), 0);
  assert.equal(remaining(timer(5, 5, 'manual', 1000, false), 9000), 5); assert.equal(remaining(timer(5, 5, 'gsi', 1000), 0), 5);
  assert.equal(remaining(timer(), 1000), null);
});
test('demo scenario controls remain separate and pause freezes simulation', () => {
  const engine = new DemoEngine(settings(), 1000); engine.control('play', { scenario: 'bomb' }, 1000);
  assert.equal(engine.state.mode, 'demo'); assert.equal(engine.state.bomb.timer.source, 'demo');
  engine.tick(3000); assert.equal(engine.state.bomb.timer.remaining, 38);
  engine.control('pause', {}, 3000); engine.tick(9000); assert.equal(engine.state.bomb.timer.remaining, 38); assert.equal(engine.state.bomb.timer.running, false);
  engine.control('play', { scenario: 'disconnected' }, 9000); assert.equal(engine.state.connected, false);
  assert.equal(new GsiNormalizer().ingest({ provider: { timestamp: 1 } }, settings(), 1000).state.players.length, 0);
});

test('configured bomb estimate requires an observed transition and remains visibly estimated', () => {
  const config = settings(); config.bombDuration = 45;
  const normalizer = new GsiNormalizer();
  normalizer.ingest({ ...fixture(), bomb: { state: 'carried', player: 'alice' } }, config, 1000);
  const planted = normalizer.ingest({ bomb: { state: 'planted' } }, config, 2000).state;
  assert.equal(planted.bomb.timer.source, 'estimate'); assert.equal(planted.bomb.timer.remaining, 45);
  const confirmed = normalizer.ingest({ bomb: { state: 'planted', countdown: '40' } }, config, 3000).state;
  assert.equal(confirmed.bomb.timer.source, 'gsi'); assert.equal(confirmed.bomb.timer.remaining, 40);
  const joined = new GsiNormalizer().ingest({ ...fixture(), bomb: { state: 'planted' } }, config, 2000).state;
  assert.equal(joined.bomb.timer.remaining, null);
});

test('end of round and gameover override stale countdown phases and stop timers', () => {
  const config = settings(), normalizer = new GsiNormalizer();
  normalizer.ingest({ ...fixture(), phase_countdowns: { phase: 'bomb', phase_ends_in: '20' }, bomb: { state: 'planted', countdown: '20' } }, config, 1000);
  const ended = normalizer.ingest({ round: { phase: 'over', win_team: 'T' } }, config, 2000).state;
  assert.equal(ended.phase, 'over'); assert.equal(ended.bomb.timer.running, false);
  const gameover = normalizer.ingest({ map: { phase: 'gameover' } }, config, 3000).state;
  assert.equal(gameover.phase, 'gameover'); assert.equal(gameover.roundTimer.running, false);
});

test('unknown live scores and statistics are not fabricated zero values', () => {
  const state = new GsiNormalizer().ingest({ allplayers: { unknown: { name: 'Unknown', team: 'CT' } } }, settings(), 1000).state;
  assert.equal(state.teams[0].score, null); assert.equal(state.players[0].kills, null);
});

test('demo resume keeps elapsed time, next advances, and overtime uses an overtime score', () => {
  const engine = new DemoEngine(settings(), 1000);
  engine.control('play', { scenario: 'live' }, 2000);
  const before = engine.control('pause', {}, 5000);
  const resumed = engine.control('play', { scenario: 'live' }, 9000);
  assert.equal(before.roundTimer.remaining, resumed.roundTimer.remaining);
  const next = engine.control('next', {}, 9000); assert.equal(next.phase, 'warmup');
  const ot = engine.control('play', { scenario: 'overtime' }, 10000);
  assert.equal(ot.round, 31); assert.equal(ot.teams[0].score, 15);
});

 test('joining timeout recovers all five reported wins', () => {
 const normalizer = new GsiNormalizer();
 const input = fixture();
 input.map.round = 5;
 Object.assign(input.map, {round_wins: Object.fromEntries([1,2,3,4,5].map(n => [n, 'ct_win_elimination']))});
 input.round.phase = 'freezetime'; input.phase_countdowns.phase = 'timeout_t';
 const result = normalizer.ingest(input, settings(), 1000).state;
 assert.deepEqual(result.roundHistory.map(r => r.round), [1,2,3,4,5]);
 assert.ok(result.roundHistory.every(r => r.teamId === result.teams.find(t => t.side === 'CT')!.id));
 });

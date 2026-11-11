import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSettings, GsiNormalizer } from '../packages/core/index.js';
import { bindCurrentPlayers } from '../packages/core/team-assignment.js';
import { settingsSchema } from '../apps/backend/src/validation.js';

const id = (n: number) => `7656119800000000${n}`;
const roster = (swapped = false) => Object.fromEntries(Array.from({ length: 10 }, (_, n) => [id(n), {
  name: `Player ${n}`, team: (n < 5) !== swapped ? 'T' : 'CT', state: { health: n === 0 ? 0 : 100 },
}]));
const packet = (swapped = false, map = 'de_nuke', round = 3) => ({ map: {
  name: map, round, team_t: { score: 2, consecutive_round_losses: 0 }, team_ct: { score: 1, consecutive_round_losses: 4 },
}, allplayers: roster(swapped), phase_countdowns: { phase: 'freezetime', phase_ends_in: '10' } });

test('one roster anchor overrides cached assignment for the entire side, including four substitutes', () => {
  const settings = structuredClone(defaultSettings), n = new GsiNormalizer();
  n.ingest(packet(), settings, 1000);
  settings.teams[0].steamIds = [id(7)];
  const state = n.reconfigure(settings)!;
  assert.deepEqual(state.teams.map(t => t.side), ['CT', 'T']);
  assert.equal(state.players.filter(p => p.teamId === settings.teams[0].id).length, 5);
  assert.ok(state.players.every(p => p.teamId === state.teams.find(t => t.side === p.side)!.id));
  assert.deepEqual(state.teams.map(t => t.score), [1, 2]);
  assert.deepEqual(state.teams.map(t => t.lossBonus), [3400, 1400]);
  assert.equal(state.receivedAt, 1000);
});

test('binding includes dead players and survives knife reset, halftime, next map and normalizer restart', () => {
  const settings = structuredClone(defaultSettings), n = new GsiNormalizer();
  const initial = n.ingest(packet(), settings, 1000).state;
  const bound = bindCurrentPlayers(settings, { ...initial, broadcastAt: 1000 });
  assert.equal(bound.teams[0].steamIds.length, 5);
  assert.ok(bound.teams[0].steamIds.includes(id(0)));
  assert.equal(settings.teams[0].steamIds.length, 0);
  for (const [swapped, map, round] of [[true, 'de_nuke', 0], [false, 'de_nuke', 12], [true, 'de_mirage', 0]] as const) {
    const s = n.ingest(packet(swapped, map, round), bound, 2000).state;
    assert.equal(s.players.find(p => p.steamId === id(0))!.teamId, bound.teams[0].id);
    assert.equal(s.teams[0].side, swapped ? 'CT' : 'T');
  }
  const restarted = new GsiNormalizer().ingest(packet(true, 'de_mirage'), bound).state;
  assert.equal(restarted.teams[0].side, 'CT');
});

test('manual mapping ignores roster and per-map seeds; automation can be restored immediately', () => {
  const settings = structuredClone(defaultSettings), n = new GsiNormalizer();
  settings.teams[0].steamIds = [id(6)];
  settings.match.mapDetails.de_nuke = { startingCTTeamId: settings.teams[0].id, pickTeamId: null, decider: false, scores: {} };
  n.ingest(packet(), settings, 1000);
  settings.match.autoSides = false;
  let s = n.reconfigure(settings)!;
  assert.equal(s.teams[0].side, 'T');
  assert.equal(s.players.find(p => p.steamId === id(6))!.teamId, settings.teams[1].id);
  s = n.ingest(packet(true), settings, 1100).state;
  assert.equal(s.teams[0].side, 'T');
  settings.match.autoSides = true;
  s = n.ingest(packet(), settings, 1200).state;
  assert.equal(s.teams[0].side, 'CT');
});

test('conflicting saved rosters warn without splitting a server side into different teams', () => {
  const settings = structuredClone(defaultSettings);
  settings.teams[0].steamIds = [id(0), id(6)];
  const state = new GsiNormalizer().ingest(packet(), settings).state;
  assert.ok(state.warnings.some(w => w.includes('Составы SteamID')));
  assert.deepEqual(state.teams.map(t => t.side), ['T', 'CT']);
  assert.ok(state.players.every(p => p.teamId === state.teams.find(t => t.side === p.side)!.id));
});

test('operator correction remaps existing history while natural halftime preserves team identity', () => {
  const settings = structuredClone(defaultSettings), n = new GsiNormalizer();
  n.ingest({ ...packet(), map: { ...packet().map, round_wins: { '1': 't_win_elimination' } } }, settings, 1000);
  settings.match.autoSides = false;
  settings.teams[0].side = 'CT'; settings.teams[1].side = 'T';
  const corrected = n.reconfigure(settings)!;
  assert.equal(corrected.roundHistory[0].teamId, settings.teams[1].id);
  const bound = bindCurrentPlayers(settings, { ...corrected, broadcastAt: 1000 });
  const half = n.ingest(packet(true, 'de_nuke', 12), bound, 2000).state;
  assert.equal(half.roundHistory[0].teamId, settings.teams[1].id);
  assert.equal(half.players.find(p => p.steamId === id(0))!.teamId, settings.teams[1].id);
});

test('loss bonus uses GSI counter, caps at 3400, respects manual zero and clears with absent data', () => {
  const settings = structuredClone(defaultSettings), n = new GsiNormalizer();
  for (const losses of [0, 1, 2, 3, 4, 9]) {
    const p = packet(); p.map.team_t.consecutive_round_losses = losses;
    assert.equal(n.ingest(p, settings).state.teams[0].lossBonus, 1400 + Math.min(4, losses) * 500);
  }
  settings.match.lossBonus[0] = 0;
  assert.equal(n.reconfigure(settings)!.teams[0].lossBonus, 0);
  settings.match.lossBonus[0] = null;
  assert.equal(n.reconfigure(settings)!.teams[0].lossBonus, 3400);
  assert.equal(n.ingest({ map: { team_t: { consecutive_round_losses: null } } }, settings).state.teams[0].lossBonus, null);
  assert.equal(n.ingest({ map: { name: 'de_anubis' } }, settings).state.teams[1].lossBonus, null);
});

test('old saved settings gain auto mode without losing teams or BO2; invalid binding is rejected', () => {
  const old = structuredClone(defaultSettings) as any;
  delete old.match.autoSides; old.match.bestOf = 2; old.teams[0].name = 'Saved team';
  const settings = settingsSchema.parse(old);
  assert.equal(settings.match.autoSides, true); assert.equal(settings.match.bestOf, 2); assert.equal(settings.teams[0].name, 'Saved team');
  const state = new GsiNormalizer().ingest(packet(), settings).state;
  assert.throws(() => bindCurrentPlayers(settings, { ...state, mode: 'demo' }));
  assert.throws(() => bindCurrentPlayers(settings, { ...state, connected: false }));
  assert.throws(() => bindCurrentPlayers(settings, { ...state, broadcastAt: state.receivedAt + settings.staleAfterMs + 1 }));
  assert.throws(() => bindCurrentPlayers(settings, { ...state, players: state.players.filter(p => p.side === 'T') }));
});

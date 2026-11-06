import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import { builtInRadarMaps, defaultSettings, DemoEngine, GsiNormalizer, observerKey, presentationState, selectRadarLayer, timer, upgradeRadarMaps, worldToRadar } from '../packages/core/index.js';
import { settingsSchema } from '../apps/backend/src/validation.js';
import { Overlay } from '../apps/web/src/overlay/Overlay.js';
import type { GameState } from '../packages/shared/types.js';

const settings = () => structuredClone(defaultSettings);
const demo = (scenario = 'live') => new DemoEngine(settings(), 1000).control('pause', { scenario }, 1000);
const render = (state: GameState, variant: 'game' | 'pause' | 'production' = 'game') => renderToStaticMarkup(createElement(Overlay, { state, settings: settings(), variant }));
const score = (html: string) => html.match(/<header class="ov-scoreboard[\s\S]*?<\/header>/)![0];

test('observer keys match 1–9,0 in normalized players, roster and radar', () => {
  const allplayers = Object.fromEntries(Array.from({ length: 10 }, (_, i) => [String(i), {
    team: i < 5 ? 'T' : 'CT', observer_slot: i, state: { health: 100 }, position: '0,0,-400',
  }]));
  const state = new GsiNormalizer().ingest({ map: { name: 'de_nuke' }, allplayers }, settings(), 1000).state;
  assert.deepEqual(state.players.map(p => p.slot), [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
  const html = render(state);
  assert.deepEqual([...html.matchAll(/class="ov-observer-slot">(\d)<\/span>/g)].map(m => Number(m[1])), [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
  assert.deepEqual([...html.matchAll(/<text[^>]*>(\d)<\/text>/g)].map(m => Number(m[1])), [1, 2, 3, 4, 5, 6, 7, 8, 9, 0]);
  for (const value of [undefined, null, '', -1, 10, 2.5, 'invalid']) assert.equal(observerKey(value), null);
  assert.equal(observerKey('0'), 1);
});

test('round kills survive partial packets and death, but clear for the next round and map', () => {
  const normalizer = new GsiNormalizer(), config = settings();
  normalizer.ingest({ map: { name: 'de_nuke', round: 3 }, allplayers: { a: { team: 'T', state: { health: 100, round_kills: 2 } } } }, config, 1000);
  let state = normalizer.ingest({ allplayers: { a: { state: { health: 0 } } } }, config, 1100).state;
  assert.equal(state.players[0].roundKills, 2);
  assert.match(render(state), /Убийств за раунд: 2/);
  state = normalizer.ingest({ map: { round: 4 } }, config, 1200).state;
  assert.equal(state.players[0].roundKills, null);
  assert.doesNotMatch(render(state), /class="ov-round-kills"/);
  state = normalizer.ingest({ allplayers: { a: { state: { health: 100, round_kills: 0 } } } }, config, 1300).state;
  assert.equal(state.players[0].roundKills, 0);
  assert.equal(normalizer.ingest({ map: { name: 'de_mirage' } }, config, 1400).state.players.length, 0);
  const single = new GsiNormalizer();
  single.ingest({ map: { round: 0 }, player: { steamid: 'a', team: 'T', state: { round_kills: 4 } } }, config, 1000);
  assert.equal(single.ingest({ map: { round: 1 } }, config, 1100).state.players[0].roundKills, null);
});

test('scoreboard only has a bomb bar while planted/defusing, never bomb seconds', () => {
  for (const scenario of ['live', 'freezetime', 'warmup', 'round-end', 'exploded', 'map-end']) assert.doesNotMatch(score(render(demo(scenario))), /ov-timer-track/);
  for (const scenario of ['bomb', 'defuse']) {
    const html = score(render(demo(scenario)));
    assert.match(html, /role="progressbar"/); assert.match(html, /Бомба установлена/); assert.doesNotMatch(html, />БОМБА</);
    assert.doesNotMatch(html, /\d:\d\d/); assert.doesNotMatch(html, /ТЕРРОРИСТ|СПЕЦНАЗ|>CT<|>T</);
    assert.doesNotMatch(score(render(demo(scenario), 'pause')), /ov-timer-track/);
  }
  const unknown = demo('bomb'); unknown.bomb.timer = timer();
  assert.match(score(render(unknown)), /Бомба: время неизвестно/);
  const partial = new GsiNormalizer().ingest({ map: { name: 'de_nuke' }, bomb: { state: 'planted', countdown: '30' } }, settings(), 1000).state;
  assert.equal(partial.bomb.timer.duration, 40);
  partial.bomb.timer.running = false;
  assert.match(score(render(partial)), /aria-valuenow="75"/);
});

test('armor uses icons and only warns numerically below twenty; freeze time shows economy', () => {
  const state = demo(); state.players = [state.players[1]]; state.observedId = state.players[0].steamId;
  state.players[0].armor = 100;
  assert.match(render(state), /title="Кевлар и шлем"/); assert.doesNotMatch(render(state), /ov-armor-low/);
  state.players[0].armor = 19; state.players[0].helmet = false;
  assert.match(render(state), /ov-armor-low" title="Кевлар"[\s\S]*?<small>19<\/small>/);
  state.players[0].armor = 20; assert.doesNotMatch(render(state), /ov-armor-low/);
  state.players[0].armor = 0; assert.doesNotMatch(render(state), /class="ov-armor(?: |")/);
  assert.doesNotMatch(render(demo()), /ov-economy-visible/);
  assert.equal((render(demo('freezetime')).match(/ov-economy-visible/g) || []).length, 2);
  assert.match(render(demo('freezetime')), /СНАРЯЖЕНИЕ/);
  assert.match(render(demo('freezetime')), /ov-observed-card/);
  assert.equal((render(demo('tactical'), 'production').match(/ov-economy ov-economy/g) || []).length, 2);
});

test('teams swap display edges with their scores, rosters and timeouts, leaving raw identity intact', () => {
  const state = demo('swap-sides'), before = structuredClone(state), config = settings();
  const displayed = presentationState(state, config);
  assert.deepEqual(displayed.teams.map(t => t.side), ['T', 'CT']);
  assert.deepEqual(displayed.teams.map(t => t.color), [config.hud.sideColors.T, config.hud.sideColors.CT]);
  for (const team of displayed.teams) {
    const original = state.teams.find(t => t.id === team.id)!;
    for (const key of ['score', 'seriesScore', 'timeoutsLeft', 'lossBonus'] as const) assert.equal(team[key], original[key]);
  }
  assert.equal(displayed.teams[0].id, state.teams[1].id);
  assert.deepEqual(state, before);
});

test('ready maps upgrade the empty legacy Nuke without erasing custom settings or calibrations', () => {
  const config = settings();
  const legacy = JSON.parse(JSON.stringify(config)); delete legacy.hud.sideColors;
  legacy.teams[0].name = 'Saved team'; legacy.hud.radarSize = 500;
  const parsed = settingsSchema.parse(legacy);
  assert.equal(parsed.teams[0].name, 'Saved team'); assert.equal(parsed.hud.radarSize, 500);
  assert.deepEqual(parsed.hud.sideColors, defaultSettings.hud.sideColors);
  const scaffold = structuredClone(builtInRadarMaps[0]); scaffold.calibrated = false; scaffold.layers.forEach(l => { l.image = ''; });
  const upgraded = upgradeRadarMaps([scaffold]);
  assert.equal(upgraded.length, 10); assert.deepEqual(upgraded[0], builtInRadarMaps[0]);
  assert.deepEqual(upgradeRadarMaps(upgraded), upgraded);
  const custom = structuredClone(scaffold); custom.originX = -3400; custom.layers[0].image = '/uploads/my-map.png';
  assert.deepEqual(upgradeRadarMaps([custom])[0], custom);
  assert.equal(scaffold.calibrated, false);
});

test('packaged maps match pinned hashes, image canvas and Nuke overview coordinates', async () => {
  const manifest = JSON.parse(readFileSync('assets/maps/sources.json', 'utf8'));
  for (const file of manifest.files) {
    const bytes = readFileSync(`assets/maps/${file.file}`);
    assert.equal(createHash('sha256').update(bytes).digest('hex'), file.sha256, file.file);
  }
  for (const map of builtInRadarMaps) for (const layer of map.layers) {
    const meta = await sharp(`.${layer.image}`).metadata();
    assert.equal(meta.width, map.size); assert.equal(meta.height, map.size);
  }
  const nuke = builtInRadarMaps.find(m => m.id === 'de_nuke')!;
  assert.deepEqual(worldToRadar({ x: -3453, y: 2887, z: 0 }, nuke), { x: 0, y: 0 });
  assert.deepEqual(worldToRadar({ x: 131, y: -697, z: 0 }, nuke), { x: 512, y: 512 });
  assert.equal(selectRadarLayer({ x: 0, y: 0, z: -495 }, nuke), 'upper');
  assert.equal(selectRadarLayer({ x: 0, y: 0, z: -496 }, nuke), 'lower');
});

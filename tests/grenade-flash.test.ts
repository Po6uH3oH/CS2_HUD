import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultSettings, GsiNormalizer } from '../packages/core/index.js';
import { grenadePhase, grenadeBursts, bombPulsePeriod } from '../packages/core/grenade-presentation.js';
import { Overlay } from '../apps/web/src/overlay/Overlay.js';

test('flash and HE detonation events fire once for disappearance, effects and expired remnants', () => {
  const g = { id: 'flash', type: 'flashbang', position: { x: 0, y: 0, z: -400 }, velocity: null, effectTime: null, lifetime: 1, flames: [] };
  const burst = { ...g, effectTime: .1 }, expired = { ...g, effectTime: 1 };
  assert.equal(grenadeBursts([g], []).length, 1);
  assert.equal(grenadeBursts([g], [burst]).length, 1);
  assert.equal(grenadeBursts([burst], [burst]).length, 0);
  assert.equal(grenadeBursts([burst], []).length, 0);
  assert.equal(grenadeBursts([g], [expired]).length, 1);
  assert.equal(grenadeBursts([expired], []).length, 0);
  assert.equal(grenadeBursts([{ ...g, type: 'smoke' }], []).length, 0);
  assert.ok(bombPulsePeriod(4) < bombPulsePeriod(9));
  assert.ok(bombPulsePeriod(9) < bombPulsePeriod(19));
  assert.ok(bombPulsePeriod(19) < bombPulsePeriod(30));
});

test('smoke zero effecttime is flight; positive time deploys and reused IDs lose old effects', () => {
  const n = new GsiNormalizer();
  let state = n.ingest({ grenades: { g: { type: 'smoke', position: '0,0,0', effecttime: '0.000', lifetime: '1.0', velocity: '200,0,0' } } }, defaultSettings, 1000).state;
  assert.equal(grenadePhase(state.grenades[0]), 'flight');
  state = n.ingest({ grenades: { g: { effecttime: '0.1', lifetime: '2.0', velocity: '0,0,0' } } }, defaultSettings, 1100).state;
  assert.equal(grenadePhase(state.grenades[0]), 'smoke');
  state = n.ingest({ grenades: { g: { type: 'smoke', position: '20,0,0', lifetime: '0.1' } } }, defaultSettings, 1200).state;
  assert.equal(state.grenades[0].effectTime, null);
  assert.equal(grenadePhase(state.grenades[0]), 'flight');
  assert.equal(n.ingest({ grenades: {} }, defaultSettings, 1300).state.grenades.length, 0);
});

test('old stationary HE remnants disappear without turning a bounce into an explosion', () => {
  const n = new GsiNormalizer();
  const base = { type: 'frag', position: '0,0,0', velocity: '0,0,0', effecttime: '0', lifetime: '.8' };
  let g = n.ingest({ grenades: { g: base } }, defaultSettings, 1000).state.grenades[0];
  assert.equal(grenadePhase(g), 'flight');
  g = n.ingest({ grenades: { g: { lifetime: '5.9' } } }, defaultSettings, 1100).state.grenades[0];
  assert.equal(grenadePhase(g), 'expired');
  assert.equal(grenadePhase({ ...g, effectTime: .1 }), 'burst');
  assert.equal(grenadePhase({ ...g, effectTime: .5 }), 'expired');
  assert.equal(grenadePhase({ ...g, lifetime: .9, velocity: { x: 100, y: 0, z: 0 } }), 'flight');
});

test('flash strength survives partial packets, clears explicitly and resets between rounds', () => {
  const n = new GsiNormalizer();
  let state = n.ingest({ map: { name: 'de_nuke', round: 0 }, allplayers: { a: { name: 'Flash test', team: 'T', position: '0,0,-400', state: { health: 80, flashed: 128 } } } }, defaultSettings, 1000).state;
  assert.equal(state.players[0].flashed, 128);
  const html = renderToStaticMarkup(createElement(Overlay, { state, settings: defaultSettings, variant: 'game' }));
  assert.match(html, /ov-flash-fill/); assert.match(html, /ov-player-flash/);
  assert.match(html, /opacity="0.5019607843137255"/);
  assert.equal(n.ingest({ allplayers: { a: { state: { health: 70 } } } }, defaultSettings, 1100).state.players[0].flashed, 128);
  assert.equal(n.ingest({ allplayers: { a: { state: { flashed: 0 } } } }, defaultSettings, 1200).state.players[0].flashed, 0);
  assert.equal(n.ingest({ map: { round: 1 } }, defaultSettings, 1300).state.players[0].flashed, null);
});

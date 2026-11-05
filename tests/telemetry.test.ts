import test from 'node:test';
import assert from 'node:assert/strict';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { defaultSettings, DemoEngine, GsiNormalizer } from '../packages/core/index.js';
import { Overlay } from '../apps/web/src/overlay/Overlay.js';
import { WeaponIcon } from '../apps/web/src/overlay/icons.js';

const config = () => structuredClone(defaultSettings);
test('ammo maximum, round damage and a death position follow GSI and clear at the next round', () => {
  const n = new GsiNormalizer(), s = config();
  n.ingest({ map: { name: 'de_nuke', round: 0 }, allplayers: { a: { team: 'T', position: '100,200,-400', state: { health: 100, round_totaldmg: 36 }, weapons: { gun: { name: 'weapon_ak47', ammo_clip: 12, ammo_clip_max: 30 } } } } }, s, 1000);
  const dead = n.ingest({ allplayers: { a: { state: { health: 0, round_totaldmg: 83 } } } }, s, 1100).state.players[0];
  assert.equal(dead.roundDamage, 83); assert.equal(dead.weapons[0].ammoClipMax, 30);
  assert.deepEqual(dead.deathPosition, { x: 100, y: 200, z: -400 });
  const moved = n.ingest({ allplayers: { a: { position: '0,0,0' } } }, s, 1200).state.players[0];
  assert.deepEqual(moved.deathPosition, dead.deathPosition);
  const next = n.ingest({ map: { round: 1 } }, s, 1300).state.players[0];
  assert.equal(next.deathPosition, null); assert.equal(next.roundDamage, null);
});

test('grenades preserve metadata in partial updates and distinguish flight, smoke and inferno flames', () => {
  const n = new GsiNormalizer(), s = config();
  let state = n.ingest({ map: { name: 'de_nuke' }, grenades: { g: { type: 'smoke', position: '100,200,-400', velocity: '10,0,0', lifetime: '0.5' } } }, s, 1000).state;
  assert.equal(state.grenades[0].effectTime, null);
  let html = renderToStaticMarkup(createElement(Overlay, { state, settings: s, variant: 'game' }));
  assert.doesNotMatch(html, /ov-smoke-area/); assert.match(html, /ov-radar-glyph/);
  state = n.ingest({ grenades: { g: { effecttime: '0.1', velocity: '0,0,0' }, fire: { type: 'inferno', flames: { a: '0,0,-400', b: '20,0,-400' } } } }, s, 1100).state;
  assert.equal(state.grenades[0].type, 'smoke'); assert.equal(state.grenades[0].effectTime, 0.1);
  assert.deepEqual(state.grenades[1].position, { x: 10, y: 0, z: -400 });
  assert.equal(state.grenades[1].flames.length, 2);
  html = renderToStaticMarkup(createElement(Overlay, { state, settings: s, variant: 'game' }));
  assert.match(html, /ov-smoke-area/); assert.match(html, /ov-radar-fire/);
  assert.equal(n.ingest({ grenades: {} }, s, 1200).state.grenades.length, 0);
});

test('living cards have K/D, dead cards have round damage, and equipment badges are separate', () => {
  const s = config(), state = new DemoEngine(s, 1000).control('pause', {}, 1000);
  const html = renderToStaticMarkup(createElement(Overlay, { state, settings: s, variant: 'game' }));
  assert.equal((html.match(/class="ov-kd"/g) || []).length, 11);
  assert.match(html, /ov-compact-death/); assert.match(html, /Урон за текущий раунд/);
  assert.match(html, /ov-death-marker/); assert.match(html, /ov-compact-kit/);
  assert.doesNotMatch(html, /ov-kda|> A</);
  const loaded = renderToStaticMarkup(createElement(WeaponIcon, { name: 'weapon_ak47', ammoRatio: .4 }));
  assert.match(loaded, /offset="40%"/);
  assert.doesNotMatch(renderToStaticMarkup(createElement(WeaponIcon, { name: 'weapon_ak47' })), /linearGradient/);
});

test('tactical phase takes precedence over round-end and names the team; history uses historical side colours', () => {
  const s = config();
  const state = new GsiNormalizer().ingest({ map: { name: 'de_nuke', round: 12 }, round: { phase: 'over' }, phase_countdowns: { phase: 'timeout_ct', phase_ends_in: '60' } }, s, 1000).state;
  assert.equal(state.pause.active, true); assert.equal(state.pause.kind, 'tactical');
  let html = renderToStaticMarkup(createElement(Overlay, { state, settings: s, variant: 'production' }));
  assert.match(html, /ТАКТИЧЕСКАЯ ПАУЗА/); assert.match(html, /<span>Fnatic<\/span>/);
  const demo = new DemoEngine(s, 1000).control('pause', { scenario: 'swap-sides' }, 1000);
  html = renderToStaticMarkup(createElement(Overlay, { state: demo, settings: s, variant: 'pause' }));
  assert.doesNotMatch(html, /ИСТОРИЯ РАУНДОВ/);
  assert.match(html, /--round-color:#ef3c50/); assert.match(html, /--round-color:#00c9e8/);
});

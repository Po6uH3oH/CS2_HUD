import test from 'node:test';
import assert from 'node:assert/strict';
import { radarFocus, stepRadarFocus } from '../packages/core/radar-focus.js';

const bounds = { x: 40, y: 80, width: 1000, height: 800 };
test('radar keeps dispersed players in view and returns to overview when disabled or empty', () => {
  assert.deepEqual(radarFocus(bounds, [{ x: 60, y: 100 }, { x: 1000, y: 800 }]), bounds);
  assert.deepEqual(radarFocus(bounds, []), bounds);
  assert.deepEqual(radarFocus(bounds, [{ x: 500, y: 500 }], false), bounds);
});
test('cluster zoom is capped, keeps aspect ratio, and clamps at map edges', () => {
  const points = [{ x: 60, y: 120 }, { x: 100, y: 170 }];
  const view = radarFocus(bounds, points);
  assert.ok(Math.abs(bounds.width / view.width - 1.9) < 1e-9);
  assert.ok(Math.abs(view.width / view.height - bounds.width / bounds.height) < 1e-9);
  assert.equal(view.x, bounds.x);
  assert.equal(view.y, bounds.y);
  for (const p of points) assert.ok(p.x >= view.x && p.x <= view.x + view.width && p.y >= view.y && p.y <= view.y + view.height);
  // Screen radius is constant when symbols compensate for the viewBox width.
  assert.ok(Math.abs((view.width / 36) / view.width - (bounds.width / 36) / bounds.width) < 1e-9);
});
test('camera approaches target without overshoot and zooms out faster than in', () => {
  const zoom = radarFocus(bounds, [{ x: 500, y: 400 }]);
  const inward = stepRadarFocus(bounds, zoom, 33);
  const outward = stepRadarFocus(zoom, bounds, 33);
  assert.ok(inward.width > zoom.width && inward.width < bounds.width);
  assert.ok(outward.width > zoom.width && outward.width < bounds.width);
  assert.ok(outward.width - zoom.width > bounds.width - inward.width);
  assert.deepEqual(stepRadarFocus(bounds, zoom, 0), bounds);
});

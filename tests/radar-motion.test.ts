import test from 'node:test';
import assert from 'node:assert/strict';
import { RadarTrack } from '../packages/core/radar-motion.js';

test('irregular samples play continuously behind the input and never extrapolate', () => {
  const track = new RadarTrack();
  track.push(0, 0, 1000); track.push(10, 20, 1050); track.push(40, 80, 1200);
  assert.equal(track.at(1275)?.x, 15);
  assert.equal(track.at(1300)?.x, 20);
  assert.equal(track.at(1400)?.x, 40);
  assert.equal(track.at(3000)?.x, 40);
  track.push(1000, 1000, 1250);
  assert.equal(track.at(1300)?.x, 1000);
  track.clear(); assert.equal(track.at(1400), null);
});

test('long gaps reset the trail and older samples cannot rewind it', () => {
  const track = new RadarTrack();
  track.push(10, 20, 1000); track.push(30, 40, 2500); track.push(0, 0, 2000);
  assert.equal(track.at(2500)?.x, 30);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { completedMap } from '../packages/core/series-result';
import { createInitialState, defaultSettings } from '../packages/core';
test('only confirmed live map completion scores once per match/map, independent of team array order', () => {
 const settings = structuredClone(defaultSettings), state = createInitialState(settings, 'live');
 state.connected = true; state.phase = 'live'; state.teams[0].score = 13; state.teams[1].score = 9;
 assert.equal(completedMap(state, settings, []), null);
 state.phase = 'gameover'; state.teams.reverse();
 const result = completedMap(state, settings, [])!; assert.equal(result.winner, 0);
 assert.equal(completedMap(state, settings, [result.key]), null);
 state.mode = 'demo'; assert.equal(completedMap(state, settings, []), null);
});

import type { GameState, Settings } from '../shared/types.js';
export function completedMap(state: GameState, settings: Settings, recorded: string[]) {
  if (state.mode !== 'live' || !state.connected || state.phase !== 'gameover' || !state.map) return null;
  const scores = settings.teams.map(t => state.teams.find(p => p.id === t.id)?.score);
  if (scores.some(n => n == null) || scores[0] === scores[1]) return null;
  const key = JSON.stringify([settings.match.id, state.map]);
  if (recorded.includes(key)) return null;
  return { key, winner: scores[0]! > scores[1]! ? 0 : 1 };
}

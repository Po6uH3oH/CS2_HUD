import type { GameState, Settings } from '../shared/types.js';

/** GSI exposes a zero-based slot; CS2 binds slots 0–9 to keys 1–9,0. */
export function observerKey(value: unknown): number | null {
  const index = typeof value === 'number' ? value : typeof value === 'string' && value.trim() ? Number(value) : NaN;
  return Number.isInteger(index) && index >= 0 && index <= 9 ? (index + 1) % 10 : null;
}

export function observerOrder(key: number | null): number { return key === null ? 11 : key === 0 ? 10 : key; }

/** Side colours/positions belong to the broadcast, never to team identity or score indexes. */
export function presentationState(state: GameState, settings: Settings): GameState {
  const teams = state.teams.map(team => ({ ...team, color: settings.hud.sideColors[team.side] }))
    .sort((a, b) => Number(a.side === 'CT') - Number(b.side === 'CT')) as GameState['teams'];
  return { ...state, teams };
}

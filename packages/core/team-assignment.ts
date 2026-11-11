import type { GameState, Settings, Side } from '../shared/types.js';

const opposite = (side: Side): Side => side === 'T' ? 'CT' : 'T';
type Identity = { steamId: string; side: Side };

/** Resolve the two sides first, then group ALL players on those sides, including substitutes. */
export function resolveTeamSides(settings: Settings, players: Identity[], previous: GameState | null, map: string) {
  const configured = settings.teams.map(t => t.side) as [Side, Side];
  if (settings.match.autoSides === false) return { sides: configured, warning: '' };
  const startingCT = settings.match.mapDetails[map]?.startingCTTeamId;
  const seed = settings.teams.some(t => t.id === startingCT)
    ? settings.teams.map(t => t.id === startingCT ? 'CT' : 'T') as [Side, Side] : configured;
  const fallback = previous ? previous.teams.map(t => t.side) as [Side, Side] : seed;
  const anchors = new Set<Side>();
  for (const player of players) {
    settings.teams.forEach((team, index) => {
      if (team.steamIds.includes(player.steamId) || team.roster?.some(r => r.steamId === player.steamId)) {
        anchors.add(index === 0 ? player.side : opposite(player.side));
      }
    });
  }
  if (anchors.size > 1) return { sides: fallback, warning: 'Составы SteamID указывают на разные стороны. Проверьте команды и заново привяжите текущих игроков либо выключите автоопределение.' };
  const anchor = [...anchors][0];
  if (anchor) return { sides: [anchor, opposite(anchor)] as [Side, Side], warning: '' };
  // In-map identity tracking remains useful before an operator binds the roster.
  let tVotes = 0, ctVotes = 0;
  for (const player of players) {
    const old = previous?.players.find(p => p.steamId === player.steamId);
    const index = settings.teams.findIndex(t => t.id === old?.teamId);
    if (index < 0) continue;
    const vote = index === 0 ? player.side : opposite(player.side);
    if (vote === 'T') tVotes++; else ctVotes++;
  }
  const first = tVotes === ctVotes ? fallback[0] : tVotes > ctVotes ? 'T' : 'CT';
  return { sides: [first, opposite(first)] as [Side, Side], warning: '' };
}

/** Capture the displayed assignment, not the possibly incorrect cached team IDs. */
export function bindCurrentPlayers(settings: Settings, state: GameState): Settings {
  if (state.mode !== 'live' || !state.connected || (state.broadcastAt ?? Date.now()) - state.receivedAt > settings.staleAfterMs) throw new Error('Для привязки нужны свежие данные LIVE из CS2. Снимите ручную паузу, если она удерживает старый состав.');
  const next = structuredClone(settings);
  for (const team of next.teams) {
    const players = state.players.filter(p => p.side === team.side);
    if (!players.length || players.length > 20 || players.some(p => !/^\d{17}$/.test(p.steamId))) {
      throw new Error('Нужны игроки с корректными SteamID64 на обеих сторонах. Дождитесь состава из CS2.');
    }
    team.roster = players.map(p => ({ steamId: p.steamId, name: p.name }));
    team.steamIds = team.roster.map(p => p.steamId);
  }
  next.match.autoSides = true;
  return next;
}

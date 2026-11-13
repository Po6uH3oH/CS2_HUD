import type { GameState, Settings } from '../shared/types.js';

export const titleVariables = {
  team1: 'Название команды 1', team2: 'Название команды 2',
  score1: 'Раунды команды 1', score2: 'Раунды команды 2',
  maps1: 'Карты команды 1', maps2: 'Карты команды 2',
  map: 'Текущая карта', bo: 'Формат: BO1 / BO3 / BO5', tournament: 'Название турнира',
};
export const defaultTitleTemplate = '{team1} {score1}:{score2} {team2} | Карты {maps1}:{maps2} | {map} | {bo}';

export function renderStreamTitle(template: string, state: GameState, settings: Settings) {
  const teams = settings.teams.map(t => state.teams.find(s => s.id === t.id));
  const values: Record<string, string> = {
    team1: settings.teams[0].name, team2: settings.teams[1].name,
    score1: String(teams[0]?.score ?? '—'), score2: String(teams[1]?.score ?? '—'),
    maps1: String(settings.match.seriesScore[0]), maps2: String(settings.match.seriesScore[1]),
    map: state.map || settings.match.map, bo: `BO${settings.match.bestOf}`, tournament: settings.tournament.name,
  };
  const unknown: string[] = [];
  const title = template.replace(/\{([^{}]+)\}/g, (token, key: string) => {
    if (!Object.hasOwn(values, key)) { unknown.push(token); return token; }
    return values[key];
  }).replace(/\s+/g, ' ').trim();
  const malformed = /[{}]/.test(template.replace(/\{[^{}]+\}/g, ''));
  const error = unknown.length ? `Неизвестные переменные: ${[...new Set(unknown)].join(', ')}` : malformed ? 'Проверьте фигурные скобки в шаблоне.' : !title ? 'Название не должно быть пустым.' : [...title].length > 140 ? 'Название длиннее 140 символов. Сократите шаблон.' : null;
  const needsScore = /\{score[12]\}/.test(template);
  const ready = state.mode === 'live' && state.connected && (!needsScore || teams.every(t => t?.score != null));
  return { title, error, ready, length: [...title].length };
}

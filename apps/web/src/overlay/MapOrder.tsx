import type { GameState, Settings } from '../../../../packages/shared/types';

export function MapOrder({ settings, state }: { settings: Settings; state: GameState }) {
  if (!settings.hud.showMapOrder || settings.match.bestOf === 1) return null;
  return <div className="ov-map-order" aria-label="Порядок карт серии">
    {settings.match.maps.slice(0, settings.match.bestOf).map((map, i) => {
      const detail = settings.match.mapDetails[map];
      const picker = detail?.decider ? undefined : settings.teams.find(t => t.id === detail?.pickTeamId);
      const teams = picker ? [picker, ...settings.teams.filter(t => t.id !== picker.id)] : settings.teams;
      const scores = teams.map(t => detail?.scores[t.id]);
      const finished = scores.every(n => n != null);
      const outcome = finished && picker && scores[0] !== scores[1] ? (scores[0]! > scores[1]! ? 'won' : 'lost') : '';
      const active = !finished && map === state.map;
      return <div key={`${map}:${i}`} className={`ov-map-order-row ${active ? 'ov-map-current' : ''}`}>
        <span className="ov-map-index">{i+1}</span><strong>{map.replace(/^de_/, '').toUpperCase()}</strong>
        <span className="ov-map-pick" title={picker ? `Пик ${picker.name}` : detail?.decider ? 'Решающая карта' : 'Пик не задан'}>{picker?.tag || (picker ? picker.name : detail?.decider ? 'DECIDER' : '—')}</span>
        <b className={`ov-map-result ${outcome ? `ov-pick-${outcome}` : ''}`} title={finished ? `${teams[0].name} ${scores[0]} : ${scores[1]} ${teams[1].name}` : undefined}>{finished ? `${scores[0]}:${scores[1]}` : active ? 'LIVE' : '—'}</b>
      </div>;
    })}
  </div>;
}

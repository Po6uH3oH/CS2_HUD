import type { Settings } from '../../../packages/shared/types';

export function MatchMaps({ settings, change }: { settings: Settings; change: (update: (s: Settings) => void) => void }) {
  const edit = (map: string, update: (d: Settings['match']['mapDetails'][string]) => void) => change(s => {
    const detail = s.match.mapDetails[map] ??= { pickTeamId: null, decider: false, scores: {} };
    update(detail);
  });
  return <div className="match-maps">
    <label className="check"><input type="checkbox" checked={settings.hud.showMapOrder} onChange={e => change(s => { s.hud.showMapOrder = e.target.checked; })} /> Показывать порядок карт под радаром (BO3 / BO5)</label>
    <p className="info-note">Добавляйте карты в порядке игры. Выберите команду, которая взяла карту, или «Решающая». Итоговый счёт сохраняется из GSI после завершения карты; его можно исправить здесь. Пустой счёт — карта ещё не завершена. Зелёный результат означает победу на своём пике, красный — поражение. FACEIT передаёт порядок карт, владельцев пиков укажите вручную.</p>
    <div className="button-row" style={{flexWrap:'wrap'}}>{settings.radarMaps.map(m => <button type="button" className="button" key={m.id} disabled={settings.match.maps.includes(m.id) || settings.match.maps.length >= settings.match.bestOf} onClick={() => change(s => { s.match.maps.push(m.id); })}>+ {m.name}</button>)}</div>
    {settings.match.maps.map((map, i) => {
      const detail = settings.match.mapDetails[map];
      return <div className="match-map-row" key={map}>
        <strong>{i + 1}. {map.replace(/^de_/, '')}</strong>
        <select aria-label={`Пик ${map}`} value={detail?.decider ? 'decider' : detail?.pickTeamId ?? ''} onChange={e => edit(map, d => { d.decider = e.target.value === 'decider'; d.pickTeamId = d.decider ? null : e.target.value || null; })}>
          <option value="">Пик не задан</option><option value="decider">Решающая</option>{settings.teams.map(t => <option key={t.id} value={t.id}>Пик {t.tag || t.name}</option>)}
        </select>
        {settings.teams.map(t => <label key={t.id}><span>{t.tag || t.name}</span><input aria-label={`Счёт ${t.tag} на ${map}`} type="number" min={0} max={999} placeholder="—" value={detail?.scores[t.id] ?? ''} onChange={e => edit(map, d => { if (e.target.value === '') delete d.scores[t.id]; else d.scores[t.id] = Math.max(0, Math.min(999, Math.floor(Number(e.target.value)))); })} /></label>)}
        <button type="button" className="button" disabled={i === 0} title="Переместить раньше" onClick={() => change(s => { [s.match.maps[i-1], s.match.maps[i]] = [s.match.maps[i], s.match.maps[i-1]]; })}>←</button>
        <button type="button" className="button" title="Удалить карту" onClick={() => change(s => { s.match.maps.splice(i,1); delete s.match.mapDetails[map]; })}>×</button>
      </div>;
    })}
  </div>;
}

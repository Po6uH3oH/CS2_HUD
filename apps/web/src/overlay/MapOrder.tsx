import { Fragment, useEffect, useRef, useState, type CSSProperties } from 'react';
import type { GameState, Settings } from '../../../../packages/shared/types';
import { TeamMark } from './icons';

export function MapOrder({ settings, state }: { settings: Settings; state: GameState }) {
  const viewport = useRef<HTMLDivElement>(null), track = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ available: 0, content: 0 });
  const visible = settings.hud.showMapOrder && settings.match.bestOf > 1 && settings.match.maps.length > 0;
  useEffect(() => {
    if (!visible || !viewport.current || !track.current) return;
    const measure = () => setSize({available:viewport.current?.clientWidth ?? 0,content:track.current?.scrollWidth ?? 0});
    const observer = new ResizeObserver(measure);
    observer.observe(viewport.current); observer.observe(track.current); measure();
    return () => observer.disconnect();
  }, [visible]);
  if (!visible) return null;
  const travel = Math.max(0, size.content - size.available);
  const scrolling = settings.match.bestOf === 5 && travel > 1 && settings.hud.animate;
  const scale = settings.match.bestOf === 3 && size.content > 0 ? Math.min(1, size.available / size.content) : 1;
  const style = { '--strip-travel': `${-travel}px`, '--strip-duration': `${Math.max(8, travel / 24 + 4)}s`, '--strip-scale': scale || 1 } as CSSProperties;
  return <div ref={viewport} className={`ov-map-order ${scrolling ? 'ov-map-scrolling' : ''} ${settings.match.bestOf === 5 && !settings.hud.animate ? 'ov-map-manual-scroll' : ''}`} aria-label="Порядок карт серии" style={style}><div ref={track} className="ov-map-order-track">
    {settings.match.maps.slice(0, settings.match.bestOf).map((map, i) => {
      const detail = settings.match.mapDetails[map];
      const picker = detail?.decider ? undefined : settings.teams.find(t => t.id === detail?.pickTeamId);
      const teams = picker ? [picker, ...settings.teams.filter(t => t.id !== picker.id)] : settings.teams;
      const scores = teams.map(t => detail?.scores[t.id]);
      const finished = scores.every(n => n != null);
      const outcome = finished && picker && scores[0] !== scores[1] ? (scores[0]! > scores[1]! ? 'won' : 'lost') : '';
      return <Fragment key={`${map}:${i}`}>
        {i > 0 && <span className="ov-map-arrow" aria-hidden="true">▸</span>}
        <div className={`ov-map-order-item ${map === state.map ? 'ov-map-current' : ''}`} title={picker ? `Пик ${picker.name}` : detail?.decider ? 'Решающая карта' : 'Пик не задан'}>
          {picker && <TeamMark name={picker.name} tag={picker.tag} logo={picker.logo} />}
          <strong>{map.replace(/^de_/, '').toUpperCase()}</strong>
          {finished && <b className={`ov-map-result ${outcome ? `ov-pick-${outcome}` : ''}`} title={`${teams[0].name} ${scores[0]} : ${scores[1]} ${teams[1].name}`}>{scores[0]}:{scores[1]}</b>}
        </div>
      </Fragment>;
    })}
  </div></div>;
}

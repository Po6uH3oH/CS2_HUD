import { useEffect, useRef, useState, useId, type CSSProperties, type ReactNode } from 'react';
import type { GameState, Grenade, HudSettings, Player, RadarMap, Settings, TeamState, Timer } from '../../../../packages/shared/types';
import { economy, observerOrder, presentationState, remaining, selectRadarLayer, worldToRadar } from '../../../../packages/core';
import { grenadePhase, grenadeBursts, bombPulseFrame, expiredSmokes } from '../../../../packages/core/grenade-presentation';
import { primaryWeapon, weaponFill } from '../../../../packages/core/player-loadout';
import { useRadarFocus } from './useRadarFocus';
import { MapOrder } from './MapOrder';
import { RadarTrack } from '../../../../packages/core/radar-motion';
import { EquipmentIcon, TeamMark, WeaponIcon, grenadeKind, isGrenade, itemName } from './icons';

export interface OverlayProps {
  state: GameState;
  settings: Settings;
  variant: 'game' | 'pause' | 'production';
  overlay?: 'auto' | 'game' | 'pause' | 'hidden';
  className?: string;
}
type Vars = CSSProperties & Record<`--${string}`, string | number>;
const money = (value: number | null) => value == null ? '—' : `$${Math.round(value).toLocaleString('en-US')}`;
const val = (value: number | null) => value == null ? '—' : value;
const clock = (seconds: number | null) => seconds == null ? '—:—' : `${Math.floor(Math.max(0, Math.ceil(seconds)) / 60)}:${String(Math.max(0, Math.ceil(seconds)) % 60).padStart(2, '0')}`;
const mapName = (map: string) => map.replace(/^.*\//, '').replace(/^de_/, '').toUpperCase() || 'КАРТА НЕ ОПРЕДЕЛЕНА';
const pauseNames: Record<GameState['pause']['kind'], string> = { tactical: 'ТАКТИЧЕСКАЯ ПАУЗА', technical: 'ТЕХНИЧЕСКАЯ ПАУЗА', admin: 'ПАУЗА АДМИНИСТРАТОРА', paused: 'ПАУЗА', resuming: 'ВОЗВРАЩАЕМСЯ В ИГРУ' };
const phaseNames: Record<string, string> = { unknown: 'ОЖИДАНИЕ', warmup: 'РАЗМИНКА', freezetime: 'ЗАКУПКА', live: 'LIVE', over: 'РАУНД ЗАВЕРШЁН', gameover: 'КАРТА ЗАВЕРШЕНА', intermission: 'ПЕРЕРЫВ', paused: 'ПАУЗА' };

/** Между пакетами идёт монотонная интерполяция: часы Windows не двигают эфирный таймер. */
function useServerClock(state: GameState) {
  const authoritative = state.broadcastAt ?? Math.max(state.receivedAt, state.roundTimer.updatedAt, state.bomb.timer.updatedAt, state.bomb.defuseTimer.updatedAt, state.pause.timer.updatedAt);
  const anchor = useRef({ authoritative, local: performance.now() });
  if (anchor.current.authoritative !== authoritative) anchor.current = { authoritative, local: performance.now() };
  const [, tick] = useState(0);
  useEffect(() => { const handle = window.setInterval(() => tick(value => value + 1), 100); return () => clearInterval(handle); }, []);
  return anchor.current.authoritative + performance.now() - anchor.current.local;
}

function projected(timer: Timer, state: GameState, now: number) {
  if (timer.source === 'unknown') return null;
  return remaining({ ...timer, running: timer.running && (state.connected || state.mode === 'demo' || timer.source === 'manual') }, now);
}

export function Overlay({ state: rawState, settings, variant, overlay = 'auto', className = '' }: OverlayProps) {
  const state = presentationState(rawState, settings);
  const frame = useRef<HTMLDivElement>(null);
  const [fit, setFit] = useState(0);
  const now = useServerClock(state);
  useEffect(() => {
    if (!frame.current) return;
    const observer = new ResizeObserver(entries => { const rect = entries[0]?.contentRect; if (rect) setFit(Math.min(rect.width / 2560, rect.height / 1440)); });
    observer.observe(frame.current);
    return () => observer.disconnect();
  }, []);
  const pause = variant === 'pause' || (variant === 'production' && (overlay === 'pause' || (overlay === 'auto' && state.pause.active)));
  const economyVisible = pause || state.phase === 'freezetime';
  const hidden = variant === 'production' && overlay === 'hidden';
  const style: Vars = { '--left': state.teams[0].color, '--right': state.teams[1].color, transform: `translate(-50%, -50%) scale(${fit * settings.hud.scale})`, opacity: settings.hud.opacity };
  return <div ref={frame} className={`ov-frame ${className}`} aria-label={pause ? 'Оверлей паузы' : 'Игровой оверлей'}>
    {!hidden && <div className={`ov-stage ${pause ? 'ov-pause' : 'ov-game'} ${economyVisible ? 'ov-buy' : ''} ${settings.hud.animate ? '' : 'ov-no-motion'}`} style={style}>
      <Scoreboard state={state} settings={settings} now={now} pause={pause} />
      {state.mode === 'demo' && <div className="ov-demo-label"><i />ДЕМОНСТРАЦИЯ</div>}
      {state.mode === 'live' && !state.connected && <div className="ov-stale"><i />{state.revision > 0 ? 'НЕТ СВЕЖИХ ДАННЫХ · HUD ПРИОСТАНОВЛЕН' : 'ОЖИДАНИЕ ДАННЫХ НАБЛЮДАТЕЛЯ'}</div>}
      {!pause && <>
        {settings.hud.showRadar ? <Radar state={state} settings={settings} now={now} /> : <div className="ov-map-only">{mapName(state.map)} <span>BO{settings.match.bestOf}</span></div>}
        {settings.hud.showAliveCount && <AliveCount state={state} />}
        {settings.hud.showObserved && <ObservedCard state={state} />}
        <BombStatus state={state} now={now} />
        {state.winner && <Winner state={state} />}
      </>}
      {pause && <>
        <Timeouts state={state} />
        {settings.hud.showHistory && <RoundHistory state={state} />}
        <PauseCenter state={state} now={now} />

      </>}

      {state.teams.map((team, index) => <EconomyPanel visible={economyVisible} key={team.id} state={state} team={team} edge={index === 0 ? 'left' : 'right'} />)}
      {settings.hud.showPlayers && state.teams.map((team, index) => <Roster key={team.id} state={state} team={team} edge={index === 0 ? 'left' : 'right'} pause={economyVisible} />)}
    </div>}
  </div>;
}

function Scoreboard({ state, settings, now, pause }: { state: GameState; settings: Settings; now: number; pause: boolean }) {
  const explosion = useScoreExplosion(state);
  const planted = !pause && ['planted', 'defusing'].includes(state.bomb.state) && !['over', 'gameover'].includes(state.phase);
  const timer = planted ? state.bomb.timer : state.roundTimer;
  const value = projected(timer, state, now);
  const progress = value != null && timer.duration ? Math.max(0, Math.min(1, value / timer.duration)) : 0;
  const beat = bombPulseFrame(value);
  const pulsing = planted && settings.hud.animate && state.connected && timer.running && !state.pause.active;
  return <header className={`ov-scoreboard ${planted ? 'ov-scoreboard-bomb' : ''} ${planted && value != null && value < 10 ? 'ov-critical' : ''}`}>
    <div className="ov-score-main">
      <ScoreTeam team={state.teams[0]} reverse={false} />
      <div className="ov-score-number" style={{ '--team': state.teams[0].color } as Vars}>{val(state.teams[0].score)}</div>
      <div className="ov-time-block">
        {!pause && explosion ? <div className="ov-score-explosion"><img src="/assets/icons/ui/explosion.gif" alt="Взрыв бомбы" /></div> : planted ? <div className="ov-bomb-label"><span className="ov-score-bomb-beat" style={{scale:pulsing ? beat.iconScale : 1}}><EquipmentIcon kind="bomb" title="Бомба установлена" /></span>{timer.source === 'estimate' && <small title="Расчётный таймер">≈</small>}</div> : <>{!pause && state.phase !== 'live' && <div className="ov-time-label">{phaseNames[state.phase] || state.phase.toUpperCase()}</div>}<strong>{pause ? 'ПАУЗА' : clock(value)}</strong></>}
        <span>РАУНД {state.round || '—'}</span>
      </div>
      <div className="ov-score-number" style={{ '--team': state.teams[1].color } as Vars}>{val(state.teams[1].score)}</div>
      <ScoreTeam team={state.teams[1]} reverse />
    </div>
    {settings.match.bestOf > 1 && <div className="ov-series" aria-label={`Счёт по картам ${state.teams[0].seriesScore}:${state.teams[1].seriesScore}`}><span>{Array.from({ length: Math.ceil(settings.match.bestOf / 2) }, (_, i) => <i key={i} className={i < state.teams[0].seriesScore ? 'won' : ''} />)}</span><span>{Array.from({ length: Math.ceil(settings.match.bestOf / 2) }, (_, i) => <i key={i} className={i < state.teams[1].seriesScore ? 'won' : ''} />)}</span></div>}
    {planted && <div className={`ov-timer-track ${value === null ? 'ov-timer-unknown' : ''}`} role="progressbar" aria-label={value === null ? 'Бомба: время неизвестно' : 'До взрыва бомбы'} aria-valuemin={0} aria-valuemax={100} aria-valuenow={value === null ? undefined : Math.round(progress * 100)}><i style={{ transform: `scaleX(${progress})` }} /></div>}
  </header>;
}

function ScoreTeam({ team, reverse }: { team: TeamState; reverse: boolean }) {
  return <div className={`ov-score-team ${reverse ? 'ov-reverse' : ''}`} style={{ '--team': team.color } as Vars}><TeamMark name={team.name} tag={team.tag} logo={team.logo} /><div><strong>{team.tag || team.name}</strong></div></div>;
}

function AliveCount({ state }: { state: GameState }) {
  const alive = state.teams.map(team => state.players.filter(player => player.teamId === team.id && player.alive).length);
  if (!state.players.length) return null;
  return <div className="ov-alive" aria-label={`В живых ${alive[0]} против ${alive[1]}`}><span style={{ color: state.teams[0].color }}>{alive[0]}</span><small>VS</small><span style={{ color: state.teams[1].color }}>{alive[1]}</span></div>;
}

function Roster({ state, team, edge, pause }: { state: GameState; team: TeamState; edge: 'left' | 'right'; pause: boolean }) {
  const players = state.players.filter(player => player.teamId === team.id).sort((a, b) => observerOrder(a.slot) - observerOrder(b.slot));
  return <section className={`ov-roster ov-roster-${edge}`} style={{ '--team': team.color } as Vars} aria-label={`Игроки ${team.name}`}>
    {players.map(player => <PlayerCard key={`${state.map}:${state.round}:${player.steamId}`} player={player} observed={player.steamId === state.observedId || player.observed} pause={pause} />)}
    {!players.length && <div className="ov-empty-roster">ОЖИДАЕМ СОСТАВ КОМАНДЫ</div>}
  </section>;
}

function PlayerStats({ player }: { player: Player }) {
  return <span className="ov-kd"><span title="Убийства"><EquipmentIcon kind="kill" /><b>{val(player.kills)}</b></span><span title="Смерти"><EquipmentIcon kind="skull" /><b>{val(player.deaths)}</b></span></span>;
}

function HealthFill({ health, flash }: { health: number | null; flash: number }) {
  const hp = Math.max(0, Math.min(100, health ?? 0));
  const [trail, setTrail] = useState(hp);
  const last = useRef(hp);
  useEffect(() => {
    const previous = last.current; last.current = hp;
    if (hp >= previous) { setTrail(hp); return; }
    setTrail(value => Math.max(value, previous));
    const timeout = window.setTimeout(() => setTrail(hp), 420);
    return () => window.clearTimeout(timeout);
  }, [hp]);
  return <><i className="ov-health-trail" style={{ width: `${Math.max(hp, trail)}%` }} /><i className="ov-health-fill" style={{ width: `${hp}%` }} /><i className="ov-flash-fill" style={{ width: `${hp}%`, opacity: flash }} /></>;
}

function PlayerCard({ player, observed }: { player: Player; observed: boolean; pause: boolean }) {
  const primary = primaryWeapon(player.weapons);
  const grenades = player.weapons.filter(w => isGrenade(w.name)).flatMap(w => Array.from({ length: Math.min(4, Math.max(0, Math.floor(w.count))) }, () => w)).slice(0, 4);
  const flash = player.alive ? Math.min(1, Math.max(0, (player.flashed ?? 0) / 255)) : 0;
  const dead = player.health === 0;
  return <article className={`ov-player ov-compact ${dead ? 'ov-dead' : ''} ${observed ? 'ov-observed' : ''}`} style={{ '--flash-percent': `${flash * 100}%` } as Vars}>
    <HealthFill health={player.health} flash={flash} />
    <span className="ov-observer-slot">{player.slot ?? '—'}</span>
    <span className="ov-kill-stars" title={`Убийств за раунд: ${player.roundKills ?? 0}`}>{'★'.repeat(Math.min(5, player.roundKills ?? 0))}</span>
    <div className="ov-compact-name" title={player.name}><strong>{player.name.length > 12 ? player.name.slice(0,12) + '…' : player.name}</strong></div>
    <div className="ov-compact-stats"><PlayerStats player={player} /></div>
    <div className="ov-compact-money">{money(player.money)}</div>
    {!dead && <><div className="ov-compact-weapon">{primary && <WeaponIcon name={primary.name} ammoRatio={weaponFill(primary)} />}</div><strong className="ov-compact-hp">{val(player.health)}</strong>
    <div className="ov-compact-utility">{Array.from({ length: 4 }, (_, i) => <span key={i}>{grenades[i] && <EquipmentIcon kind={grenadeKind(grenades[i].name)} />}</span>)}</div>
    <div className="ov-compact-badges"><span className="ov-compact-kit">{player.side === 'CT' && player.defuseKit && <EquipmentIcon kind="kit" />}{player.hasBomb && <EquipmentIcon kind="bomb" />}</span><span className="ov-compact-armor"><ArmorIndicator player={player} /></span></div></>}
    {dead && <div className="ov-compact-death" title="Урон за текущий раунд"><EquipmentIcon kind="skull" /><span>{val(player.roundDamage)} <small>DPR</small></span></div>}
  </article>;
}

function ArmorIndicator({ player }: { player: Player }) {
  if (player.armor == null || player.armor <= 0) return null;
  return <span className={`ov-armor ${player.armor < 20 ? 'ov-armor-low' : ''}`} title={player.helmet ? 'Кевлар и шлем' : 'Кевлар'}><EquipmentIcon kind={player.helmet ? 'helmet' : 'armor'} />{player.armor < 20 && <small>{player.armor}</small>}</span>;
}

function ObservedCard({ state }: { state: GameState }) {
  const player = state.players.find(entry => entry.steamId === state.observedId) || state.players.find(entry => entry.observed);
  if (!player) return null;
  const team = state.teams.find(entry => entry.id === player.teamId);
  if (!team) return null;
  const active = player.weapons.find(weapon => weapon.state === 'active');
  return <section className="ov-observed-card" style={{ '--team': team.color } as Vars} key={player.steamId}>
    <div className="ov-observed-accent" />
    <div className="ov-observed-identity"><strong>{player.name}</strong><PlayerStats player={player} /></div>
    <div className="ov-observed-equipment"><div><EquipmentIcon kind="health" /><strong>{val(player.health)}</strong><ArmorIndicator player={player} />{player.defuseKit && <EquipmentIcon kind="kit" />}</div><span>{active ? <><WeaponIcon name={active.name} /><strong>{active.ammoClip ?? '—'}<small> / {active.ammoReserve ?? '—'}</small></strong></> : '—'}</span></div>
  </section>;
}

function BombStatus({ state, now }: { state: GameState; now: number }) {
  const active = state.bomb.state === 'defusing';
  const seconds = projected(state.bomb.defuseTimer, state, now);
  const bombSeconds = projected(state.bomb.timer, state, now);
  if (!active) return null;
  const progress = seconds != null && state.bomb.defuseTimer.duration ? Math.max(0, Math.min(1, 1 - seconds / state.bomb.defuseTimer.duration)) : 0;
  return <div className={`ov-defuse ${seconds != null && bombSeconds != null && seconds > bombSeconds ? 'ov-defuse-late' : ''}`}><div><EquipmentIcon kind="kit" /><strong>РАЗМИНИРОВАНИЕ</strong><span>{seconds == null ? '—' : `${seconds.toFixed(1)} c`}</span></div><div className="ov-defuse-track"><i style={{ width: `${progress * 100}%` }} /></div><small className={state.bomb.defuserHasKit ? '' : 'ov-no-kit'} title={state.bomb.defuserHasKit == null ? 'Наличие набора не подтверждено GSI' : undefined}>{state.bomb.defuserHasKit ? 'С НАБОРОМ' : 'БЕЗ НАБОРА РАЗМИНИРОВАНИЯ'}{state.bomb.defuseTimer.source === 'estimate' || state.bomb.defuseTimer.source === 'manual' ? ' · РАСЧЁТНОЕ ВРЕМЯ' : ''}</small></div>;
}

function Winner({ state }: { state: GameState }) {
  const team = state.teams.find(entry => entry.id === state.winner);
  if (!team) return null;
  return <div className="ov-winner" style={{ '--team': team.color } as Vars}><TeamMark name={team.name} tag={team.tag} logo={team.logo} /><div><small>{state.phase === 'gameover' ? 'ПОБЕДА НА КАРТЕ' : 'ПОБЕДА В РАУНДЕ'}</small><strong>{team.name}</strong></div></div>;
}

function Timeouts({ state }: { state: GameState }) {
  return <section className="ov-timeouts"><h3>ПАУЗ ОСТАЛОСЬ</h3><div>{state.teams.map(team => <span key={team.id} style={{ '--team': team.color } as Vars}><TeamMark name={team.name} tag={team.tag} logo={team.logo} /><strong>{val(team.timeoutsLeft)}</strong></span>)}</div></section>;
}

function RoundHistory({ state }: { state: GameState }) {
  const history = state.roundHistory.slice(-24);
  return <section className="ov-round-history"><div className="ov-history-grid">{state.teams.map(team => <div className="ov-history-row" key={team.id} style={{ '--team': team.color } as Vars}><TeamMark name={team.name} tag={team.tag} logo={team.logo} /><strong>{val(team.score)}</strong><div className="ov-history-cells">{history.map(result => <span key={result.round} style={{ '--round-color': state.teams.find(entry => entry.id === result.teamId)?.color } as Vars} className={`${result.teamId === team.id ? 'ov-round-won' : ''} ${result.round % 12 === 0 ? 'ov-half-end' : ''}`} title={`Раунд ${result.round}: ${result.method}`}><i>{result.teamId === team.id && /bomb|plant/.test(result.method) ? <EquipmentIcon kind="bomb" /> : result.teamId === team.id && /defus/.test(result.method) ? <EquipmentIcon kind="kit" /> : null}</i></span>)}{!history.length && <span className="ov-history-empty">Нет подтверждённых раундов</span>}</div></div>)}</div></section>;
}

function PauseCenter({ state, now }: { state: GameState; now: number }) {
  const team = state.teams.find(entry => entry.id === state.pause.teamId);
  const timer = projected(state.pause.timer, state, now);
  return <section className="ov-pause-center" style={{ '--team': team?.color || '#f2f5fa' } as Vars}><h1>{team && ['tactical', 'paused'].includes(state.pause.kind) ? <>ТАКТИЧЕСКАЯ ПАУЗА<br /><span>{team.name}</span></> : pauseNames[state.pause.kind]}</h1><div className="ov-pause-clock">{clock(timer)}</div>{state.pause.source === 'manual' && <p>Таймер оператора</p>}</section>;
}

function EconomyPanel({ state, team, edge, visible }: { visible: boolean; state: GameState; team: TeamState; edge: 'left' | 'right' }) {
  const data = economy(state.players.filter(player => player.teamId === team.id));
  const level = { full: 'ПОЛНЫЙ', partial: 'СРЕДНИЙ', low: 'НИЗКИЙ', unknown: '—' }[data.utilityLevel];
  const count = (pattern: RegExp) => !data.complete ? '—' : Object.entries(data.grenades).reduce((sum, [name, value]) => sum + (pattern.test(name) ? value : 0), 0);
  return <section aria-hidden={!visible} className={`ov-economy ov-economy-${edge} ${visible ? "ov-economy-visible" : ""}`} style={{ '--team': team.color } as Vars}>
    <div className="ov-economy-numbers"><div><small>ДЕНЬГИ</small><strong>{money(data.money)}</strong></div><div><small>СНАРЯЖЕНИЕ</small><strong>{money(data.equipmentValue)}</strong></div></div>
    <div className="ov-economy-bottom"><span><small>LOSS BONUS</small><b>{money(team.lossBonus)}</b></span><span><small>ГРАНАТЫ <b className={`ov-level-${data.utilityLevel}`}>{level}</b></small><span className="ov-economy-grenades"><span><EquipmentIcon kind="he" />{count(/hegrenade/)}</span><span><EquipmentIcon kind="smoke" />{count(/smoke/)}</span><span><EquipmentIcon kind="flash" />{count(/flash/)}</span><span><EquipmentIcon kind="fire" />{count(/molotov|incgrenade/)}</span></span></span></div>
  </section>;
}

function Radar({ state, settings, now }: { state: GameState; settings: Settings; now: number }) {
  const config = settings.radarMaps.find(entry => entry.id === state.map || entry.id === state.map.split('/').pop());
  const observed = state.players.find(player => player.steamId === state.observedId);
  const activeLayer = settings.hud.radarLayer === 'auto' ? observed?.position && config ? selectRadarLayer(observed.position, config) : config?.layers[0]?.id : settings.hud.radarLayer;
  const splitNuke = config?.id === 'de_nuke' && ['auto', 'both'].includes(settings.hud.radarLayer);
  const layers = splitNuke || settings.hud.radarLayer === 'both' ? config?.layers : config?.layers.filter(layer => layer.id === activeLayer || config.layers.length === 1).slice(0, 1);
  const seriesRows = settings.hud.showMapOrder && settings.match.bestOf > 1 ? Math.min(settings.match.maps.length, settings.match.bestOf) : 0;
  const stackedLayers = splitNuke ? layers?.length || 1 : 1;
  const style: Vars = { left: settings.hud.radarX, top: 18, width: settings.hud.radarSize, opacity: settings.hud.radarOpacity,
    '--radar-layer-max-height': `${(750 - 54 - seriesRows * 41 - (stackedLayers - 1) * 12) / stackedLayers}px` };
  return <section className={`ov-radar ${seriesRows ? 'ov-radar-series' : ''} ${splitNuke ? 'ov-radar-nuke' : settings.hud.radarLayer === 'both' ? 'ov-radar-both' : ''}`} style={style}>
    <header><strong>{mapName(state.map)}</strong><span>BO{settings.match.bestOf}</span></header>
    {config && layers?.length ? layers.map(layer => <div key={`${state.map}:${layer.id}`} className="ov-radar-layer"><div className="ov-radar-layer-name">{config.layers.length > 1 ? layer.name : ""}</div>{(config.calibrated && layer.image) ? <RadarLayer state={state} map={config} layer={layer.id} image={layer.image} hud={settings.hud} now={now} /> : <div className="ov-radar-unavailable"><svg viewBox="0 0 48 48"><circle cx="24" cy="24" r="17" /><circle cx="24" cy="24" r="8" /><path d="M24 3v42M3 24h42" /></svg><strong>ОБЗОРНАЯ КАРТА<br />НЕ НАСТРОЕНА</strong></div>}</div>) : <div className="ov-radar-unavailable"><strong>КАРТА НЕ НАСТРОЕНА</strong></div>}
    <MapOrder settings={settings} state={state} />
  </section>;
}

function RadarLayer({ state, map, layer, image, hud, now }: { state: GameState; map: RadarMap; layer: string; image: string; hud: HudSettings; now: number }) {
  const previousGrenades = useRef<{ context: string; items: Grenade[] }>({ context: '', items: [] });
  const [bursts, setBursts] = useState<{ grenade: Grenade; expires: number }[]>([]);
  const [smokeExits, setSmokeExits] = useState<{grenade: Grenade; expires: number}[]>([]);
  useEffect(() => {
    const now = performance.now(), context = `${state.mode}:${state.map}:${state.round}`;
    const sameContext = previousGrenades.current.context === context;
    const events = state.connected && !['over', 'gameover', 'unknown'].includes(state.phase)
      ? grenadeBursts(sameContext ? previousGrenades.current.items : [], state.grenades) : [];
    const endingSmokes = sameContext && state.connected && hud.animate ? expiredSmokes(previousGrenades.current.items, state.grenades) : [];
    setSmokeExits(old => [...(sameContext ? old.filter(b => b.expires > now && !state.grenades.some(g => g.id === b.grenade.id)) : []), ...endingSmokes.map(grenade => ({grenade, expires: now + 850}))]);
    previousGrenades.current = { context, items: state.grenades };
    setBursts(old => [...(sameContext && state.connected ? old.filter(b => b.expires > now) : []),
      ...events.map(grenade => ({ grenade, expires: now + (grenade.type.includes('flash') ? 700 : 550) }))]);
  }, [state.revision, state.connected, state.round, state.map, state.mode, hud.animate]);
  useEffect(() => {
    if (!bursts.length) return;
    const t = window.setTimeout(() => setBursts(old => old.filter(b => b.expires > performance.now())), Math.max(0, Math.min(...bursts.map(b => b.expires)) - performance.now()) + 5);
    return () => clearTimeout(t);
  }, [bursts]);
  useEffect(() => {
    if (!smokeExits.length) return;
    const t = window.setTimeout(() => setSmokeExits(old => old.filter(b => b.expires > performance.now())), Math.max(0, Math.min(...smokeExits.map(b => b.expires)) - performance.now()) + 5);
    return () => clearTimeout(t);
  }, [smokeExits]);
  const smokeColor = (g: Grenade) => g.ownerSide ? hud.sideColors[g.ownerSide] : state.teams.find(t => t.id === (g.ownerTeamId ?? state.players.find(p => p.steamId === g.owner)?.teamId))?.color;
  const bounds = map.viewBounds ?? { x: 0, y: 0, width: map.size, height: map.size };
  const focusPlayers = state.players.filter(p => p.alive && p.position && selectRadarLayer(p.position, map) === layer);
  const focusPoints = focusPlayers.map(p => worldToRadar(p.position!, map));
  if (state.bomb.position && ['planted', 'defusing', 'dropped'].includes(state.bomb.state) && selectRadarLayer(state.bomb.position, map) === layer) focusPoints.push(worldToRadar(state.bomb.position, map));
  for (const grenade of state.grenades) {
    if (grenadePhase(grenade) === 'flight' && selectRadarLayer(grenade.position, map) === layer) focusPoints.push(worldToRadar(grenade.position, map));
  }
  const view = useRadarFocus(bounds, focusPoints, state.connected && ['live', 'bomb', 'defuse'].includes(state.phase) && focusPlayers.length > 0, hud.animate);
  // Compensate symbol dimensions for the camera zoom; world areas (smoke/fire) retain their physical size.
  const markerSize = view.width / 36;
  const symbolScale = view.width / bounds.width;
  const positions = state.players.filter(player => player.alive && player.position && selectRadarLayer(player.position, map) === layer);
  return <svg className="ov-radar-map" viewBox={`${view.x} ${view.y} ${view.width} ${view.height}`} style={{ aspectRatio: `${bounds.width} / ${bounds.height}` }} role="img" aria-label={`Радар ${map.name}, ${layer}`}>
    {image && map.calibrated ? <image className="ov-map-image" href={image} x="0" y="0" width={map.size} height={map.size} /> : null}
    {map.sites.filter(site => site.layer === layer).map(site => <g key={site.label} transform={`translate(${site.x},${site.y})`}><circle r={markerSize * 1.5} fill="#eec265" fillOpacity=".13" stroke="#eec265" strokeOpacity=".35" strokeWidth={2} /><text textAnchor="middle" dominantBaseline="central" fill="#eec265" fontSize={markerSize * 1.5} fontWeight="800">{site.label}</text></g>)}
    {state.players.filter(p => p.health === 0 && p.deathPosition && selectRadarLayer(p.deathPosition, map) === layer).map(player => {
      const point = worldToRadar(player.deathPosition!, map), team = state.teams.find(t => t.id === player.teamId);
      return <g className="ov-death-marker" key={`death-${player.steamId}`} transform={`translate(${point.x},${point.y}) scale(.65)`} style={{ color: team?.color }}><title>{`Место смерти: ${player.name}`}</title><path d={`M${-markerSize * .65},${-markerSize * .65}l${markerSize * 1.3},${markerSize * 1.3}m0,${-markerSize * 1.3}l${-markerSize * 1.3},${markerSize * 1.3}`} fill="none" stroke="#07121e" strokeWidth={markerSize * .7} /><path d={`M${-markerSize * .65},${-markerSize * .65}l${markerSize * 1.3},${markerSize * 1.3}m0,${-markerSize * 1.3}l${-markerSize * 1.3},${markerSize * 1.3}`} fill="none" stroke="currentColor" strokeWidth={markerSize * .35} /></g>;
    })}
    {hud.showGrenades && state.grenades.filter(g => g.flames.length ? g.flames.some(p => selectRadarLayer(p, map) === layer) : selectRadarLayer(g.position, map) === layer).map(grenade => <RadarGrenade key={grenade.id} grenade={grenade} map={map} layer={layer} size={markerSize} ownerColor={smokeColor(grenade)} sampleAt={state.receivedAt} animate={hud.animate && state.connected} />)}
    {hud.showGrenades && smokeExits.filter(b => selectRadarLayer(b.grenade.position,map) === layer).map(b => <g className="ov-smoke-exit" key={`${b.grenade.id}:${b.expires}`}><RadarGrenade grenade={b.grenade} map={map} layer={layer} size={markerSize} ownerColor={smokeColor(b.grenade)} sampleAt={state.receivedAt} animate={false} /></g>)}
    {hud.showGrenades && bursts.filter(b => selectRadarLayer(b.grenade.position, map) === layer).map(b => { const p = worldToRadar(b.grenade.position, map); return <g key={`${b.grenade.id}-${b.expires}`} transform={`translate(${p.x},${p.y})`}><GrenadeBurst type={b.grenade.type} size={markerSize} animate={hud.animate} /></g>; })}
    {positions.map(player => {
      const point = worldToRadar(player.position!, map);
      const team = state.teams.find(entry => entry.id === player.teamId);
      const forward = player.forward ? worldToRadar({ x: player.position!.x + player.forward.x * 100, y: player.position!.y + player.forward.y * 100, z: player.position!.z }, map) : null;
      const angle = forward ? Math.atan2(forward.y - point.y, forward.x - point.x) * 180 / Math.PI : null;
      return <RadarMotion key={player.steamId} x={point.x} y={point.y} sampleAt={state.receivedAt} animate={hud.animate && state.connected} color={team?.color || '#fff'}><title>{`${player.name} · ${player.side}`}</title>{angle != null && <path d={`M${markerSize * .7},${-markerSize * .62} L${markerSize * 1.9},0 L${markerSize * .7},${markerSize * .62}Z`} transform={`rotate(${angle})`} fill="currentColor" opacity=".55" />}<circle r={markerSize} fill="currentColor" stroke={player.steamId === state.observedId ? '#fff' : '#111923'} strokeWidth={map.size / 300 * symbolScale} /><circle className="ov-player-flash" r={markerSize} fill="white" opacity={Math.min(1, Math.max(0, (player.flashed ?? 0) / 255))} /><text textAnchor="middle" dominantBaseline="central" fill="#101820" fontSize={markerSize * 1.25} fontWeight="900">{player.slot ?? "?"}</text>{player.hasBomb && <image className="ov-map-bomb" href="/assets/icons/effects/map_bomb.svg" x={markerSize * .35} y={markerSize * .35} width={markerSize} height={markerSize} />}</RadarMotion>;
    })}
    <RadarBomb state={state} map={map} layer={layer} size={markerSize} animate={hud.animate} now={now} />
  </svg>;
}


function RadarMotion({ x, y, color, animate, sampleAt, children }: { x: number; y: number; color?: string; animate: boolean; sampleAt?: number; children: ReactNode }) {
  const node = useRef<SVGGElement>(null);
  const track = useRef(new RadarTrack());
  useEffect(() => {
    if (!animate) track.current.clear();
    track.current.push(x, y, performance.now());
    if (!animate) node.current?.setAttribute('transform', `translate(${x},${y})`);
  }, [x, y, sampleAt, animate]);
  useEffect(() => {
    if (!animate) return;
    let frame = 0;
    const draw = () => {
      const point = track.current.at(performance.now());
      if (point) node.current?.setAttribute('transform', `translate(${point.x},${point.y})`);
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(frame);
  }, [animate]);
  return <g ref={node} style={{ color }}>{children}</g>;
}

function RadarGrenade({ grenade, map, layer, size, animate, sampleAt, ownerColor }: { ownerColor?: string; sampleAt: number; grenade: Grenade; map: RadarMap; layer: string; size: number; animate: boolean }) {
  const point = worldToRadar(grenade.position, map);
  const effectId = useId();
  const phase = grenadePhase(grenade);
  const smoke = phase === 'smoke';
  if (phase === 'expired') return null;
  if (phase === 'burst') return null; // Event layer owns the finite explosion animation.
  if (phase === 'fire') return <g className="ov-radar-fire"><title>Огонь</title>{grenade.flames.filter(p => selectRadarLayer(p, map) === layer).map((p, i) => { const pos = worldToRadar(p, map); return <FirePatch key={i} x={pos.x} y={pos.y} size={144 / map.scale} animate={animate} />; })}</g>;
  return <RadarMotion x={point.x} y={point.y} sampleAt={sampleAt} animate={animate && !smoke}><title>{smoke ? 'Раскрытый дым' : `Граната: ${grenade.type}`}</title>{smoke ? <g className="ov-smoke-area"><defs><radialGradient id={effectId}><stop offset="0" stopColor="#d4e0e6" stopOpacity=".9" /><stop offset=".65" stopColor="#c3d2db" stopOpacity=".75" /><stop offset="1" stopColor="#bbcbd5" stopOpacity=".15" /></radialGradient></defs><circle r={160 / map.scale} fill={`url(#${effectId})`} /><circle r={144 / map.scale} fill="none" stroke="#101c29" strokeOpacity=".9" strokeWidth="7" /><circle r={144 / map.scale} fill="none" stroke={ownerColor || "#f4fbff"} strokeOpacity={ownerColor ? ".7" : ".5"} strokeWidth="3" /></g> : <><g className="ov-flying-grenade" transform={`translate(${-size * .8},${-size * .8}) scale(${size * 1.6 / 24})`} style={{ color: /molotov|incendiary/.test(grenade.type) ? '#ffb66b' : '#fff' }}><EquipmentIcon className="ov-radar-glyph" kind={grenadeKind(grenade.type)} /></g></>}</RadarMotion>;
}

function FirePatch({ x, y, size, animate }: { x: number; y: number; size: number; animate: boolean }) {
  const [missing, setMissing] = useState(false);
  const animated = animate && !missing;
  return <image className="ov-fire-patch" href={`/assets/icons/effects/${animated ? 'fire.gif' : 'fire.svg'}`} x={x - size / 2} y={y - size / 2} width={size} height={size} preserveAspectRatio="xMidYMid meet" onError={animated ? () => setMissing(true) : undefined} />;
}

function GrenadeBurst({ type, size, animate }: { type: string; size: number; animate: boolean }) {
  const flash = type.includes('flash');
  const [missing, setMissing] = useState(false);
  if (flash && (!animate || missing)) return <path className="ov-flash-burst" d="M0-2 0 2M-2 0 2 0M-1.4-1.4 1.4 1.4M1.4-1.4-1.4 1.4" transform={`scale(${size})`} stroke="#fffbe3" strokeWidth=".3" />;
  return <image className={flash ? 'ov-flash-burst' : 'ov-he-burst'} href={flash ? '/assets/icons/effects/flash.gif' : '/assets/icons/effects/he-burst.svg'} x={-size*2} y={-size*2} width={size*4} height={size*4} onError={flash ? () => setMissing(true) : undefined} />;
}

function RadarBomb({ state, map, layer, size, animate, now }: { state: GameState; map: RadarMap; layer: string; size: number; animate: boolean; now: number }) {
  const previous = useRef<{ context: string; bomb: GameState['bomb'] } | null>(null);
  const [explosion, setExplosion] = useState<GameState['bomb']['position']>(null);
  useEffect(() => {
    const context = `${state.mode}:${state.map}:${state.round}`;
    const old = previous.current?.context === context ? previous.current.bomb : null;
    if (previous.current?.context !== context) setExplosion(null);
    if (state.connected && state.bomb.state === 'exploded' && old?.state !== 'exploded')
      setExplosion(state.bomb.position ?? (old && ['planted', 'defusing'].includes(old.state) ? old.position : null));
    previous.current = { context, bomb: state.bomb };
  }, [state.revision, state.map, state.round, state.mode, state.connected]);
  useEffect(() => { if (!explosion) return; const handle = window.setTimeout(() => setExplosion(null), 950); return () => clearTimeout(handle); }, [explosion]);
  const position = state.bomb.position;
  const visible = position && ['dropped', 'planted', 'defusing'].includes(state.bomb.state) && selectRadarLayer(position, map) === layer;
  const point = visible ? worldToRadar(position, map) : null;
  const blast = explosion && selectRadarLayer(explosion, map) === layer ? worldToRadar(explosion, map) : null;
  const planted = ['planted', 'defusing'].includes(state.bomb.state);
  const seconds = projected(state.bomb.timer, state, now);
  const beat = bombPulseFrame(seconds);
  const pulse = animate && state.connected && state.bomb.timer.running && !state.pause.active;
  return <>
    {point && <g transform={`translate(${point.x},${point.y})`}><title>{`C4 · ${state.bomb.state}`}</title>
      {planted && pulse && <circle className="ov-planted-pulse" r={size*2.3} fill="#ff273e" fillOpacity=".22" stroke="#ff3b4d" strokeOpacity=".45" strokeWidth={size*.1} style={{animation:"none",scale:beat.ringScale,opacity:beat.ringOpacity}} />}
      <image className="ov-map-bomb" href="/assets/icons/effects/map_bomb.svg" x={-size} y={-size} width={size*2} height={size*2} />
    </g>}
    {blast && <g transform={`translate(${blast.x},${blast.y})`}><image className="ov-bomb-explosion" href="/assets/icons/effects/he-burst.svg" x={-size*5} y={-size*5} width={size*10} height={size*10} /></g>}
  </>;
}

function useScoreExplosion(state: GameState) {
  const last = useRef({context:'', exploded:false});
  const [active, setActive] = useState(false);
  useEffect(() => {
    const context = `${state.mode}:${state.map}:${state.round}`;
    const exploded = state.bomb.state === 'exploded';
    const changed = last.current.context !== context;
    if (changed || !exploded) setActive(false);
    if (exploded && state.connected && (changed || !last.current.exploded)) setActive(true);
    last.current = { context, exploded };
  }, [state.revision, state.mode, state.map, state.round, state.connected]);
  useEffect(() => { if (!active) return; const t = window.setTimeout(() => setActive(false),1520); return () => clearTimeout(t); },[active]);
  return active;
}

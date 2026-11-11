import type { GameState, Settings, TeamConfig } from '../../../packages/shared/types';

export function TeamAssignment({ settings, state, teams, warning, toggle, swap, bind }: {
  settings: Settings; state: GameState; teams: TeamConfig[]; warning: string;
  toggle: (enabled: boolean) => void; swap: () => void; bind: () => void;
}) {
  const canBind = state.mode === 'live' && state.connected && (state.broadcastAt ?? Date.now()) - state.receivedAt <= settings.staleAfterMs && ['T', 'CT'].every(side => state.players.some(p => p.side === side));
  return <section className="panel editor-section team-assignment">
    <div className="section-heading"><h2>Кто за какую сторону</h2><p>Сначала проверьте команды и игроков ниже. T всегда слева, CT справа.</p></div>
    <div className="checkbox-row"><label><input type="checkbox" checked={settings.match.autoSides !== false} onChange={e => toggle(e.target.checked)} /> Автоматически определять стороны по игрокам</label></div>
    <div className="two-column assignment-preview">{[...teams].sort((a, b) => a.side === b.side ? 0 : a.side === 'T' ? -1 : 1).map(team => {
      const players = state.players.filter(p => p.side === team.side);
      return <div key={team.id}><strong>{team.side} · {team.side === 'T' ? 'слева' : 'справа'} — {team.name}</strong><p>{players.length ? players.map(p => p.name).join(' · ') : 'Ожидаем игроков из CS2'}</p><small>Сохранено SteamID: {new Set([...team.steamIds, ...(team.roster ?? []).map(p => p.steamId)]).size}</small></div>;
    })}</div>
    {warning && <p className="warning-note">{warning}</p>}
    <div className="button-row"><button type="button" className="button" onClick={swap}>Поменять стороны</button><button type="button" className="button" disabled={!canBind} onClick={bind}>Привязать текущих игроков</button></div>
    {!canBind && <p className="muted">Для привязки нужны свежие данные LIVE и игроки обеих сторон. Если включена ручная пауза HUD, сначала снимите её.</p>}
    <p className="muted">{settings.match.autoSides !== false ? 'Достаточно одного известного игрока на сервере: его команда определяется вместе с заменами на той же стороне.' : 'Ручной режим: стороны закреплены до вашей следующей коррекции. GSI их не поменяет.'} Изменения применятся после сохранения.</p>
    <details className="advanced-options"><summary>Ножевой раунд, замены и следующая карта</summary>
      <ol><li>Дождитесь игроков обеих команд в LIVE. Проверьте никнеймы под названиями команд.</li><li>Если команды перепутаны, нажмите «Поменять стороны». Это также включает ручной режим.</li><li>Нажмите «Привязать текущих игроков», затем «Сохранить изменения». Текущие составы заменят сохранённые SteamID, автоопределение включится.</li><li>После выбора стороны, смены половин и перехода на следующую карту HUD найдёт команды по сохранённым игрокам. Заново привязывать их не нужно.</li></ol>
      <p>Если заменён весь состав и не осталось ни одного известного игрока, проверьте стороны и повторите привязку. Пока совпадений нет, используются игроки, запомненные на текущей карте, затем её стартовые стороны. В ручном режиме стартовые стороны карты и SteamID не меняют ваш выбор.</p>
      <p>Привязка сохраняется в настройках текущего матча. Чтобы перенести её в библиотеку, отдельно сохраните команды в библиотеку.</p>
    </details>
  </section>;
}

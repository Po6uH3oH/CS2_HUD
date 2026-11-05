import { useEffect, useState } from 'react';
import type { WireSnapshot } from '../../../packages/shared/types';
import { defaultTitleTemplate, renderStreamTitle, titleVariables } from '../../../packages/core/stream-title';
import { api } from './api';

interface TwitchStatus {
  clientId: string; template: string; enabled: boolean; connected: boolean; channel: string;
  pending: { userCode: string; url: string; expires: number } | null;
  error: string; lastTitle: string; lastSync: number | null; busy: boolean;
}
export function TwitchPanel({ snapshot }: { snapshot: WireSnapshot }) {
  const [status, setStatus] = useState<TwitchStatus | null>(null);
  const [clientId, setClientId] = useState('');
  const [template, setTemplate] = useState(defaultTitleTemplate);
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  useEffect(() => {
    let alive = true, initialized = false;
    const poll = async () => {
      try {
        const next = await api<TwitchStatus>('/twitch');
        if (!alive) return;
        setStatus(next);
        if (!initialized) { setClientId(next.clientId); setTemplate(next.template); setEnabled(next.enabled); initialized = true; }
      } catch { if (alive) setError('Нет связи с сервером HUD.'); }
    };
    void poll(); const timer = setInterval(poll, 2000);
    return () => { alive = false; clearInterval(timer); };
  }, []);
  const preview = renderStreamTitle(template, snapshot.state, snapshot.settings);
  const dirty = !!status && (clientId !== status.clientId || template !== status.template || enabled !== status.enabled);
  const action = async (path: string, text: string, body: unknown = {}) => {
    setBusy(true); setError(''); setMessage('');
    try {
      const next = await api<TwitchStatus>(path, body);
      setStatus(next); setEnabled(next.enabled); setMessage(text);
    } catch (e) { setError((e as Error).message); }
    finally { setBusy(false); }
  };
  const disabled = busy || !status;
  return <section className="panel" style={{ padding: 24, marginBottom: 20 }}>
    <div className="panel-heading"><h2>Twitch · название трансляции</h2><span className="badge">{status?.connected ? status.channel : 'Не подключён'}</span></div>
    <p className="info-note">Название обновляется при изменении команд и счёта. Демо и данные при потере связи в Twitch не отправляются.</p>
    <details className="advanced-options"><summary>Первое подключение — где взять Client ID</summary>
      <p className="info-note">В <a href="https://dev.twitch.tv/console" target="_blank" rel="noreferrer">консоли разработчика Twitch</a> нажмите «Подать заявку» на приложение и выберите тип клиента «Виден всем» (Public). Для регистрации нужен аккаунт с 2FA. Если требуется Redirect URL, укажите http://localhost — вход здесь проходит через одноразовый код. Скопируйте Client ID в поле ниже. Пароль, ключ трансляции и Client Secret не нужны.</p>
    </details>
    <label className="field">Client ID приложения Twitch<input value={clientId} onChange={e => setClientId(e.target.value.trim())} autoComplete="off" placeholder="Из консоли разработчика Twitch" /></label>
    <label className="field">Шаблон названия<textarea rows={3} maxLength={1000} value={template} onChange={e => setTemplate(e.target.value)} /></label>
    <div className="button-row" style={{ flexWrap: 'wrap' }}>{Object.entries(titleVariables).map(([key, description]) => <button key={key} className="button" title={description} onClick={() => setTemplate(v => `${v}{${key}}`)}>{`{${key}}`}</button>)}</div>
    <p className="info-note">team1 — {snapshot.settings.teams[0].name}; team2 — {snapshot.settings.teams[1].name}. Этот порядок сохраняется при смене сторон T/CT. score1 / score2 — счёт по раундам на текущей карте; maps1 / maps2 — счёт серии из вкладки «Матч». map — карта, bo — BO1/BO3/BO5, tournament — турнир. После импорта FACEIT используются названия из HUD.</p>
    <div className="panel" style={{ padding: 16, margin: '16px 0', overflowWrap: 'anywhere' }}><small>Предпросмотр · {preview.length}/140</small><p style={{ fontSize: 18, marginTop: 8 }}>{preview.title || 'Введите название'}</p></div>
    {preview.error && <p className="warning-note">{preview.error}</p>}
    {!preview.ready && <p className="info-note">Только предпросмотр: ожидаются актуальные данные в режиме «Матч».</p>}
    <label className="field"><span><input type="checkbox" checked={enabled} onChange={e => setEnabled(e.target.checked)} /> Автоматически обновлять название на Twitch</span></label>
    <div className="button-row" style={{ flexWrap: 'wrap' }}>
      <button className="button primary" disabled={disabled || !!preview.error} onClick={() => action('/twitch/settings', 'Настройки Twitch сохранены.', { clientId, template, enabled })}>Сохранить</button>
      <button className="button" disabled={disabled || dirty || !clientId} onClick={() => action('/twitch/connect', 'Откройте Twitch и подтвердите вход владельцем канала.')}>Подключить Twitch</button>
      <button className="button" disabled={disabled || dirty || !status?.connected || !preview.ready || !!preview.error} onClick={() => action('/twitch/apply', 'Название обновлено на Twitch.')}>Обновить сейчас</button>
      <button className="button" disabled={disabled || (!status?.connected && !status?.pending)} onClick={() => action('/twitch/disconnect', 'Twitch отключён. Автообновление остановлено.')}>Отключить</button>
    </div>
    {dirty && <p className="info-note">Есть несохранённые изменения.</p>}
    {status?.pending && <div className="info-note"><p>Код входа: <strong>{status.pending.userCode}</strong></p><a className="button" href={status.pending.url} target="_blank" rel="noreferrer">Открыть Twitch и подтвердить</a><p>Войдите владельцем нужного канала. После подтверждения подключение появится здесь автоматически.</p></div>}
    {status?.connected && <p className="info-note">Канал: {status.channel}. Автообновление {status.enabled ? 'включено' : 'выключено'}. Отправка — после 3 секунд стабильного состояния, не чаще раза в 15 секунд. Подключение само по себе название не меняет.</p>}
    {status?.lastSync && <p className="info-note">Отправлено в {new Date(status.lastSync).toLocaleTimeString()}: {status.lastTitle}</p>}
    {(error || status?.error) && <p className="warning-note">{error || status?.error}</p>}
    {message && <p className="info-note">{message}</p>}
  </section>;
}

import type { GameState, Settings } from '../../../packages/shared/types.js';
import { defaultTitleTemplate, renderStreamTitle } from '../../../packages/core/stream-title.js';

const scope = 'channel:manage:broadcast';
export interface TwitchSettings { clientId: string; template: string; enabled: boolean }
export interface TwitchStored extends TwitchSettings { accessToken?: string; refreshToken?: string; userId?: string; login?: string }
interface Options {
  stored?: Partial<TwitchStored>; save: (value: TwitchStored) => void;
  snapshot: () => { state: GameState; settings: Settings }; fetch?: typeof fetch; now?: () => number;
}
export class TwitchError extends Error {
  constructor(message: string, readonly status = 400) { super(message); }
}
export class TwitchTitleService {
  private config: TwitchStored;
  private fetcher: typeof fetch;
  private now: () => number;
  private disposed = false;
  private controller = new AbortController();
  private busy = false;
  private validatedAt: number | null = null;
  private expiresAt = 0;
  private retryAt = 0;
  private failures = 0;
  private lastAttempt = -Infinity;
  private candidate = '';
  private candidateSince = 0;
  private lastTitle = '';
  private lastSync: number | null = null;
  private error = '';
  private pending?: { code: string; userCode: string; url: string; expires: number; interval: number; next: number };

  constructor(private options: Options) {
    this.config = { clientId: '', template: defaultTitleTemplate, enabled: false, ...options.stored };
    this.fetcher = options.fetch ?? fetch; this.now = options.now ?? Date.now;
  }
  private persist() { if (!this.disposed) this.options.save({ ...this.config }); }
  private preview() { const { state, settings } = this.options.snapshot(); return renderStreamTitle(this.config.template, state, settings); }
  status() {
    return { clientId: this.config.clientId, template: this.config.template, enabled: this.config.enabled,
      connected: !!this.config.accessToken && this.validatedAt !== null, channel: this.config.login ?? '',
      pending: this.pending ? { userCode: this.pending.userCode, url: this.pending.url, expires: this.pending.expires } : null,
      preview: this.preview(), error: this.error, lastTitle: this.lastTitle, lastSync: this.lastSync, busy: this.busy };
  }
  private idle() { if (this.busy) throw new TwitchError('Twitch обрабатывает запрос. Повторите через несколько секунд.', 409); }
  configure(input: TwitchSettings) {
    this.idle();
    const { state, settings } = this.options.snapshot();
    const preview = renderStreamTitle(input.template, state, settings);
    if (preview.error) throw new TwitchError(preview.error);
    if (input.clientId !== this.config.clientId) this.clearConnection();
    this.config = { ...this.config, ...input }; this.candidate = ''; this.error = ''; this.persist();
  }
  private clearConnection() {
    delete this.config.accessToken; delete this.config.refreshToken; delete this.config.userId; delete this.config.login;
    this.config.enabled = false; this.validatedAt = null; this.pending = undefined; this.lastTitle = ''; this.lastSync = null;
  }
  disconnect() { this.idle(); this.clearConnection(); this.error = ''; this.persist(); }
  close() { this.disposed = true; this.controller.abort(); }
  private async request(url: string, init?: RequestInit) {
    try { return await this.fetcher(url, { ...init, signal: AbortSignal.any([this.controller.signal, AbortSignal.timeout(10000)]) }); }
    catch { throw new TwitchError('Twitch недоступен. Проверьте интернет; попытка будет повторена.', 503); }
  }
  private form(path: string, body: Record<string, string>) {
    return this.request(`https://id.twitch.tv/oauth2/${path}`, { method: 'POST', body: new URLSearchParams(body) });
  }
  async connect() {
    this.idle();
    if (!this.config.clientId) throw new TwitchError('Сначала укажите Client ID публичного приложения Twitch.');
    this.busy = true;
    try {
      const response = await this.form('device', { client_id: this.config.clientId, scopes: scope });
      if (!response.ok) throw new TwitchError('Не удалось начать вход. Проверьте Client ID и тип приложения Public.');
      const data = await response.json();
      if (!data.device_code || !data.user_code || !Number.isFinite(data.expires_in)) throw new TwitchError('Twitch вернул неполные данные входа.', 502);
      const url = new URL(data.verification_uri);
      if (url.protocol !== 'https:' || !['www.twitch.tv', 'twitch.tv'].includes(url.hostname)) throw new TwitchError('Twitch вернул неизвестный адрес входа.', 502);
      this.clearConnection(); this.persist(); this.error = ''; this.retryAt = 0;
      const interval = Math.max(5, Number(data.interval) || 5) * 1000;
      this.pending = { code: data.device_code, userCode: data.user_code, url: url.href, expires: this.now() + data.expires_in * 1000, interval, next: this.now() + interval };
    } finally { this.busy = false; }
  }
  private async acceptToken(data: any) {
    if (typeof data.access_token !== 'string' || typeof data.refresh_token !== 'string') throw new TwitchError('Не удалось получить разрешение Twitch.', 401);
    this.config.accessToken = data.access_token; this.config.refreshToken = data.refresh_token;
    // Device-flow refresh tokens rotate: persist the replacement before any later request.
    this.persist();
    this.validatedAt = null;
    await this.validate(false);
  }
  private async validate(canRefresh = true) {
    const response = await this.request('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${this.config.accessToken}` } });
    if (response.status === 401 && canRefresh && this.config.refreshToken) { await this.refresh(); return; }
    if (response.status === 401) { this.clearConnection(); this.persist(); throw new TwitchError('Доступ Twitch истёк или отозван. Подключите канал заново.', 401); }
    if (!response.ok) throw new TwitchError('Не удалось проверить разрешение Twitch.', 503);
    const data = await response.json();
    if (data.client_id !== this.config.clientId || !data.user_id || !data.scopes?.includes(scope)) {
      this.clearConnection(); this.persist(); throw new TwitchError('Нет разрешения изменять название канала. Подключитесь заново.', 403);
    }
    this.config.userId = data.user_id; this.config.login = data.login;
    this.validatedAt = this.now(); this.expiresAt = this.now() + data.expires_in * 1000; this.persist();
  }
  private async refresh() {
    const response = await this.form('token', { client_id: this.config.clientId, grant_type: 'refresh_token', refresh_token: this.config.refreshToken ?? '' });
    if (response.status === 400 || response.status === 401) { this.clearConnection(); this.persist(); throw new TwitchError('Подключите Twitch заново: разрешение истекло.', 401); }
    if (!response.ok) throw new TwitchError('Не удалось продлить подключение Twitch.', 503);
    await this.acceptToken(await response.json());
  }
  private async pollLogin() {
    const pending = this.pending;
    if (!pending) return;
    if (this.now() >= pending.expires) { this.pending = undefined; throw new TwitchError('Код входа истёк. Нажмите «Подключить Twitch» ещё раз.'); }
    if (this.now() < pending.next) return;
    pending.next = this.now() + pending.interval;
    const response = await this.form('token', { client_id: this.config.clientId, device_code: pending.code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' });
    const data = await response.json();
    if (!response.ok) {
      const reason = String(data.message ?? data.error ?? '').toLowerCase();
      if (/authorization_pending|authorization pending/.test(reason)) return;
      if (/slow_down|slow down/.test(reason) || response.status === 429) { pending.interval += 5000; pending.next = this.now() + pending.interval; return; }
      if (response.status >= 500) throw new TwitchError('Twitch временно недоступен.', 503);
      this.pending = undefined; throw new TwitchError('Вход Twitch не подтверждён. Попробуйте подключиться заново.');
    }
    this.pending = undefined; await this.acceptToken(data); this.error = '';
  }
  private async ensureToken() {
    if (!this.config.accessToken) throw new TwitchError('Сначала подключите канал Twitch.');
    if (this.validatedAt !== null && this.expiresAt - this.now() < 120000) await this.refresh();
    else if (this.validatedAt === null || this.now() - this.validatedAt >= 3600000) await this.validate();
  }
  private async publish(title: string, retry = true): Promise<void> {
    const response = await this.request(`https://api.twitch.tv/helix/channels?broadcaster_id=${encodeURIComponent(this.config.userId!)}`, {
      method: 'PATCH', headers: { Authorization: `Bearer ${this.config.accessToken}`, 'Client-Id': this.config.clientId, 'Content-Type': 'application/json' }, body: JSON.stringify({ title }),
    });
    if (response.status === 401 && retry) { await this.refresh(); return this.publish(title, false); }
    if (response.status === 429) {
      const reset = Number(response.headers.get('Ratelimit-Reset')) * 1000;
      this.retryAt = Math.max(this.now() + 60000, Number.isFinite(reset) ? reset : 0);
      throw new TwitchError('Twitch ограничил частоту обновлений. HUD повторит попытку позже.', 429);
    }
    if (!response.ok) throw new TwitchError(`Twitch не принял название (HTTP ${response.status}). Проверьте подключение и шаблон.`, 502);
    this.lastTitle = title; this.lastSync = this.now(); this.error = ''; this.failures = 0;
  }
  async apply() {
    this.idle();
    const preview = this.preview();
    if (preview.error) throw new TwitchError(preview.error);
    if (!preview.ready) throw new TwitchError('Нужны актуальные данные матча в режиме «Матч». Демо не отправляется в Twitch.');
    if (this.now() < this.retryAt || this.now() - this.lastAttempt < 15000) throw new TwitchError('Подождите перед следующим обновлением Twitch.', 429);
    this.busy = true;
    try {
      await this.ensureToken();
      const latest = this.preview();
      if (!latest.ready || latest.error) throw new TwitchError(latest.error ?? 'Данные матча больше не актуальны.');
      this.lastAttempt = this.now(); await this.publish(latest.title);
    }
    catch (error) { this.failure(error); throw error; }
    finally { this.busy = false; }
  }
  private failure(error: unknown) {
    this.error = error instanceof TwitchError ? error.message : 'Ошибка подключения Twitch.';
    this.retryAt = Math.max(this.retryAt, this.now() + Math.min(120000, 5000 * 2 ** this.failures++));
  }
  async tick() {
    if (this.disposed || this.busy || this.now() < this.retryAt) return;
    this.busy = true;
    try {
      if (this.pending) { await this.pollLogin(); return; }
      if (!this.config.accessToken) return;
      await this.ensureToken();
      if (!this.config.enabled) return;
      const preview = this.preview();
      if (!preview.ready || preview.error) { this.candidate = ''; return; }
      if (preview.title !== this.candidate) { this.candidate = preview.title; this.candidateSince = this.now(); return; }
      if (preview.title === this.lastTitle || this.now() - this.candidateSince < 3000 || this.now() - this.lastAttempt < 15000) return;
      this.lastAttempt = this.now(); await this.publish(preview.title);
    } catch (error) { if (!this.disposed) this.failure(error); }
    finally { this.busy = false; }
  }
}

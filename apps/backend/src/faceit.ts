export class FaceitError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export interface FaceitOptions {
  apiKey: () => string;
  fetch?: typeof globalThis.fetch;
  sleep?: (milliseconds: number) => Promise<void>;
  now?: () => number;
  ttlMs?: number;
}

const validId = (id: string): string => {
  if (!/^[a-zA-Z0-9_-]{1,100}$/.test(id)) throw new FaceitError('Некорректный FACEIT ID', 400);
  return encodeURIComponent(id);
};

/** Только сервер обращается к фиксированному официальному origin; клиент не задаёт URL. */
export class FaceitClient {
  private cache = new Map<string, { expires: number; value: unknown }>();
  private pending = new Map<string, Promise<unknown>>();
  private fetcher: typeof globalThis.fetch;
  private sleep: (milliseconds: number) => Promise<void>;
  private now: () => number;
  private lastRequest = 0;
  private requestQueue: Promise<void> = Promise.resolve();
  private retryNotBefore = 0;

  constructor(private readonly options: FaceitOptions) {
    this.fetcher = options.fetch ?? globalThis.fetch;
    this.sleep = options.sleep ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
    this.now = options.now ?? Date.now;
  }

  clearCache(): void { this.cache.clear(); }
  hub(id: string): Promise<unknown> { return this.get(`/hubs/${validId(id)}`); }
  hubMatches(id: string, type: 'all' | 'ongoing' | 'upcoming' | 'past' = 'ongoing'): Promise<unknown> {
    return this.get(`/hubs/${validId(id)}/matches?type=${type}&limit=100`);
  }
  hubMembers(id: string): Promise<unknown> { return this.get(`/hubs/${validId(id)}/members?limit=50`); }
  match(id: string): Promise<unknown> { return this.get(`/matches/${validId(id)}`); }
  matchStats(id: string): Promise<unknown> { return this.get(`/matches/${validId(id)}/stats`); }
  team(id: string): Promise<unknown> { return this.get(`/teams/${validId(id)}`); }
  player(id: string): Promise<unknown> { return this.get(`/players/${validId(id)}`); }

  private async get(path: string): Promise<unknown> {
    const apiKey = this.options.apiKey();
    if (!apiKey) throw new FaceitError('FACEIT API Key не настроен. Доступен ручной режим.', 503);
    const cached = this.cache.get(path);
    if (cached && cached.expires > this.now()) return structuredClone(cached.value);
    if (this.retryNotBefore - this.now() > 10_000) throw new FaceitError('FACEIT ограничил частоту запросов. Повторите позже.', 429);
    const existing = this.pending.get(path);
    if (existing) return structuredClone(await existing);
    const request = this.request(path, apiKey);
    this.pending.set(path, request);
    try {
      const value = await request;
      if (this.cache.size >= 100) this.cache.delete(this.cache.keys().next().value!);
      this.cache.set(path, { expires: this.now() + (this.options.ttlMs ?? 30_000), value });
      return structuredClone(value);
    } finally { this.pending.delete(path); }
  }

  private async waitForSlot(): Promise<void> {
    const slot = this.requestQueue.then(async () => {
      const delay = Math.max(this.lastRequest + 350, this.retryNotBefore) - this.now();
      if (delay > 0) await this.sleep(delay);
      this.lastRequest = this.now();
    });
    this.requestQueue = slot.catch(() => {});
    await slot;
  }

  private async request(path: string, apiKey: string): Promise<unknown> {
    for (let attempt = 0; attempt < 3; attempt++) {
      await this.waitForSlot();
      let response: Response;
      try {
        response = await this.fetcher(`https://open.faceit.com/data/v4${path}`, {
          headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
          signal: AbortSignal.timeout(8_000), redirect: 'error',
        });
      } catch {
        if (attempt < 2) { await this.sleep(500 * 2 ** attempt); continue; }
        throw new FaceitError('FACEIT недоступен или превысил время ожидания', 502);
      }
      if (response.ok) return response.json();
      if (response.status === 429 || response.status >= 500) {
        const retry = response.headers.get('retry-after');
        const numeric = retry === null ? NaN : Number(retry);
        const requested = Number.isFinite(numeric) ? numeric * 1000 : retry ? Date.parse(retry) - this.now() : 0;
        const delay = Math.max(500 * 2 ** attempt, Number.isFinite(requested) ? requested : 0);
        // Длинный Retry-After не держит HTTP-запрос оператора открытым; cooldown сохраняется.
        this.retryNotBefore = this.now() + Math.min(delay, 300_000);
        if (attempt < 2 && delay <= 10_000) continue;
        throw new FaceitError(response.status === 429 ? 'FACEIT ограничил частоту запросов. Повторите позже.' : 'FACEIT временно недоступен', response.status === 429 ? 429 : 502);
      }
      const label = response.status === 401 || response.status === 403 ? 'FACEIT отклонил API Key' : response.status === 404 ? 'Объект FACEIT не найден' : 'Ошибка ответа FACEIT';
      throw new FaceitError(label, response.status);
    }
    throw new FaceitError('FACEIT недоступен', 502);
  }
}

import { createHash, randomUUID } from 'node:crypto';
import WebSocket from 'ws';

export interface ObsStatus {
  connected: boolean;
  connecting: boolean;
  currentScene: string | null;
  error: string | null;
}

type Pending = { resolve: (value: Record<string, unknown>) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> };
const hash = (value: string): string => createHash('sha256').update(value).digest('base64');

/** Узкий obs-websocket v5 клиент: никакого произвольного RPC из браузера. */
export class ObsClient {
  status: ObsStatus = { connected: false, connecting: false, currentScene: null, error: null };
  private socket?: WebSocket;
  private pending = new Map<string, Pending>();
  private reconnect?: ReturnType<typeof setTimeout>;
  private desired?: { url: string; password: string };
  private failures = 0;
  private connecting?: Promise<void>;
  onChange: () => void = () => {};

  async connect(url: string, password: string): Promise<void> {
    const parsed = new URL(url);
    if (!['ws:', 'wss:'].includes(parsed.protocol) || parsed.username || parsed.password) throw new Error('Укажите ws:// или wss:// адрес OBS без встроенного пароля');
    if (this.connecting) return this.connecting;
    this.disconnect();
    this.desired = { url, password };
    this.connecting = this.open(url, password).finally(() => { this.connecting = undefined; });
    return this.connecting;
  }

  private open(url: string, password: string): Promise<void> {
    this.status = { ...this.status, connected: false, connecting: true, error: null };
    this.onChange();
    return new Promise((resolve, reject) => {
      let settled = false;
      const socket = new WebSocket(url, 'obswebsocket.json', { handshakeTimeout: 6_000, maxPayload: 2 * 1024 * 1024 });
      this.socket = socket;
      const timer = setTimeout(() => { socket.terminate(); fail('OBS не подтвердил подключение'); }, 8_000);
      const fail = (message: string) => {
        this.status = { ...this.status, connecting: false, connected: false, error: message };
        this.onChange();
        if (!settled) { settled = true; clearTimeout(timer); reject(new Error(message)); }
      };
      socket.on('message', raw => {
        try {
          const message = JSON.parse(raw.toString()) as { op: number; d: Record<string, any> };
          const data = message.d;
          if (message.op === 0) {
            const auth = data.authentication;
            socket.send(JSON.stringify({ op: 1, d: {
              rpcVersion: 1, eventSubscriptions: 4,
              ...(auth ? { authentication: hash(hash(password + String(auth.salt)) + String(auth.challenge)) } : {}),
            } }));
          } else if (message.op === 2) {
            settled = true; clearTimeout(timer); this.failures = 0;
            this.status = { ...this.status, connected: true, connecting: false, error: null };
            this.onChange(); resolve();
            void this.scenes().catch(() => {});
          } else if (message.op === 7) {
            const pending = this.pending.get(String(data.requestId));
            if (!pending) return;
            clearTimeout(pending.timer); this.pending.delete(String(data.requestId));
            if (data.requestStatus?.result) pending.resolve(data.responseData ?? {});
            else pending.reject(new Error(`OBS: запрос отклонён (${String(data.requestStatus?.code ?? 'unknown')})`));
          } else if (message.op === 5 && data.eventType === 'CurrentProgramSceneChanged') {
            this.status.currentScene = String(data.eventData.sceneName); this.onChange();
          }
        } catch { fail('Некорректный ответ OBS'); socket.close(); }
      });
      socket.on('error', () => fail('Не удалось подключиться к OBS. Проверьте адрес и WebSocket Server.'));
      socket.on('close', (code) => {
        if (this.socket !== socket) return;
        fail(code === 4009 ? 'OBS отклонил пароль' : 'Соединение с OBS закрыто');
        for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('OBS отключён')); }
        this.pending.clear();
        if (this.desired && code !== 4009) {
          const settings = this.desired;
          this.reconnect = setTimeout(() => {
            void this.open(settings.url, settings.password).catch(() => {});
          }, Math.min(30_000, 1_000 * 2 ** this.failures++));
          this.reconnect.unref();
        }
      });
    });
  }

  private request(type: string, data: Record<string, unknown> = {}): Promise<Record<string, unknown>> {
    if (!this.status.connected || this.socket?.readyState !== WebSocket.OPEN) return Promise.reject(new Error('OBS не подключён'));
    const requestId = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { this.pending.delete(requestId); reject(new Error('OBS не ответил вовремя')); }, 6_000);
      this.pending.set(requestId, { resolve, reject, timer });
      this.socket!.send(JSON.stringify({ op: 6, d: { requestType: type, requestId, requestData: data } }));
    });
  }

  async scenes(): Promise<Record<string, unknown>> {
    const result = await this.request('GetSceneList');
    this.status.currentScene = typeof result.currentProgramSceneName === 'string' ? result.currentProgramSceneName : null;
    this.onChange();
    return result;
  }
  async setScene(sceneName: string): Promise<void> { await this.request('SetCurrentProgramScene', { sceneName }); }
  items(sceneName: string): Promise<Record<string, unknown>> { return this.request('GetSceneItemList', { sceneName }); }
  async setItem(sceneName: string, sceneItemId: number, enabled: boolean): Promise<void> {
    await this.request('SetSceneItemEnabled', { sceneName, sceneItemId, sceneItemEnabled: enabled });
  }

  disconnect(): void {
    this.desired = undefined;
    clearTimeout(this.reconnect);
    const socket = this.socket;
    this.socket = undefined;
    if (socket) { socket.on('error', () => {}); socket.close(); }
    for (const request of this.pending.values()) { clearTimeout(request.timer); request.reject(new Error('OBS отключён')); }
    this.pending.clear();
    this.status = { connected: false, connecting: false, currentScene: null, error: null };
    this.onChange();
  }
}

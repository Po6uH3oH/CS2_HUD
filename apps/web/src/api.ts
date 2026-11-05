import { useEffect, useState } from 'react';
import type { Timer, WireSnapshot } from '../../../packages/shared/types';
export async function api<T>(path: string, body?: unknown, method?: string): Promise<T> {
  const response = await fetch('/api' + path, { method: method ?? (body === undefined ? 'GET' : 'POST'), headers: body === undefined ? {} : { 'Content-Type': 'application/json' }, credentials: 'same-origin', body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await response.text(); let data: any;
  try { data = text ? JSON.parse(text) : {}; } catch { throw new Error('Сервер вернул некорректный ответ'); }
  if (!response.ok) throw new Error((data.error ?? data.message ?? `Ошибка ${response.status}`) + (Array.isArray(data.details) && data.details.length ? `: ${data.details[0].path} — ${data.details[0].message}` : ''));
  return data as T;
}
export function useBroadcast() {
  const [snapshot, setSnapshot] = useState<WireSnapshot | null>(null);
  const [stopped, setStopped] = useState(false);
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    let socket: WebSocket | null = null, retry: ReturnType<typeof setTimeout> | undefined, disposed = false, attempt = 0, lastReceived = performance.now();
    const connect = () => {
      if (disposed) return;
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss:' : 'ws:'}//${location.host}/ws`);
      socket.onopen = () => { attempt = 0; setConnected(true); setStopped(false); };
      socket.onmessage = e => { try { const data = JSON.parse(e.data); const snap = data.state ? data : data.payload ?? data.data; if (snap?.state && snap?.settings) { lastReceived = performance.now(); setSnapshot(snap); } } catch { /* Следующий полный снимок восстановит состояние. */ } };
      socket.onerror = () => socket?.close();
      socket.onclose = event => {
        if (disposed) return;
        setConnected(false);
        if (event.code === 4001) { setSnapshot(null); setStopped(true); retry = setTimeout(connect, 2000); return; }
        setSnapshot(previous => {
          if (!previous) return previous;
          const next = structuredClone(previous), state = next.state;
          const now = (state.broadcastAt ?? state.receivedAt) + performance.now() - lastReceived;
          const freeze = (timer: Timer): Timer => ({ ...timer, remaining: timer.remaining === null ? null : Math.max(0, timer.remaining - (timer.running ? Math.max(0, now - timer.updatedAt) / 1000 : 0)), updatedAt: now, running: false });
          state.connected = false; state.broadcastAt = now;
          state.roundTimer = freeze(state.roundTimer); state.bomb.timer = freeze(state.bomb.timer); state.bomb.defuseTimer = freeze(state.bomb.defuseTimer);
          state.warnings = [...new Set([...state.warnings, 'Нет соединения с сервером HUD'])];
          return next;
        });
        retry = setTimeout(connect, Math.min(10000, 500 * 2 ** attempt++) + Math.random() * 200);
      };
    };
    api<WireSnapshot>('/state').then(s => { if (!disposed && s.state) setSnapshot(s); }).catch(() => {});
    connect(); return () => { disposed = true; clearTimeout(retry); socket?.close(); };
  }, []);
  return { snapshot, connected, stopped };
}

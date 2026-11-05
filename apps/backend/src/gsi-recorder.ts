const secret = /^(auth|token|password|api[_-]?key|authorization)$/i;
function clean(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(clean);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).filter(([key]) => !secret.test(key) && !['__proto__', 'constructor', 'prototype'].includes(key)).map(([key, v]) => [key, clean(v)]));
  return value;
}
export class GsiRecorder {
  private lines: string[] = [];
  private bytes = 0;
  private startedAt = 0;
  private active = false;
  private reason = '';
  status(now = Date.now()) {
    if (this.active && now - this.startedAt >= 120000) this.stop('Достигнут лимит 2 минуты');
    return { active: this.active, packets: this.lines.length, bytes: this.bytes, startedAt: this.startedAt, reason: this.reason };
  }
  start(now = Date.now()) {
    if (this.active) return this.status(now);
    this.lines = []; this.bytes = 0; this.startedAt = now; this.active = true; this.reason = '';
    return this.status(now);
  }
  stop(reason = 'Запись остановлена') { this.active = false; this.reason = reason; }
  capture(payload: unknown, now = Date.now()) {
    if (!this.status(now).active) return;
    const line = JSON.stringify({ receivedAt: now, payload: clean(payload) }) + '\n';
    const size = Buffer.byteLength(line);
    if (this.bytes + size > 32 * 1024 * 1024) { this.stop('Достигнут лимит 32 МБ'); return; }
    this.lines.push(line); this.bytes += size;
  }
  download() { this.stop(); return this.lines.join(''); }
}

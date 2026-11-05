import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type EntityKind = 'teams' | 'matches' | 'tournaments';

/** SQLite хранит настройки и сущности; текущее игровое состояние в БД не восстанавливается. */
export class Persistence {
  readonly database: DatabaseSync;

  constructor(filename: string) {
    if (filename !== ':memory:') mkdirSync(dirname(filename), { recursive: true });
    this.database = new DatabaseSync(filename);
    this.database.exec(`
      PRAGMA journal_mode=WAL;
      PRAGMA foreign_keys=ON;
      CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS entities (
        kind TEXT NOT NULL, id TEXT NOT NULL, value TEXT NOT NULL,
        updated_at TEXT NOT NULL, PRIMARY KEY (kind, id)
      );
      CREATE TABLE IF NOT EXISTS events (
        id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL,
        level TEXT NOT NULL, message TEXT NOT NULL
      );
    `);
  }

  get<T>(key: string): T | undefined {
    const row = this.database.prepare('SELECT value FROM settings WHERE key=?').get(key);
    return row ? JSON.parse(String(row.value)) as T : undefined;
  }

  set(key: string, value: unknown): void {
    this.database.prepare('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
      .run(key, JSON.stringify(value));
  }

  list<T>(kind: EntityKind): T[] {
    return this.database.prepare('SELECT value FROM entities WHERE kind=? ORDER BY updated_at DESC').all(kind)
      .map(row => JSON.parse(String(row.value)) as T);
  }

  find<T>(kind: EntityKind, id: string): T | undefined {
    const row = this.database.prepare('SELECT value FROM entities WHERE kind=? AND id=?').get(kind, id);
    return row ? JSON.parse(String(row.value)) as T : undefined;
  }

  save<T extends { id: string }>(kind: EntityKind, value: T): T {
    this.database.prepare('INSERT INTO entities(kind,id,value,updated_at) VALUES(?,?,?,?) ON CONFLICT(kind,id) DO UPDATE SET value=excluded.value,updated_at=excluded.updated_at')
      .run(kind, value.id, JSON.stringify(value), new Date().toISOString());
    return value;
  }

  remove(kind: EntityKind, id: string): boolean {
    return this.database.prepare('DELETE FROM entities WHERE kind=? AND id=?').run(kind, id).changes !== 0;
  }

  event(level: 'info' | 'warning' | 'error', message: string): void {
    this.database.prepare('INSERT INTO events(at,level,message) VALUES(?,?,?)').run(new Date().toISOString(), level, message.slice(0, 500));
    this.database.exec('DELETE FROM events WHERE id NOT IN (SELECT id FROM events ORDER BY id DESC LIMIT 250)');
  }

  events(): Array<{ at: string; level: string; message: string }> {
    return this.database.prepare('SELECT at,level,message FROM events ORDER BY id DESC LIMIT 100').all()
      .map(row => ({ at: String(row.at), level: String(row.level), message: String(row.message) }));
  }

  close(): void { this.database.close(); }
}

import { openDB, type DBSchema, type IDBPDatabase } from 'idb';

/**
 * The outbox is the heart of offline scoring.
 *
 * Every tap, station confirmation and dispute is written here first (IndexedDB on the
 * phone), then the Syncer sends items to the server in order. Taps carry their own
 * UUID, so sending one twice is harmless: the server answers "duplicate".
 *
 * Items stay in the outbox after they are sent (status "sent") so the station screen
 * can still show what was scored; old items are pruned after a day.
 */

export type Result = 'hit' | 'miss';
export type TapKind = 'official' | 'practice';

export interface TapPayload {
  id: string;
  shooter_id: string;
  station_id: string;
  squad_id: string;
  target_no: number;
  result: Result;
  kind: TapKind;
  device_id: string;
  device_ts: string;
  supersedes_id?: string;
}

export interface ConfirmPayload {
  squad_id: string;
  station_id: string;
}

export interface DisputePayload {
  squad_id: string;
  station_id: string;
  shooter_id: string;
  note: string;
}

export type OutboxItem =
  | { seq?: number; kind: 'tap'; payload: TapPayload; status: ItemStatus; reason?: string; createdAt: number }
  | { seq?: number; kind: 'confirm'; payload: ConfirmPayload; status: ItemStatus; reason?: string; createdAt: number }
  | { seq?: number; kind: 'dispute'; payload: DisputePayload; status: ItemStatus; reason?: string; createdAt: number };

/** pending: not yet accepted by the server. sent: stored. rejected: the server refused it (shown to the scorer). */
export type ItemStatus = 'pending' | 'sent' | 'rejected';

interface OutboxDB extends DBSchema {
  items: {
    key: number;
    value: OutboxItem & { seq: number };
    indexes: { status: ItemStatus };
  };
}

const DB_NAME = 'clay-scoring';
const DB_VERSION = 1;

export class Outbox {
  private dbp: Promise<IDBPDatabase<OutboxDB>>;
  private listeners = new Set<() => void>();

  constructor(name = DB_NAME) {
    this.dbp = openDB<OutboxDB>(name, DB_VERSION, {
      upgrade(db) {
        const store = db.createObjectStore('items', { keyPath: 'seq', autoIncrement: true });
        store.createIndex('status', 'status');
      },
    });
  }

  /** Subscribe to changes (for "N waiting to send" badges). Returns an unsubscribe function. */
  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    for (const fn of this.listeners) fn();
  }

  async add(item: Omit<OutboxItem, 'status' | 'createdAt' | 'seq'>): Promise<number> {
    const db = await this.dbp;
    const seq = await db.add('items', { ...item, status: 'pending', createdAt: Date.now() } as OutboxItem & { seq: number });
    this.emit();
    return seq;
  }

  /** Pending items in the order they were created. */
  async pending(): Promise<(OutboxItem & { seq: number })[]> {
    const db = await this.dbp;
    const items = await db.getAllFromIndex('items', 'status', 'pending');
    return items.sort((a, b) => a.seq - b.seq);
  }

  async all(): Promise<(OutboxItem & { seq: number })[]> {
    const db = await this.dbp;
    return db.getAll('items');
  }

  async pendingCount(): Promise<number> {
    const db = await this.dbp;
    return db.countFromIndex('items', 'status', 'pending');
  }

  async rejected(): Promise<(OutboxItem & { seq: number })[]> {
    const db = await this.dbp;
    return db.getAllFromIndex('items', 'status', 'rejected');
  }

  async mark(updates: { seq: number; status: ItemStatus; reason?: string }[]): Promise<void> {
    if (updates.length === 0) return;
    const db = await this.dbp;
    const tx = db.transaction('items', 'readwrite');
    for (const u of updates) {
      const item = await tx.store.get(u.seq);
      if (!item) continue;
      item.status = u.status;
      if (u.reason) item.reason = u.reason;
      await tx.store.put(item);
    }
    await tx.done;
    this.emit();
  }

  /** Drop sent items older than maxAgeMs (default one day). Pending/rejected items are never pruned. */
  async prune(maxAgeMs = 24 * 60 * 60 * 1000): Promise<number> {
    const db = await this.dbp;
    const cutoff = Date.now() - maxAgeMs;
    const tx = db.transaction('items', 'readwrite');
    let removed = 0;
    for (const item of await tx.store.getAll()) {
      if (item.status === 'sent' && item.createdAt < cutoff) {
        await tx.store.delete(item.seq);
        removed++;
      }
    }
    await tx.done;
    if (removed) this.emit();
    return removed;
  }
}

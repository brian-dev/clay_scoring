import type { ConfirmPayload, DisputePayload, Outbox, OutboxItem, TapPayload } from './outbox.ts';

export type TapResult = { id: string; status: 'ok' | 'duplicate' | 'rejected'; reason?: string };

/** Network-facing operations. The real one calls Supabase RPCs; tests use a fake. */
export interface Transport {
  recordTaps(taps: TapPayload[]): Promise<TapResult[]>;
  confirmStation(p: ConfirmPayload): Promise<void>;
  raiseDispute(p: DisputePayload): Promise<void>;
}

/**
 * retryable = no signal, server busy, or session expired: keep the item and try later.
 * not retryable = the server refused this item (e.g. station not complete): show it to the scorer.
 */
export class TransportError extends Error {
  constructor(message: string, readonly retryable: boolean) {
    super(message);
    this.name = 'TransportError';
  }
}

export interface SyncStatus {
  pending: number;
  rejected: number;
  syncing: boolean;
  lastSuccessAt: number | null;
  lastError: string | null;
}

const MAX_BATCH = 100;

type Seq = OutboxItem & { seq: number };

export interface SyncResult {
  sent: number;
  rejected: number;
  /** Stopped early because the network or server was unavailable. */
  interrupted: boolean;
}

/**
 * Sends pending outbox items in creation order.
 * Consecutive taps go in one batch; confirmations and disputes go one at a time, after
 * the taps queued before them. A network failure stops the run so order is preserved.
 */
export async function syncOnce(outbox: Outbox, transport: Transport): Promise<SyncResult> {
  const pending = await outbox.pending();
  let sent = 0;
  let rejected = 0;

  let i = 0;
  while (i < pending.length) {
    const item = pending[i]!;
    try {
      if (item.kind === 'tap') {
        const batch: Seq[] = [];
        while (i < pending.length && pending[i]!.kind === 'tap' && batch.length < MAX_BATCH) batch.push(pending[i++]!);
        const results = await transport.recordTaps(batch.map((b) => b.payload as TapPayload));
        const byId = new Map(results.map((r) => [r.id, r]));
        const updates = batch.map((b) => {
          const r = byId.get((b.payload as TapPayload).id);
          if (!r) return { seq: b.seq, status: 'pending' as const };
          if (r.status === 'rejected') {
            rejected++;
            return { seq: b.seq, status: 'rejected' as const, reason: r.reason ?? 'Rejected by the server.' };
          }
          sent++;
          return { seq: b.seq, status: 'sent' as const };
        });
        await outbox.mark(updates);
      } else {
        if (item.kind === 'confirm') await transport.confirmStation(item.payload);
        else await transport.raiseDispute(item.payload);
        await outbox.mark([{ seq: item.seq, status: 'sent' }]);
        sent++;
        i++;
      }
    } catch (err) {
      if (err instanceof TransportError && !err.retryable) {
        // Only single (non-tap) items reach here; a refused batch call is a server bug.
        await outbox.mark([{ seq: item.seq, status: 'rejected', reason: err.message }]);
        rejected++;
        if (item.kind === 'tap') return { sent, rejected, interrupted: false };
        i++;
        continue;
      }
      return { sent, rejected, interrupted: true };
    }
  }
  return { sent, rejected, interrupted: false };
}

/**
 * Keeps the outbox draining in the background: runs after every new item, when the
 * phone comes back online, and on a timer with exponential backoff after failures.
 */
export class Syncer {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private running = false;
  private again = false;
  private failures = 0;
  private stopped = true;
  private status: SyncStatus = { pending: 0, rejected: 0, syncing: false, lastSuccessAt: null, lastError: null };
  private listeners = new Set<(s: SyncStatus) => void>();
  private unsubscribeOutbox: (() => void) | null = null;

  constructor(
    private readonly outbox: Outbox,
    private readonly transport: Transport,
    private readonly opts: { idleMs?: number; maxBackoffMs?: number } = {},
  ) {}

  onStatus(fn: (s: SyncStatus) => void): () => void {
    this.listeners.add(fn);
    fn(this.status);
    return () => this.listeners.delete(fn);
  }

  private setStatus(patch: Partial<SyncStatus>) {
    this.status = { ...this.status, ...patch };
    for (const fn of this.listeners) fn(this.status);
  }

  private readonly onOnline = () => this.kick();

  start() {
    if (!this.stopped) return;
    this.stopped = false;
    this.unsubscribeOutbox = this.outbox.subscribe(() => void this.refreshCounts());
    if (typeof window !== 'undefined') window.addEventListener('online', this.onOnline);
    void this.refreshCounts();
    this.kick();
  }

  stop() {
    this.stopped = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.unsubscribeOutbox?.();
    if (typeof window !== 'undefined') window.removeEventListener('online', this.onOnline);
  }

  /** Sync now (coalesces with a run already in progress). */
  kick() {
    if (this.stopped) return;
    if (this.running) {
      this.again = true;
      return;
    }
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    void this.run();
  }

  private async refreshCounts() {
    const [pending, rejected] = await Promise.all([this.outbox.pendingCount(), this.outbox.rejected().then((r) => r.length)]);
    this.setStatus({ pending, rejected });
  }

  private async run() {
    this.running = true;
    this.setStatus({ syncing: true });
    let delay = this.opts.idleMs ?? 15_000;
    try {
      const result = await syncOnce(this.outbox, this.transport);
      if (result.interrupted) {
        this.failures++;
        delay = Math.min(2_000 * 2 ** (this.failures - 1), this.opts.maxBackoffMs ?? 60_000);
        this.setStatus({ lastError: 'No signal or server busy — will retry.' });
      } else {
        this.failures = 0;
        this.setStatus({ lastSuccessAt: Date.now(), lastError: null });
      }
    } catch (err) {
      this.failures++;
      delay = Math.min(2_000 * 2 ** (this.failures - 1), this.opts.maxBackoffMs ?? 60_000);
      this.setStatus({ lastError: err instanceof Error ? err.message : String(err) });
    } finally {
      this.running = false;
      this.setStatus({ syncing: false });
      await this.refreshCounts();
    }
    if (this.stopped) return;
    if (this.again) {
      this.again = false;
      this.kick();
      return;
    }
    this.timer = setTimeout(() => this.kick(), delay);
  }
}

import 'fake-indexeddb/auto';
import { describe, expect, it } from 'vitest';
import { Outbox, type TapPayload } from '../src/lib/outbox.ts';
import { syncOnce, TransportError, type TapResult, type Transport } from '../src/lib/sync.ts';

let dbn = 0;
const newOutbox = () => new Outbox(`test-${++dbn}`);

const tap = (id: string, target = 1): TapPayload => ({
  id,
  shooter_id: 'sh1',
  station_id: 'st1',
  squad_id: 'sq1',
  target_no: target,
  result: 'hit',
  kind: 'official',
  device_id: 'dev1',
  device_ts: new Date().toISOString(),
});

/** In-memory server: stores taps by id, can go offline, can refuse confirms. */
class FakeServer implements Transport {
  stored = new Map<string, TapPayload>();
  calls: string[] = [];
  offline = false;
  rejectTargetsAbove = Infinity;
  confirmError: TransportError | null = null;

  async recordTaps(taps: TapPayload[]): Promise<TapResult[]> {
    this.calls.push(`taps:${taps.length}`);
    if (this.offline) throw new TransportError('Failed to fetch', true);
    return taps.map((t) => {
      if (t.target_no > this.rejectTargetsAbove) return { id: t.id, status: 'rejected', reason: 'target out of range' };
      if (this.stored.has(t.id)) return { id: t.id, status: 'duplicate' };
      this.stored.set(t.id, t);
      return { id: t.id, status: 'ok' };
    });
  }
  async confirmStation() {
    this.calls.push('confirm');
    if (this.offline) throw new TransportError('Failed to fetch', true);
    if (this.confirmError) throw this.confirmError;
  }
  async raiseDispute() {
    this.calls.push('dispute');
    if (this.offline) throw new TransportError('Failed to fetch', true);
  }
}

describe('syncOnce', () => {
  it('sends queued taps in one batch, then the confirmation', async () => {
    const outbox = newOutbox();
    const server = new FakeServer();
    await outbox.add({ kind: 'tap', payload: tap('a', 1) });
    await outbox.add({ kind: 'tap', payload: tap('b', 2) });
    await outbox.add({ kind: 'confirm', payload: { squad_id: 'sq1', station_id: 'st1' } });

    const r = await syncOnce(outbox, server);
    expect(r).toEqual({ sent: 3, rejected: 0, interrupted: false });
    expect(server.calls).toEqual(['taps:2', 'confirm']);
    expect(await outbox.pendingCount()).toBe(0);
  });

  it('keeps everything queued while offline and sends it when the signal returns', async () => {
    const outbox = newOutbox();
    const server = new FakeServer();
    server.offline = true;
    await outbox.add({ kind: 'tap', payload: tap('a') });
    await outbox.add({ kind: 'confirm', payload: { squad_id: 'sq1', station_id: 'st1' } });

    expect((await syncOnce(outbox, server)).interrupted).toBe(true);
    expect(await outbox.pendingCount()).toBe(2);
    expect(server.calls).toEqual(['taps:1']); // stopped before the confirm: order preserved

    server.offline = false;
    expect(await syncOnce(outbox, server)).toEqual({ sent: 2, rejected: 0, interrupted: false });
    expect(server.stored.size).toBe(1);
  });

  it('treats a tap the server already has as sent (no double counting)', async () => {
    const outbox = newOutbox();
    const server = new FakeServer();
    server.stored.set('a', tap('a'));
    await outbox.add({ kind: 'tap', payload: tap('a') });
    expect(await syncOnce(outbox, server)).toEqual({ sent: 1, rejected: 0, interrupted: false });
    expect(server.stored.size).toBe(1);
  });

  it('marks refused taps as rejected with the reason and keeps going', async () => {
    const outbox = newOutbox();
    const server = new FakeServer();
    server.rejectTargetsAbove = 8;
    await outbox.add({ kind: 'tap', payload: tap('a', 9) });
    await outbox.add({ kind: 'tap', payload: tap('b', 1) });
    expect(await syncOnce(outbox, server)).toEqual({ sent: 1, rejected: 1, interrupted: false });
    const rejected = await outbox.rejected();
    expect(rejected).toHaveLength(1);
    expect(rejected[0]!.reason).toBe('target out of range');
  });

  it('a refused confirmation is surfaced, later items still go', async () => {
    const outbox = newOutbox();
    const server = new FakeServer();
    server.confirmError = new TransportError('2 target(s) still need a score before confirming.', false);
    await outbox.add({ kind: 'confirm', payload: { squad_id: 'sq1', station_id: 'st1' } });
    await outbox.add({ kind: 'dispute', payload: { squad_id: 'sq1', station_id: 'st1', shooter_id: 'sh1', note: '' } });
    expect(await syncOnce(outbox, server)).toEqual({ sent: 1, rejected: 1, interrupted: false });
    expect((await outbox.rejected())[0]!.reason).toMatch(/still need a score/);
  });

  it('splits large queues into batches of 100', async () => {
    const outbox = newOutbox();
    const server = new FakeServer();
    for (let i = 0; i < 230; i++) await outbox.add({ kind: 'tap', payload: tap(`t${i}`) });
    await syncOnce(outbox, server);
    expect(server.calls).toEqual(['taps:100', 'taps:100', 'taps:30']);
    expect(server.stored.size).toBe(230);
  });

  it('prunes old sent items but never pending ones', async () => {
    const outbox = newOutbox();
    const server = new FakeServer();
    await outbox.add({ kind: 'tap', payload: tap('a') });
    await syncOnce(outbox, server);
    await outbox.add({ kind: 'tap', payload: tap('b') });
    expect(await outbox.prune(-1)).toBe(1);
    expect(await outbox.pendingCount()).toBe(1);
  });
});

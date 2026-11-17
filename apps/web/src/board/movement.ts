import type { BoardRow, StandingsFile } from '@slayin/core';

/**
 * Works out what changed between two standings snapshots so the TV can animate it:
 * who moved up or down, whose score went up, who finished, and whether the lead changed.
 * Pure and deterministic so it can be unit tested.
 */

export interface RowChange {
  shooterId: string;
  /** Positive = moved up the board (better rank). */
  rankDelta: number;
  scoreDelta: number;
  justFinished: boolean;
}

export interface Mover {
  shooterId: string;
  name: string;
  text: string;
  kind: 'up' | 'leader' | 'finished' | 'division';
}

export interface Movement {
  changes: Map<string, RowChange>;
  /** Overall leader changed (and both snapshots have a leader). */
  newLeader: BoardRow | null;
  /** Short ticker lines, most notable first. */
  movers: Mover[];
}

const ordinal = (n: number) => {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`;
};

export function diffStandings(prev: StandingsFile | null, next: StandingsFile, topN = 10): Movement {
  const changes = new Map<string, RowChange>();
  const movers: Mover[] = [];
  if (!prev) return { changes, newLeader: null, movers };

  const before = new Map(prev.overall.map((r) => [r.shooterId, r]));
  for (const r of next.overall) {
    const p = before.get(r.shooterId);
    if (!p) continue;
    const change: RowChange = {
      shooterId: r.shooterId,
      rankDelta: p.rank - r.rank,
      scoreDelta: r.total - p.total,
      justFinished: r.finished && !p.finished,
    };
    if (change.rankDelta || change.scoreDelta || change.justFinished) changes.set(r.shooterId, change);

    // Ticker: notable climbs into or within the top N, and finishers in the top N.
    if (change.rankDelta >= 2 && r.rank <= topN) {
      movers.push({ shooterId: r.shooterId, name: r.name, kind: 'up', text: `${r.name} climbs ${change.rankDelta} to ${ordinal(r.rank)}` });
    } else if (change.justFinished && r.rank <= topN) {
      movers.push({ shooterId: r.shooterId, name: r.name, kind: 'finished', text: `${r.name} finishes with ${r.total}` });
    }
  }

  const prevLeader = prev.overall[0];
  const nextLeader = next.overall[0];
  const newLeader =
    prevLeader && nextLeader && prevLeader.shooterId !== nextLeader.shooterId && nextLeader.total > 0 ? nextLeader : null;
  if (newLeader) {
    movers.unshift({ shooterId: newLeader.shooterId, name: newLeader.name, kind: 'leader', text: `New leader: ${newLeader.name} with ${newLeader.total}` });
  }

  // Division lead changes.
  const prevDivLeader = new Map(prev.divisions.map((d) => [d.id, d.rows[0]?.shooterId]));
  for (const d of next.divisions) {
    const lead = d.rows[0];
    if (lead && prevDivLeader.get(d.id) && prevDivLeader.get(d.id) !== lead.shooterId && lead.total > 0) {
      movers.push({ shooterId: lead.shooterId, name: lead.name, kind: 'division', text: `${lead.name} takes the ${d.name} lead` });
    }
  }

  return { changes, newLeader, movers };
}

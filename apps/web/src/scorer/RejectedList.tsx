import { useEffect, useState } from 'react';
import type { Outbox, OutboxItem } from '../lib/outbox.ts';

/** Items the server refused, with its reason, so a scorer can get a referee to fix them. */
export function RejectedList({ outbox, onClose }: { outbox: Outbox; onClose: () => void }) {
  const [items, setItems] = useState<(OutboxItem & { seq: number })[]>([]);
  useEffect(() => {
    const load = () => void outbox.rejected().then(setItems);
    load();
    return outbox.subscribe(load);
  }, [outbox]);

  return (
    <div className="card stack">
      <span className="eyebrow">Needs attention</span>
      {items.length === 0 ? (
        <p style={{ margin: 0 }}>Nothing needs attention. Every score has been accepted or is waiting to send.</p>
      ) : (
        <>
          <p style={{ margin: 0 }}>The server refused these. Show this list to a referee.</p>
          {items.map((it) => (
            <div key={it.seq} className="error">
              <b>{it.kind === 'tap' ? `Target ${it.payload.target_no}` : it.kind === 'confirm' ? 'Station confirmation' : 'Dispute'}</b>: {it.reason}
            </div>
          ))}
        </>
      )}
      <button className="btn btn-line btn-sm" onClick={onClose}>Close</button>
    </div>
  );
}

import type { SyncStatus } from '../lib/sync.ts';

export function SyncBadge({ status }: { status: SyncStatus }) {
  if (status.rejected > 0) return <span className="sync bad">{status.rejected} need attention</span>;
  if (status.pending > 0) {
    return (
      <span className="sync wait">
        {status.lastError ? 'Saved on phone · ' : ''}
        {status.pending} to send
      </span>
    );
  }
  return <span className="sync ok">All sent</span>;
}

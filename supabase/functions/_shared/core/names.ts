// GENERATED from packages/core/src by scripts/sync-core.mjs. Do not edit here.
import type { AdultNameFormat, Shooter } from './types.ts';

const clean = (s: string): string => s.trim().replace(/\s+/g, ' ');

/**
 * Public display name.
 * Minors (under 18) are ALWAYS "First L." on every public view — this is a club rule,
 * not a setting. Adults follow the event's adultNameFormat.
 */
export function displayName(
  shooter: Pick<Shooter, 'firstName' | 'lastName' | 'isMinor'>,
  adultFormat: AdultNameFormat = 'full',
): string {
  const first = clean(shooter.firstName);
  const last = clean(shooter.lastName);
  const lastInitial = last ? `${last[0]!.toUpperCase()}.` : '';

  if (shooter.isMinor) return [first, lastInitial].filter(Boolean).join(' ');
  if (adultFormat === 'initial-last') {
    const firstInitial = first ? `${first[0]!.toUpperCase()}.` : '';
    return [firstInitial, last].filter(Boolean).join(' ');
  }
  return [first, last].filter(Boolean).join(' ');
}

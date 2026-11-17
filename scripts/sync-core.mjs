// Copies packages/core/src into supabase/functions/_shared/core so the Edge Function
// (bundled by the Supabase CLI from supabase/functions only) uses the exact same,
// tested scoring code as the app. `node scripts/sync-core.mjs --check` fails if stale.
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const src = new URL('../packages/core/src/', import.meta.url).pathname;
const dest = new URL('../supabase/functions/_shared/core/', import.meta.url).pathname;
const header = '// GENERATED from packages/core/src by scripts/sync-core.mjs. Do not edit here.\n';

if (process.argv.includes('--check')) {
  const stale = readdirSync(src).filter((f) => {
    try {
      return readFileSync(join(dest, f), 'utf8') !== header + readFileSync(join(src, f), 'utf8');
    } catch {
      return true;
    }
  });
  if (stale.length) {
    console.error(`supabase/functions/_shared/core is out of date (${stale.join(', ')}). Run: node scripts/sync-core.mjs`);
    process.exit(1);
  }
  console.log('shared core is in sync');
} else {
  rmSync(dest, { recursive: true, force: true });
  mkdirSync(dest, { recursive: true });
  for (const f of readdirSync(src)) {
    writeFileSync(join(dest, f), header + readFileSync(join(src, f), 'utf8'));
  }
  console.log(`copied ${readdirSync(src).length} files to supabase/functions/_shared/core`);
}

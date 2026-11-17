# Development guide

## Try it with no backend (demo mode)

```bash
pnpm install
pnpm dev            # http://localhost:5173
```

With no Supabase settings, the app runs entirely in the browser with made-up data:

- **Scoring:** open `/score`, event code `SLAYIN`, scorer PIN `1234` (referee `5678`). Type station codes `station-1`…`station-5` and squad codes `squad-1`, `squad-2`, `squad-3` or `squad-practice`.
- **Boards:** `/board`, `/tv` and `/me/squad-4` show a simulated shoot that advances one station every poll.
- **Rehearse no signal:** in the browser console run `window.__demoOffline = true`, tap some targets, then set it back to `false`.

## Tests

| Command | What it covers |
| --- | --- |
| `pnpm test` | Core scoring rules (`packages/core`) and the app's offline outbox, sync and station-scoring logic |
| `pnpm typecheck` | TypeScript across the workspace |
| `pnpm db:test` | Applies the migration and seed to a fresh Postgres and runs the SQL security/RPC tests. Needs a reachable Postgres via `PGHOST`/`PGUSER`/`PGPASSWORD` (on Linux: `sudo -u postgres pnpm db:test`) |
| `cd apps/web && pnpm exec playwright test` | End-to-end tests of the real app in demo mode on a phone viewport. Set `CHROME_PATH` to use an installed Chrome |
| `node scripts/sync-core.mjs --check` | The Edge Function's copy of the core rules matches `packages/core` |

CI runs all of these on every push.

## Local Supabase

Requires Docker and the Supabase CLI (`npx supabase`).

```bash
npx supabase start              # prints the local API URL and anon key
npx supabase db reset           # applies migrations + seed.sql
cp apps/web/.env.example apps/web/.env.local   # fill in URL, anon key, event id 00000000-0000-4000-8000-000000000001
pnpm dev
```

Rebuild standings manually while developing (the database only calls the function when its URL is configured):

```bash
npx supabase functions serve build-standings --env-file supabase/.env.local   # STANDINGS_SECRET=...
curl -X POST http://127.0.0.1:54321/functions/v1/build-standings \
  -H "x-standings-secret: $STANDINGS_SECRET" -H 'content-type: application/json' \
  -d '{"event_id":"00000000-0000-4000-8000-000000000001"}'
```

## How the pieces fit

- **All scoring writes go through database functions** (`record_taps`, `confirm_station`, `raise_dispute`, `resolve_dispute`). They validate everything and are the only write path; row-level security blocks direct writes.
- **Taps are append-only** with client-generated UUIDs. Re-sends are harmless; corrections supersede earlier records.
- **The phone saves first.** `apps/web/src/lib/outbox.ts` stores every tap, confirmation and dispute in IndexedDB; `sync.ts` sends them in order and backs off when there's no signal.
- **Public boards never query the database.** `build-standings` writes JSON files to the public `standings` bucket after each confirmation or dispute (at most once every 10 seconds), and the boards poll those files. Only staff screens would ever use realtime connections. This keeps us inside the Supabase free tier.
- **Edit scoring rules in `packages/core` only**, then run `node scripts/sync-core.mjs` to refresh the Edge Function's copy.

## Deploying (summary)

1. Create a free Supabase project. Enable **Anonymous sign-ins** (Authentication > Providers).
2. `npx supabase link` then `npx supabase db push` to apply the migration.
3. Deploy the function: `npx supabase functions deploy build-standings --no-verify-jwt` and set its secret: `npx supabase secrets set STANDINGS_SECRET=<random>`.
4. Enable the `pg_net` extension, then tell the database where the function is:
   ```sql
   insert into private.settings (key, value) values
     ('standings_function_url', 'https://<project>.supabase.co/functions/v1/build-standings'),
     ('standings_function_secret', '<same random secret>');
   ```
5. Host `apps/web/dist` on any static host with a single-page-app fallback to `index.html` (Cloudflare Pages, Netlify or GitHub Pages), with the `VITE_*` variables set at build time.
6. **Free tier:** projects pause after a week without activity. Resume the project a week before the pilot and the event.

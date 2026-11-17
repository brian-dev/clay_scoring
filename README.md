# Clay Scoring

Digital station scoring and live leaderboards for **Slayin' Clays**, the annual sporting clays fundraiser for the Poth FFA and Poth Shooting Sports booster clubs.

Volunteers at each station tap HIT or MISS on their own phones. Scores save on the phone first, sync when there's signal, and feed live leaderboards (overall, divisions, teams, personal scorecards and a clubhouse TV) that run entirely on Supabase's free tier.

- Spec: https://claude.ai/artifact/FH2Fd9rmaAxozLnFQy6iUL
- Booster club proposal: `docs/` (PDF shared separately)

## Layout

| Path | What it is |
| --- | --- |
| `packages/core` | Pure TypeScript scoring rules: effective scores, totals, rankings, countback, Lewis Class, minor display names, standings file builder. Shared by the app and the standings publisher. |
| `apps/web` | React + TypeScript + Vite app: scorer PWA, leaderboards, TV view, admin and referee consoles. |
| `supabase/` | Database migrations, row-level security, RPCs, seed data, and the `build-standings` Edge Function. |

## Key rules (enforced in code and tests)

- **Only independent scorers' records count.** Shadow (squad-entered) and practice scores never count.
- **The score log is append-only.** Every tap has a client-generated UUID, so a tap re-sent after a dropped connection is stored once. Corrections are new records that supersede the old one.
- **Minors are always "First L."** on every public view (phone leaderboards, TV, awards list).
- **Free tier.** Public screens poll cached standings files; only staff consoles use realtime connections.

## Getting started

Requirements: Node 20+, pnpm 9+, and (for the database) the Supabase CLI with Docker.

```bash
# one-time setup on a Mac
brew install node        # or with asdf: asdf install (reads .tool-versions)
npm install -g pnpm      # or: brew install pnpm

pnpm install
pnpm test          # core rules + app tests
pnpm typecheck
pnpm dev           # web app at http://localhost:5173
```

Local database:

```bash
npx supabase start             # local Postgres + auth + storage
npx supabase db reset          # apply migrations and seed data
```

See `docs/DEVELOPMENT.md` for details.

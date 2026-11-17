#!/usr/bin/env bash
# Applies the migration and seed to a fresh database and runs the SQL tests.
# Uses standard libpq env vars (PGHOST, PGUSER, PGPASSWORD, PGPORT).
# Locally on Linux: sudo -u postgres bash supabase/tests/run.sh
set -euo pipefail

cd "$(dirname "$0")/.."
DB="${TEST_DB:-clay_scoring_test}"
PSQL=(psql -v ON_ERROR_STOP=1 -q -X)

"${PSQL[@]}" -d postgres -c "drop database if exists ${DB} with (force)" -c "create database ${DB}" >/dev/null
"${PSQL[@]}" -d postgres -c "alter database ${DB} set search_path = \"\$user\", public, extensions" >/dev/null

"${PSQL[@]}" -d "$DB" -f tests/shim.sql >/dev/null
for f in migrations/*.sql; do
  echo "applying $f"
  "${PSQL[@]}" -d "$DB" -f "$f" >/dev/null
done
echo "seeding"
"${PSQL[@]}" -d "$DB" -f seed.sql >/dev/null
echo "running tests"
"${PSQL[@]}" -d "$DB" -f tests/database_test.sql 2>&1 | sed -e 's/^psql:[^ ]* NOTICE:  /  /' -e 's/^NOTICE:  /  /'

# CLAUDE.md

This file provides guidance for future code agents working in this repository.

## Project Overview

Check CX is an AI model health dashboard. It monitors OpenAI, Gemini, Anthropic, and compatible relay endpoints for availability, latency, ping latency, and error messages.

Current runtime is self-hosted:

- Next.js App Router
- TypeScript
- Postgres or SQLite storage
- Single-process polling
- Admin UI for configs, templates, Telegram push, site settings, and storage diagnostics

## Commands

```bash
pnpm install
pnpm dev
pnpm exec tsc --noEmit
pnpm lint
pnpm build
pnpm start
```

## Storage

Supported providers:

- `postgres`
- `sqlite`

Resolution order:

1. `DATABASE_PROVIDER=postgres|sqlite`
2. `DATABASE_URL` / `POSTGRES_URL` / `POSTGRES_PRISMA_URL` -> Postgres
3. Fallback to SQLite at `.sisyphus/local-data/app.db`

Postgres and SQLite auto-create the required tables at startup. Do not add removed third-party hosted database code or migration folders.

## Key Modules

```text
app/                 # Pages and API routes
components/          # Dashboard and admin UI
lib/core/            # Poller, dashboard aggregation, cache
lib/providers/       # Provider checks
lib/storage/         # Postgres / SQLite storage implementations
lib/database/        # History and availability facades
lib/admin/           # Admin auth, admin data, diagnostics
lib/notifications/   # Telegram push chain
```

## Detection Chain

The complete check path is:

```text
poller or Dashboard force refresh
  -> runProviderChecksAndPersist()
  -> runProviderChecks()
  -> historySnapshotStore.append()
  -> notifyTelegramForCheckResults()
  -> Dashboard/API aggregation
```

Keep this shared path intact. Manual refresh and scheduled polling should both write history and update the Telegram alert state machine.

## Telegram Rules

- Normal -> 3 consecutive failures -> failure push
- Failed -> 1 consecutive success -> recovery push
- Message prefix uses the configured project display name
- Push records store raw plain text; Telegram send formatting is applied at send time

## Polling

- Model check default interval: 300 seconds
- Official status default interval: 300 seconds
- `CHECK_POLL_INTERVAL_SECONDS` range: 15-600 seconds
- Single-process only; there is no database lease leader election

## Admin Entry

The admin path is configurable in site settings. When it is changed away from `/admin`, the canonical `/admin` route returns 404 and the custom catch-all route serves the admin pages.

## Validation

Before finalizing code changes, run:

```bash
pnpm exec tsc --noEmit
pnpm lint
pnpm build
```

For Docker changes, also check that the Dockerfile does not copy deleted paths and that local build compose still references valid files.

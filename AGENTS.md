# Repository Guidelines

## Project Structure & Module Organization

- `app/` hosts the App Router surface; `page.tsx` hydrates dashboard data and `app/api/dashboard/route.ts` exposes the refresh endpoint.
- `components/` contains interactive widgets such as `dashboard-view.tsx`, `status-timeline.tsx`, and shared primitives inside `components/ui/`.
- `lib/` carries domain logic: `core/` for polling and state, `providers/` for OpenAI/Anthropic/Gemini adapters, `database/` for history/stat facades, `storage/` for Postgres/SQLite persistence, `types/` for DTOs, and `utils/` for helpers like `cn`.
- Keep assets in `public/`. Database schema bootstrap for Postgres/SQLite lives in `lib/storage/shared.ts`.

## Build, Test, and Development Commands

- `pnpm install` syncs dependencies; re-run whenever `pnpm-lock.yaml` changes.
- `pnpm dev` launches the Next.js dev server configured via `.env`.
- `pnpm build` compiles the production bundle, while `pnpm start` serves that output for local smoke tests.
- `pnpm lint` runs ESLint; fix findings before pushing.

## Coding Style & Naming Conventions

Default to server components and add `"use client"` only when hooks or browser APIs are required. TypeScript files use two-space indentation, `const` bindings, and descriptive PascalCase component names (`DashboardView`). Sort imports Node -> packages -> `@/` aliases, avoiding long relative paths. Compose styling through Tailwind utility classes plus `clsx`/`tailwind-merge`, and move repeated variants into `components/ui/`.

## Testing Guidelines

Automated tests are not wired up yet. Until a runner is introduced, validate by running `pnpm exec tsc --noEmit`, `pnpm lint`, `pnpm build`, exercising dashboard refreshes, and checking Postgres/SQLite startup paths.

## Commit & Pull Request Guidelines

History follows Conventional Commits (`feat:`, `fix:`, `chore:`, `refactor:`). Keep each commit scoped to a single concern. Pull requests should describe the change, link issues, attach UI screenshots/GIFs when visuals move, and list the commands executed.

## Security & Configuration Tips

Copy `.env.example`, fill in Postgres or SQLite settings plus `ADMIN_SESSION_SECRET`, and never commit real keys. Provider credentials belong in the `check_configs` table via the admin UI or trusted SQL imports. Telegram Bot Token and Chat ID are configured in the admin UI and should be treated as secrets.

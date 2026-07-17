# CLAUDE.md

This file provides architectural guidance for agents working in this repository. Read `AGENTS.md`
first for mandatory invariants and the change checklist. When documentation and code differ, verify the
current code and update the documentation if the mismatch matters.

## Product and workspace

Bijustubu is a per-user data workspace. Users can:

- import CSV, Excel, PDF, DOCX, SQL, and text into structured MongoDB collections;
- edit rows, fields, collection metadata, and relations;
- generate and refine saved dashboards from natural-language prompts;
- upload documents to a Dify-backed knowledge base and chat over retrieved excerpts;
- see deterministic workspace findings and request an AI insight snapshot from the Overview page.

The repository is a pnpm monorepo with `backend/` (Express 5, TypeScript, Mongoose, Zod) and
`frontend/` (React 19, Vite, TypeScript, Tailwind CSS 4, Zustand, TanStack Query).

## Commands

From the repository root:

- `pnpm install` - install both applications.
- `pnpm dev` - run backend and frontend development servers together.
- `pnpm build` - build backend, then frontend.
- `pnpm typecheck` - run backend `tsc --noEmit`.
- `pnpm lint` - run frontend oxlint.
- `docker compose up -d` - start MongoDB on `27017` and mongo-express on `8081`.

Backend commands are `pnpm dev`, `pnpm typecheck`, `pnpm build`, and `pnpm start` from `backend/`.
Frontend commands are `pnpm dev`, `pnpm lint`, `pnpm build`, and `pnpm preview` from `frontend/`.
The frontend Vite scripts use `--configLoader native`; keep `vite.config.ts` ESM-compatible and use
`import.meta.dirname`, not `__dirname`. `/api` proxies to `http://localhost:4000` during development.

There is no automated test suite. Do not describe typecheck, lint, or build as tests. The backend needs
`backend/.env`; use `.env.example` as the inventory and never commit secrets or user data.

## Runtime surface

`backend/src/app.ts` mounts:

- `/api/auth` - registration, login, current user, profile name, and password changes;
- `/api/documents` - structured-data upload planning and deterministic application;
- `/api/collections` - collection browsing/editing, relations, and custom tables;
- `/api/dashboard` - dashboard generation, listing, detail, refinement, rename, and deletion;
- `/api/activity` - per-user activity history;
- `/api/knowledge` - Dify documents, segments, and grounded chat;
- `/api/overview` - deterministic workspace aggregates and findings;
- `/api/insights` - on-demand AI insight snapshots.

The frontend public routes are `/login` and `/register`. Protected routes use `ProtectedRoute` and
`AppLayout`: `/overview`, `/documents`, `/collections`, `/dashboard`, `/dashboard/:id`, `/knowledge`,
`/logs`, and `/pricing`. `/overview` is the default authenticated route; `/analytics` redirects to
`/dashboard` for compatibility. Settings is not a page: `SettingsDialog` (ChatGPT-style modal with
Account, Plan, Appearance, and Notifications sections) opens on any protected page via the
`?settings=<section>` URL param owned by `AppLayout`; the legacy `/settings` route redirects into it.
`/pricing` and the Plan section are placeholder monetization UI — no billing backend exists.

## Tenant and data architecture

The control-plane Mongoose connection stores `User`. A user has an email, password hash, display name,
server-owned `dbName`, and optional server-owned Dify dataset ID. Public auth responses contain only
`{ id, email, displayName, createdAt }`; do not expose `dbName`, password hashes, or Dify identifiers.

Every user's data lives in a physical MongoDB database named `user_<24 lowercase hex user id>`.
`requireAuth` reads the current user on every request and attaches the server-owned database name.
`getUserConnection(req.userDbName!)` is the only allowed entry point for user data. Never accept a
database target from the request or JWT.

Per-user metadata includes:

- `MetaCollection` for dynamic collection schema, source file, row count, and freshness;
- `MetaRelation` for validated joins;
- `MetaDashboard` for saved UI specs and refinement chat;
- `MetaInsightSnapshot` for idempotent AI insight results and data fingerprints;
- `KbChatMessage` for idempotent knowledge conversations;
- `ActivityLog` for the 90-day audit trail;
- `RateLimitRecord` for successful-action cooldowns.

Raw user rows live in dynamically named native Mongo collections. Collection-editor input recursively
rejects keys beginning with `$` or containing `.`, and destructive operations validate dependencies.

## Structured upload pipeline

`documents.controller.ts` parses a staged upload, asks `extractionPlanner.service.ts` for a validated
plan, then applies writes through `collectionWriter.service.ts`. Every upload — including a clean
create — is staged server-side and returned as "needs-decision"; nothing is written until the user
approves it in the Documents-page panel (which summarizes the collections and relations to be added).
The planner may propose create/append/replace/merge, fields, rows, and relations, but deterministic
code enforces collection naming, collision behavior, metadata validation, and writes. LLM output is
advisory and never writes directly to MongoDB.

SQL dumps are the exception to the LLM planning path: `sqlDumpParser.util.ts` deterministically
extracts every table (types from CREATE TABLE, rows from INSERT ... VALUES, relations from FOREIGN KEY
constraints; trigger/procedure bodies, views, and INSERT...SELECT are ignored) and
`documents.controller.ts` stages one plan per table (base names; collisions resolved at apply) plus a
`sqlSummary` for the approval panel. Approval is all-or-nothing ("apply-plan" only; no merges or field
overrides); when staged names collide with existing collections the panel offers a
`sqlCollisionStrategy` — "replace" updates the existing collection by the table's primary key
(create-time synthesized AUTO_INCREMENT values included), "suffix" imports numbered copies — and FK
relations are remapped to the final names. The applied response
keeps the single-`collection` contract (aggregate counts) plus a per-table `collections` breakdown.
Schema-only .sql files (no INSERT data) fall back to the raw-text planner path.

The frontend `uploadQueueStore` is persisted, processes one item at a time, observes cooldowns, and
survives route navigation. Browser `File` objects cannot survive reload, so rehydrated uploads without
their file become an explicit error instead of silently replaying.

## External data sources

Users can connect MySQL/MariaDB, PostgreSQL, and MongoDB servers (`/api/sources`, "Sources" tab on
Documents at `?tab=sources`). Connectors (`services/sources/`) are read-only by construction:
introspection plus SELECT/find with engine-escaped identifiers validated against the live schema —
never user-supplied SQL. Passwords are AES-256-GCM encrypted at rest (`credentialVault.util.ts`, key
from `SOURCE_CREDENTIAL_ENC_KEY` or derived from `JWT_SECRET`) and are write-only: no endpoint returns
or logs them. `SOURCE_ALLOW_PRIVATE_HOSTS=false` enables the SSRF guard (`sources/hostGuard.util.ts`
resolves DNS and rejects loopback/private/link-local before dialing) — default true for self-hosted
localhost use.

`sourceSync.service.ts` mirrors each enabled table with a full refresh through a shadow collection
(`<target>__sync_tmp` then rename with dropTarget — readers never see an empty window). External
field names are renamed to safe workspace names (existing guards only reject `$`/dotted keys; sync
renames instead, including nested object keys), SQL FKs upsert `MetaRelation`s (`createdVia:
"datasource"`), and `MetaCollection.source` links the mirror to its source (ownership guard refuses
to clobber collections another source/user data owns). Limits: 5 sources/user, 20 tables/source,
`SOURCE_SYNC_MAX_ROWS` per table. Manual "Sync now" consumes the `sourceSync` cooldown; the polling
scheduler (`sourceScheduler.service.ts`, 60s scan started in `server.ts`) is the backend's only
timer — in-memory, single-process, per-source run locks; a restart just delays the next poll.
Overview reports `serviceStatus.sources` and a finding when a source's last sync failed.

## Dashboard and custom-query pipeline

Dashboard prompts pass through the intent guard and `genUI.specGenerator.service.ts`, which emits a
validated `UiSpec` containing the constrained `QueryDSL`. The LLM never emits Mongo aggregation JSON.
`genUI.pipelineBuilder.service.ts` is the sole QueryDSL-to-pipeline compiler and enforces
`ALLOWED_STAGES`; `genUI.executor.service.ts` validates current collections and relations before
read-only execution.

Generation queue UUIDs are stable across navigation and reload. The backend derives deterministic IDs
and atomically upserts saved dashboards, preventing duplicate results from retries. Saved dashboards
can be refined through prompt history without replacing the original record.

Dashboard contracts are duplicated deliberately across the backend Zod schema and prompts, pipeline
builder/executor, frontend dashboard types, `WidgetStack`/`DashboardGrid`, and individual widget
components. Update all copies together. Preserve the 12-column layout contract. HTML widgets remain
query-free, sanitized on both server and client, and rendered through the isolated shadow-root path.

Non-page dashboards render through `DashboardGrid` (react-grid-layout v2) honoring per-widget `grid`
rects, with drag/resize editing persisted via `PATCH /dashboard/saved/:id/layout` — a layout-only
endpoint that copies validated `{x,y,w,h}` into the server-held spec and can never mutate queries.
Specs containing html widgets keep the seamless `PageStack` renderer and are not grid-editable.
react-grid-layout's internal react-draggable reads `process.env.DRAGGABLE_DEBUG` on every drag start;
`vite.config.ts` defines that constant — removing the `define` silently breaks all grid dragging.

Numeric chart axes format ticks through `formatAxisNumber` (`components/genui/internal/chartTheme.ts`,
compact notation like `6.1M`) because value axes have a fixed 40px width; tooltips keep full values.

Generation progress (`GET /dashboard/generate/:requestId/progress`) is served from an in-memory,
single-process stage map (`generationProgress.service.ts`) — on a multi-instance deployment or
restart the poll 404s and the frontend falls back to its indeterminate spinner; generation
correctness never depends on it.

Dark mode is a class-scoped token swap: `.dark` on `<html>` overrides the `@theme` variables in
`frontend/src/index.css` (surfaces, ink, borders, `--chart-*`). Dark is the default mode — an
explicit stored "light" (or "system" on a light OS) opts out. The class is set pre-paint by an
inline script in `index.html` and at runtime by `applyMode` (`lib/themes.ts`); components needing
concrete color strings (Recharts, React Flow) recompute via `useIsDark`/`useChartTheme` instead of
hardcoding hexes. Accent themes (`applyTheme`) stay an orthogonal inline-style dimension.

## Knowledge base and chat jobs

Each user has an independently resolved Dify dataset. Dify document operations always receive the
dataset ID from `kbDataset.service.ts`, never from client input. Retrieval is followed by an LLM answer
constrained to retrieved excerpts; reported source names are filtered against the retrieved documents.

Knowledge chat sends a stable request UUID. The backend derives deterministic user and assistant
message IDs and returns an already completed pair before checking cooldown, so replay after reload is
free and cannot duplicate history. Chat history includes `requestId`; `knowledgeChatJobStore` uses it to
reconcile a persisted pending job with a response already saved by the backend. Job state is bound to
the authenticated account and stored in `sessionStorage`.

The Knowledge page uses URL-backed Documents/Chat navigation on smaller screens. When a citation is not
in the current document page/filter, the frontend searches the dataset before opening the viewer.

## Overview and AI insights

`GET /api/overview` builds per-user metrics, recent activity, deterministic findings, knowledge-service
status, and the latest AI snapshot. It uses metadata rather than scanning or sending raw user datasets.
A Dify outage degrades only the knowledge count/status and must not fail the rest of Overview.

`POST /api/insights/generate` accepts only a stable request UUID. The backend builds aggregate LLM input,
uses `completeJSON` with a Zod contract, revalidates collection names/actions against current metadata,
and saves one `MetaInsightSnapshot`. A server-generated fingerprint marks a snapshot stale after the
workspace changes. Completed request replays return the existing snapshot before the cooldown check.
Only a winning insert calls `markRateLimitSuccess` and writes the activity entry.

`insightJobStore` persists an account-bound job across navigation/reload, immediately updates the
Overview query cache on completion, and then refreshes server state. Overview also summarizes active
upload, dashboard, knowledge, and insight jobs.

## Auth, settings, navigation, and theming

`authStore` persists the JWT and public user DTO. `ProtectedRoute` refreshes legacy persisted sessions
that do not yet contain `displayName` or `createdAt`. Profile name and password changes use the shared
Axios client through `src/api/auth.ts`; email is read-only in the current UI.

Theme, pinned-sidebar, and notification preferences are device-local Zustand state, edited in the
`SettingsDialog` modal (see "Runtime surface"). The sidebar groups primary workspace routes separately
from Activity and Settings (a modal-opening button, not a route), exposes a profile popover, and has a
mobile drawer. Collections and Relations use URL-backed tabs.

Runtime themes set `--color-sidebar`, `--color-sidebar-hover`, `--color-sidebar-ink`, and
`--color-accent-blue`. Use Tailwind tokens `sidebar`, `sidebar-hover`, `sidebar-ink`, and `accent-blue`
for primary themed UI. Avoid fixed gradients or hard-coded brand colors for surfaces expected to follow
the selected theme. Reuse existing UI primitives before introducing parallel components.

The product logo (`frontend/public/bijutsubu_logo.svg`, a single "B" glyph with a content-cropped
viewBox) renders through `BrandMark` (`components/layout/BrandMark.tsx`) as a CSS mask over a themed
background color, so the mark recolors with the active theme; `public/favicon.svg` is a generated
copy of the glyph on a dark rounded badge. Login, register, and logout play `BrandTransition`
(`components/layout/BrandTransition.tsx`): a canvas-colored cover whose `onCovered` callback performs
the actual route change/logout while the screen is hidden; its fades are CSS transitions on purpose —
fill-mode keyframes would pin opacity and cut the exit.

Sidebar active state is a single `SlidingPill` per nav group that glides between rows via
`translateY(index * stride)`; the stride math assumes the fixed row heights and gaps in `Sidebar.tsx`.
Global search is a command palette: the top-bar button (and Ctrl/Cmd+K anywhere) opens a centered
modal searching collections and saved dashboards; dashboard results link directly to `/dashboard/:id`.
Notifications are local persisted UI state and honor success/failure preferences. The auth pages draw
an animated dot-grid backdrop whose spacing breathes via `background-size` (`dots-breathe` in
`index.css`) — do not animate it with `scale`, which overflows the viewport and adds scrollbars.

## LLM and rate-limit conventions

Normal structured LLM calls go through `llmClient.service.ts`'s
`completeJSON(systemPrompt, userPrompt, zodSchema)`: JSON mode, Zod validation, and one correction retry.
Treat every result as untrusted and revalidate referenced server-owned resources before use.

The rate-limit middleware checks cooldown but does not consume it. Controllers call
`markRateLimitSuccess` only after the real operation succeeds. Idempotent endpoints that must replay a
completed result after navigation/reload perform their completed-result lookup before checking the
cooldown, then check the cooldown before starting new expensive work.

## Frontend state conventions

- TanStack Query owns server state; API wrappers stay in `src/api/` and use the shared Axios instance.
- Zustand owns client preferences, authentication, notifications, and persistent background jobs.
- Read Zustand through `.getState()` outside React, including Axios interceptors and job processors.
- `uploadQueueStore`, `generationQueueStore`, `knowledgeChatJobStore`, and `insightJobStore` must remain
  account-safe and reconcile successful backend work without waiting indefinitely for query invalidation.
- Path alias `@/*` maps to `frontend/src/*`.

# AGENTS.md

This file is the working guide for coding agents in this repository. Read it before making changes. `CLAUDE.md` contains additional architectural background; when documentation and code disagree, verify the current code and update the relevant documentation if the mismatch matters.

## Project overview

Bijustubu turns uploaded documents into per-user MongoDB collections, then lets users build dashboards and custom tables with natural-language prompts. It also provides a Dify-backed personal knowledge base with grounded chat, plus an Overview that combines deterministic workspace findings with on-demand AI insight snapshots.

The repository has two applications:

- `backend/`: Express 5, TypeScript, Mongoose/MongoDB, Zod, and an OpenAI-compatible LLM client.
- `frontend/`: React 19, Vite, TypeScript, Tailwind CSS 4, Zustand, TanStack Query, and React Router.

MongoDB and mongo-express are available through the root `docker-compose.yml`.

## Commands

Install all workspace dependencies from the repository root with `pnpm install`.

Workspace (repository root):

- `pnpm dev` - run the backend and frontend development servers together.
- `pnpm build` - build the backend, then the frontend.
- `pnpm typecheck` - run the backend TypeScript check.
- `pnpm lint` - run the frontend linter.

Application-specific commands can still be run from their application directory.

Backend (`backend/`):

- `pnpm dev` - development server with `tsx watch`.
- `pnpm typecheck` - TypeScript check without emitting files.
- `pnpm build` - compile to `dist/`.
- `pnpm start` - run the compiled server.

Frontend (`frontend/`):

- `pnpm dev` - Vite dev server using the native config loader; `/api` proxies to `http://localhost:4000`.
- `pnpm lint` - oxlint.
- `pnpm build` - TypeScript project build followed by Vite build using the native config loader.
- `pnpm preview` - serve the production build locally.

Infrastructure (repository root):

- `docker compose up -d` - MongoDB on `27017`, mongo-express on `8081`.

There is currently no automated test suite in either application. For a normal change, run the narrowest relevant checks; before handing off cross-stack work, prefer root `pnpm typecheck`, `pnpm lint`, and `pnpm build`. Do not report tests as passing when only typecheck/build/lint were run.

The backend requires `backend/.env`; use `backend/.env.example` as the variable inventory. Never commit `.env`, API keys, JWT secrets, dataset credentials, or user data.

## Code map

Backend flow and ownership:

- `src/app.ts` wires `/api/auth`, `/api/documents`, `/api/collections`, `/api/dashboard`, `/api/activity`, `/api/knowledge`, `/api/overview`, and `/api/insights`.
- `src/controllers/` owns HTTP validation and responses.
- `src/services/` owns document parsing, LLM planning, deterministic writes, query compilation/execution, Dify access, and activity logging.
- `src/schemas/` contains the Zod contracts for LLM output and the dashboard/query DSL.
- `src/models/` contains control-plane and per-user metadata model factories.
- `src/db/userConnectionManager.ts` is the only path to a user's physical database.
- `src/middleware/auth.ts`, `rateLimit.ts`, and `upload.ts` enforce cross-cutting boundaries.

Frontend flow and ownership:

- `src/App.tsx` defines public and protected routes.
- `src/pages/` composes page-level experiences.
- `src/api/` contains thin resource wrappers around the shared Axios client in `src/lib/api.ts`.
- `src/store/` contains Zustand state; server-state fetching/caching uses TanStack Query.
- `src/components/genui/` renders the backend dashboard widget contract.
- `src/components/datagrid/` and `src/components/relations/` implement collection editing and relationship management.
- `src/components/ui/` contains reusable shadcn-style primitives.
- `src/pages/OverviewPage.tsx` is the authenticated landing page; deterministic workspace findings come from `/api/overview`, while on-demand AI snapshots use a persisted, idempotent insight job.
- `src/components/layout/Sidebar.tsx` owns grouped desktop navigation, the profile menu, and the mobile drawer. Core routes stay flat; Collections, Knowledge, and Settings use URL-backed in-page tabs. The active-row highlight is a shared sliding pill whose offset math depends on the fixed row heights/gaps in that file.
- `src/components/layout/BrandMark.tsx` renders the product logo as a CSS mask so it recolors with the theme; `BrandTransition.tsx` is the login/logout overlay whose `onCovered` callback performs the real navigation/logout while the screen is covered.
- `src/store/uploadQueueStore.ts`, `generationQueueStore.ts`, `knowledgeChatJobStore.ts`, and `insightJobStore.ts` own navigation-safe background work. Stable request IDs are part of their backend idempotency contracts.
- Use the `@/*` alias for imports rooted at `frontend/src/*`.

## Non-negotiable invariants

### Per-user database isolation

User data never belongs in a shared data database. The authenticated user's database name is stored on the control-plane `User` document and has the form `user_<24 lowercase hex characters>`.

- Any endpoint touching user-owned data must use `getUserConnection(req.userDbName!)`.
- Never accept a database name or database target from request input or from JWT claims.
- Keep the database-name validation in `userConnectionManager.ts` and the server-side user lookup in `requireAuth` intact.
- Use the per-connection model factories in `src/models/`; do not silently introduce global Mongoose models for per-user collections.

### Mongo write safety

Raw user rows live in dynamically named native Mongo collections. Metadata lives in `MetaCollection`, `MetaRelation`, `MetaDashboard`, `RateLimitRecord`, and related per-user collections.

- Preserve recursive rejection of keys beginning with `$` or containing `.` in collection editor inputs.
- Validate collection and field references against server-owned metadata before reads, writes, joins, renames, or deletes.
- Treat dependency checks around collection/field deletion and relations as product behavior, not incidental UI warnings.

### LLM boundaries

All normal LLM JSON calls go through `llmClient.service.ts` and `completeJSON(systemPrompt, userPrompt, zodSchema)`. It uses JSON mode, Zod validation, and one correction retry.

- Define or update a Zod schema and an exact-output system prompt together.
- Do not parse ad-hoc free-form LLM output when a structured contract can represent it.
- Treat LLM output as untrusted. Revalidate referenced collections, fields, relations, and operations in deterministic code.
- Keep narrative/upload planning separate from deterministic collection writes.

### Dashboard and custom-query safety

The LLM emits `QueryDSL`, never Mongo aggregation JSON. `genUI.pipelineBuilder.service.ts` is the sole compiler to aggregation stages, and `ALLOWED_STAGES` is the execution boundary.

- Never execute a raw pipeline, operator, stage, collection, or join supplied by an LLM or client.
- Keep executor-side collection and relation validation.
- When changing a dashboard widget or DSL capability, update every copy of the contract: `backend/src/schemas/uiSpec.schema.ts`, generator prompt/validation, pipeline builder/executor as applicable, frontend dashboard types, `WidgetRenderer`, and the concrete widget component.
- Preserve the 12-column grid contract shared by generated specs and frontend layout resolution.
- `html` widgets must remain static and query-free, sanitized server-side with `sanitize-html`, sanitized client-side with DOMPurify, and rendered in the existing isolated shadow-root path. Never allow scripts, iframes, event handlers, or executable URLs.

### Rate limiting

The `rateLimit` middleware only checks cooldown state. Controllers must call `markRateLimitSuccess` only after the actual operation succeeds. Failed, rejected, or empty-precondition attempts should not consume quota unless the current endpoint explicitly documents otherwise.

### Knowledge base

Each user has a Dify dataset mapping managed by `kbDataset.service.ts`; document APIs use the dataset-scoped Dify API key. Knowledge chat retrieval is followed by an LLM answer constrained to retrieved excerpts.

- Never mix dataset IDs or chat history across users.
- Keep answers grounded in retrieved excerpts and filter reported citations against document names actually retrieved.
- Map upstream Dify errors to stable client errors without exposing credentials or sensitive upstream details.
- Knowledge chat requests carry a stable UUID. Completed retries must return the existing user/assistant pair before cooldown checks, and chat history must retain `requestId` so the frontend can reconcile a persisted job after navigation or reload.

### Overview and insight snapshots

`GET /api/overview` is a read-only per-user aggregate over metadata, activity, and optional knowledge-service state. `POST /api/insights/generate` creates an on-demand AI snapshot.

- Build Overview data only from server-owned per-user metadata through `getUserConnection(req.userDbName!)`; Dify dataset IDs remain server-derived.
- A Dify failure must degrade only `serviceStatus.knowledge`/the knowledge-document count, not fail the whole Overview response.
- Send only aggregate metadata to the insight LLM. Validate its structured output with Zod, then revalidate collection references and actions against current metadata.
- Insight generation uses a stable request UUID, idempotent `MetaInsightSnapshot` writes, a data fingerprint for stale detection, and rate-limit success marking only after a winning insert.
- Insight and knowledge jobs are account-bound and persisted in `sessionStorage`; they must never cross users in the same browser tab.

### Account and UI preferences

- The public auth DTO is `{ id, email, displayName, createdAt }`. Never return `dbName`, password hashes, Dify IDs, or other control-plane fields to the frontend.
- Profile name and password changes go through `/api/auth/profile` and `/api/auth/change-password`; email remains read-only in the current UI.
- Theme, pinned-sidebar, and notification preferences are device-local Zustand state. Primary themed UI must use the existing `sidebar`, `sidebar-ink`, and `accent-blue` tokens instead of fixed brand gradients or hard-coded theme colors.

## Implementation conventions

- Keep TypeScript strict and avoid `any`; validate external input at HTTP, LLM, and upstream-service boundaries.
- Backend uses ESM with NodeNext resolution. Relative TypeScript imports must use the emitted `.js` suffix.
- Follow existing local formatting and naming rather than mechanically reformatting unrelated files.
- Controllers should return after sending a response and pass unexpected errors to Express error handling.
- Keep frontend API calls in `src/api/` and use the shared Axios instance so authentication and 401 logout behavior remain consistent.
- Read Zustand state outside React through `.getState()` where hooks are invalid, such as Axios interceptors.
- Use existing UI primitives, theme tokens, chart helpers, and query-cache patterns before adding parallel abstractions.
- Keep the `process.env.DRAGGABLE_DEBUG` define in `frontend/vite.config.ts`: react-grid-layout's internal react-draggable reads it on every drag start, and without the define the browser throws and dashboard layout editing silently stops working.
- Log meaningful successful mutations through `activityLog.service.ts` when comparable operations already do so.
- Preserve unrelated work in the workspace. Make focused changes and do not overwrite generated assets, lockfiles, or user edits without need.

## Change checklist

Before editing:

1. Read the route/controller/service/schema and its frontend consumer, not only one side of the request.
2. Search for all copies of a type, endpoint, widget name, activity action, or error code before changing its contract.
3. Identify whether the change touches tenant isolation, Mongo input safety, LLM trust boundaries, HTML sanitization, rate limits, or destructive dependency behavior.

Before handoff:

1. Run the relevant typecheck, lint, and build commands.
2. Review the diff for secrets, raw LLM execution, client-selected database targets, unsafe Mongo keys, and backend/frontend contract drift.
3. State exactly which checks ran and any checks that could not run.
4. Update `AGENTS.md`, `CLAUDE.md`, or `.env.example` when the architecture, commands, or required configuration materially changed.

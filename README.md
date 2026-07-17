# Bijustubu

Bijustubu is a per-user data workspace: upload documents, get structured MongoDB collections, then explore them with natural-language dashboards, custom tables, and a grounded knowledge-base chat.

## Features

- **Document import** — CSV, Excel, PDF, DOCX, and plain text are parsed and planned into structured collections by an LLM, with a preview/merge decision step and editable field names/types before anything is written. Deterministic code owns all writes; LLM output is advisory only.
- **Collections editor** — browse, sort, filter, and edit rows; manage fields and validated relations on a visual canvas; export to CSV/XLSX/JSON.
- **Generative dashboards** — describe the dashboard you want and get charts, stat cards (with period-over-period deltas and sparklines), and tables. Dashboards are saved, refinable through chat, and rearrangeable with drag/resize grid editing. The LLM emits a constrained QueryDSL — never raw Mongo aggregation.
- **Custom tables** — one-off tabular questions over your data, savable and re-executed live.
- **Knowledge base** — upload documents to a Dify-backed dataset and chat over retrieved excerpts with filtered citations.
- **Overview & AI insights** — deterministic workspace findings plus on-demand AI insight snapshots with staleness fingerprinting.
- **Theming** — accent themes, light/dark/system mode, and a command palette (Ctrl/Cmd+K).

Every user's data lives in its own physical MongoDB database (`user_<id>`); the database target is always server-derived, never taken from the client.

## Stack

| | |
|---|---|
| Backend | Express 5, TypeScript, Mongoose, Zod, OpenAI-compatible LLM client |
| Frontend | React 19, Vite, TypeScript, Tailwind CSS 4, Zustand, TanStack Query, Recharts, React Flow |
| Infra | MongoDB (Docker), Dify (knowledge base) |

## Getting started

Prerequisites: Node.js 20+, [pnpm](https://pnpm.io), Docker.

```bash
# 1. Install dependencies (workspace root)
pnpm install

# 2. Start MongoDB (27017) and mongo-express (8081)
docker compose up -d

# 3. Configure the backend
cp backend/.env.example backend/.env
#    then fill in JWT_SECRET, the OpenAI-compatible LLM settings, and
#    (optionally) Dify credentials for the knowledge base

# 4. Run both dev servers (frontend on 5173, backend on 4000)
pnpm dev
```

The frontend proxies `/api` to `http://localhost:4000` during development.

## Commands

From the repository root:

| Command | What it does |
|---|---|
| `pnpm dev` | Backend + frontend dev servers |
| `pnpm build` | Build backend, then frontend |
| `pnpm typecheck` | Backend `tsc --noEmit` |
| `pnpm lint` | Frontend oxlint |

## Repository layout

```
backend/    Express API — controllers, services, Zod schemas, per-user DB access
frontend/   React app — pages, genui widget renderer, collections editor, stores
```

Architectural docs for contributors and coding agents live in [`AGENTS.md`](AGENTS.md) (invariants and change checklist) and [`CLAUDE.md`](CLAUDE.md) (architecture deep-dive).

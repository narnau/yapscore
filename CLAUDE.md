# score-ai-web

LLM-powered MuseScore editor. Upload .mscz → edit with natural language → download modified .mscz.

## Tech Stack
- **Next.js 15** (App Router) + React 19 + TypeScript 5
- **Bun** as package manager and runtime
- **Tailwind CSS 3** for styling
- **Supabase** — Auth (Google OAuth), Postgres DB, Storage
- **Stripe** — Subscriptions (free/pro tiers)
- **Verovio** — Score rendering (SVG)
- **OpenRouter** — LLM API (default: Gemini 2.5 Flash)

## Commands
- `bun install` — install dependencies
- `bun run dev` — start dev server
- `bun run build` — production build
- `bun run tsc --noEmit` — type check (must pass before PR)
- `supabase start` — local Supabase (requires Docker)
- `supabase db reset` — reset local DB and re-run migrations
- `supabase migration up` — apply new migrations without resetting data

## Debugging
The user starts the dev server with log capture so Claude can read server output directly:

```bash
bun dev 2>&1 | tee /tmp/score-ai.log
```

- Logs appear in the terminal AND are written to `/tmp/score-ai.log`
- When debugging a bug, read the log with `tail -n 100 /tmp/score-ai.log` or grep for `[agent]`, `[llm]`, errors, etc.
- Never ask the user to paste logs — read `/tmp/score-ai.log` directly
- Agent logs are prefixed with `[agent]`, LLM logs with `[llm]`

## Project Structure
```
app/
  page.tsx              — Landing page (public)
  login/page.tsx        — Google OAuth login (public)
  docs/page.tsx         — Documentation (public)
  editor/page.tsx       — File list / dashboard (protected)
  editor/[id]/page.tsx  — Score editor for a specific file (protected)
  api/agent/            — Multi-turn AI agent
  api/files/            — File CRUD (list, create)
  api/files/[id]/       — File CRUD (get, save, delete)
  api/load/             — .mscz → MusicXML conversion
  api/auth/             — OAuth callback + logout
  api/stripe/           — Checkout, webhook, portal
  api/usage/            — Usage stats
components/
  ChatPanel.tsx         — Chat UI + file upload + paywall
  ScoreViewer.tsx       — Verovio rendering + measure selection
  MidiPlayer.tsx        — MIDI playback
lib/
  supabase/             — Client utilities (client, server, middleware, admin)
  auth.ts               — getAuthUser() helper for API routes
  stripe.ts             — Stripe instance + customer helper
  files.ts              — Supabase-backed file storage (scores + history + chat)
  agent.ts              — AI agent with tools (modify/generate)
  llm.ts                — OpenRouter API calls
  mscore.ts             — .mscz → MusicXML via webmscore
  musicxml.ts           — MusicXML parsing/reconstruction
  accidentals.ts        — Post-process accidentals
  beams.ts              — Post-process beam elements
supabase/
  migrations/           — Database migrations (auto-deployed on push to main)
```

## Architecture
- Auth: Supabase Auth with Google OAuth. Middleware redirects `/editor/*` to `/login` if unauthenticated.
- All API routes use `getAuthUser()` guard (returns 401 if not authenticated).
- Files: `files` table stores current_xml, history (jsonb, capped at 30), messages (jsonb) per user file.
- Auto-save: editor writes to localStorage immediately, debounces Supabase PATCH 2s later.
- Paywall: Free tier = 5 agent interactions. After limit → 402 response. Stripe checkout for Pro upgrade.
- Score editing: MusicXML sent to LLM (only `<part>` elements for token optimization). Selected measures for partial edits.
- RLS enabled on all tables. Service-role client used only in webhooks and server-side admin operations.

## Conventions
- All new database changes go in `supabase/migrations/` (create with `supabase migration new <name>`)
- Use `@/` import alias for all project imports
- API routes return `NextResponse.json()` — errors include `{ error: string }` with appropriate status codes
- No markdown/README files unless explicitly requested

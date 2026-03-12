# YapScore

AI-powered music score editor. Upload a MuseScore file, describe your changes in natural language, and let AI do the rest.

## Local Development

### Prerequisites

- [Bun](https://bun.sh/) (package manager)
- [Docker Desktop](https://docs.docker.com/desktop/) (for local Supabase)
- [Supabase CLI](https://supabase.com/docs/guides/cli) (`brew install supabase/tap/supabase`)
- [Stripe CLI](https://docs.stripe.com/stripe-cli) (`brew install stripe/stripe-cli/stripe`) — for webhook testing

### Setup

```bash
# Install dependencies
bun install

# Start local Supabase (runs migrations automatically)
supabase start

# Copy the output keys into .env
cp .env.example .env
# Fill in the values printed by `supabase start`
```

### Environment Variables (.env)

```bash
# OpenRouter
OPENROUTER_API_KEY=          # https://openrouter.ai — create an API key
OPENROUTER_MODEL=google/gemini-2.5-flash  # or any model on OpenRouter

# Supabase (local values printed by `supabase start`)
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_ANON_KEY=<anon key from supabase start>
SUPABASE_SERVICE_ROLE_KEY=<service_role key from supabase start>

# Stripe
STRIPE_SECRET_KEY=           # https://dashboard.stripe.com/test/apikeys
STRIPE_WEBHOOK_SECRET=       # from `stripe listen` (see below)
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=  # same Stripe dashboard page
STRIPE_PRICE_ID=             # create a product + price in Stripe dashboard

# App
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### Running

```bash
# Start the dev server
bun run dev

# In a separate terminal — forward Stripe webhooks locally
stripe listen --forward-to localhost:3000/api/stripe/webhook
# Copy the whsec_... secret it prints into STRIPE_WEBHOOK_SECRET
```

### Useful Commands

| Command                         | Description                       |
| ------------------------------- | --------------------------------- |
| `bun run dev`                   | Dev server                        |
| `bun run build`                 | Production build                  |
| `bun run tsc --noEmit`          | Type check                        |
| `supabase start`                | Start local Supabase              |
| `supabase stop`                 | Stop local Supabase               |
| `supabase db reset`             | Wipe DB and re-run all migrations |
| `supabase migration new <name>` | Create a new migration file       |

---

## Production Deployment

### 1. Supabase Project

1. Create a project at [supabase.com/dashboard](https://supabase.com/dashboard)
2. Go to **Project Settings > API** and copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon` public key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` secret key → `SUPABASE_SERVICE_ROLE_KEY`
3. Link your local project:
   ```bash
   supabase link --project-ref <your-project-ref>
   ```
4. Push migrations to cloud:
   ```bash
   supabase db push
   ```

### 2. Google OAuth

1. Go to [Google Cloud Console > Credentials](https://console.cloud.google.com/apis/credentials)
2. Create an **OAuth 2.0 Client ID** (Web application)
3. Add authorized redirect URI:
   ```
   https://<your-project-ref>.supabase.co/auth/v1/callback
   ```
4. Copy the Client ID and Client Secret
5. In Supabase Dashboard → **Authentication > Providers > Google**:
   - Enable Google provider
   - Paste Client ID and Client Secret

### 3. Stripe

1. Go to [Stripe Dashboard](https://dashboard.stripe.com)
2. Create a **Product** (e.g. "YapScore Pro")
3. Add a **Price** to it (e.g. $9/month, recurring)
4. Copy the Price ID (`price_...`) → `STRIPE_PRICE_ID`
5. Go to **Developers > API keys**:
   - Secret key → `STRIPE_SECRET_KEY`
   - Publishable key → `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`
6. Go to **Developers > Webhooks > Add endpoint**:
   - URL: `https://<your-vercel-domain>/api/stripe/webhook`
   - Events to subscribe: `checkout.session.completed`, `customer.subscription.deleted`
   - Copy the signing secret → `STRIPE_WEBHOOK_SECRET`

### 4. Vercel

1. Import the repo at [vercel.com/new](https://vercel.com/new)
2. Framework preset: **Next.js**
3. Add **all** environment variables listed above in the Vercel project settings
4. Deploy

Vercel will automatically:

- Build and deploy on every push to `main`
- Create preview deploys for every PR

### 5. GitHub Secrets (for CI/CD)

Go to your GitHub repo → **Settings > Secrets and variables > Actions** and add:

| Secret                  | Where to get it                                                                        |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `SUPABASE_ACCESS_TOKEN` | [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens) |
| `SUPABASE_PROJECT_REF`  | Project ref from your Supabase dashboard URL                                           |

---

## CI/CD Pipelines

Two GitHub Actions workflows run automatically:

### `ci.yml` — on every PR and push to `main`

1. **Type check** — `tsc --noEmit`
2. **Build** — `bun run build`

### `supabase.yml` — on push to `main` (migrations only)

- Deploys new migration files to Supabase cloud via `supabase db push`

---

## Architecture

```
Browser → Next.js App (Vercel)
            ├── Supabase Auth (Google OAuth)
            ├── Supabase Postgres (profiles, scores tables)
            ├── Supabase Storage (.mscz files)
            ├── Stripe (pro subscriptions)
            └── OpenRouter → LLM (score editing)
```

### How editing works

```
User uploads .mscz
  → /api/load converts to MusicXML via webmscore
  → Verovio renders MusicXML as SVG in browser

User selects measures + types instruction
  → /api/agent routes to the right tool (load/modify/generate)
  → Only selected measures sent to LLM (~200 tokens vs ~5500 full)
  → LLM returns modified measures → spliced back into full XML
  → Post-processing: accidentals, beams, chord symbols
  → Re-rendered by Verovio
```

### Auth & billing

- `/editor/*` routes are protected by middleware (redirect to `/login`)
- All API routes check authentication via `getAuthUser()`
- **Free tier:** 5 AI agent interactions
- **Pro tier:** Unlimited (Stripe subscription)
- RLS enforced on all Supabase tables — users can only access their own data

### Measure selection

Click a measure to select it (highlighted in blue). Shift/Cmd+click to multi-select. Selected measures are shown as a badge in the chat panel. Only selected measures are sent to the LLM, reducing token usage significantly.

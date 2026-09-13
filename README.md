# Cartography

A grocery list that plans your stops: split one list across the cheapest stores near your ZIP, or find the single store where the whole cart costs least.

Mobile-first Next.js app. Real store locations from Foursquare Places; real shelf prices from the Kroger API where a store is a Kroger banner (Ralphs, Food 4 Less, Fred Meyer, King Soopers, Fry's, Smith's, QFC, Dillons…); optional Claude estimates for everything else, always labeled as estimates.

## Stack

- **Next.js 15** (App Router, TypeScript) — deploy on Vercel
- **Supabase** — email/password auth, `profiles` and `lists` tables with row-level security
- **Foursquare Places API** — grocery stores within a radius of a ZIP (ZIP → lat/lng via the free Zippopotam service)
- **Kroger Public API** — locations + product prices (`product.compact` scope, client-credentials)
- **Anthropic API** (optional) — price estimates for chains with no feed

## Setup

1. `npm install`
2. Copy `.env.example` → `.env.local` and fill in keys (see below).
3. In Supabase: create a project, open **SQL editor**, paste and run `supabase/schema.sql`. Under **Authentication → Providers → Email**, leave email/password enabled; you can turn off "Confirm email" while testing.
4. `npm run dev` → http://localhost:3000

Guest mode needs no keys except Foursquare (stores). Sign-in needs Supabase. Prices need Kroger and/or Anthropic.

### Keys

| Key | Where | Notes |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase → Project Settings → API | Anon key is safe in the browser; RLS protects rows |
| `FOURSQUARE_API_KEY` | developer.foursquare.com → Service API keys | New Places API (`places-api.foursquare.com`), 500 free calls/mo then metered |
| `KROGER_CLIENT_ID`, `KROGER_CLIENT_SECRET` | developer.kroger.com → My Apps | Free; 10k product calls/day |
| `ANTHROPIC_API_KEY` | console.anthropic.com | Optional |

## Deploy (Vercel)

Import the repo, add the same env vars in **Settings → Environment Variables**, deploy. Add the Vercel URL to Supabase **Authentication → URL Configuration → Site URL**.

## How pricing works

`POST /api/prices` receives the list items and the stores in scope.

1. Stores with a `krogerLocationId` get real prices: the route searches Kroger products by term at that location and takes the best match's regular price (promo shown when present). `source: "kroger"`.
2. Every other store falls back to Claude estimates if `ANTHROPIC_API_KEY` is set (`source: "estimate"`), otherwise `source: "none"` and the UI shows "No price data".

The UI marks each price as **live** or **est.** so you always know which is which. Add more real sources by extending `lib/prices.ts` — Walmart's affiliate API is the next obvious one.

## Project layout

```
app/
  page.tsx            renders <App/>
  layout.tsx, globals.css
  api/stores/route.ts Foursquare search + Kroger location matching
  api/prices/route.ts Kroger prices + optional estimates
components/App.tsx    the whole UI (tabs, sheets, onboarding)
lib/
  plan.ts             split-by-store and single-store algorithms
  storage.ts          guest (localStorage) and Supabase adapters
  foursquare.ts, kroger.ts, estimate.ts, prices.ts
  catalog.ts, brand.ts, util.ts, types.ts
supabase/schema.sql
```

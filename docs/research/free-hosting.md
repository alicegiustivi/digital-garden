# Free hosting, database and image storage for a single-user web app

Research for issue #3 (part of map #1). Checked **2026-10-31** against official pricing and docs pages.

> **Volatile facts.** Free-tier numbers change often, sometimes with little notice. Every number below carries its source; recheck the source before committing to a stack. Items marked **(volatile)** have changed recently or are new.

## Question

Which combinations of hosting, database and image/file storage let one person run a web app or PWA at $0 indefinitely, reachable from desktop and phone, with simple single-user login? Compare limits, sleep/pausing, how agent-friendly each is, and lock-in/export risk. Shortlist 2-3 options.

## Sizing assumption

One user. Realistically a few thousand Objects, a few hundred to a few thousand images (compressed to roughly 100-500 KB each before upload), a handful of sessions a day. That is well under 1 GB of database and a few GB of images for years. **Every option below fits comfortably; the real differences are pausing, card requirements and lock-in, not capacity.**

## Building blocks

### Cloudflare (Workers + D1 + KV / R2 + Access)

| Piece | Free limit | Source |
|---|---|---|
| Workers (hosting + API) | 100,000 requests/day, 10 ms CPU per request; static asset requests free and unlimited | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| D1 (SQLite database) | 5 M rows read/day, 100,000 rows written/day, 5 GB total storage, 10 databases | [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| D1 per-database | **500 MB max per database on Free**, 2 MB max row/BLOB, 50 queries per Worker invocation | [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) |
| KV (key-value, can hold images) | 1 GB stored, 25 MiB max value, 1,000 writes/day, 100,000 reads/day | [KV limits](https://developers.cloudflare.com/kv/platform/limits/), [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/) |
| R2 (object storage for images) | 10 GB-month, 1 M Class A ops, 10 M Class B ops per month, **egress free** | [R2 pricing](https://developers.cloudflare.com/r2/pricing/) |
| Access (login in front of the app) | "$0 forever", 50 user limit | [Access product page](https://www.cloudflare.com/zero-trust/products/access/) |

- **No inactivity pausing** is documented for Workers, D1, KV or R2.
- Daily limits reset at 00:00 UTC; exceeding a KV daily limit makes further operations of that type fail (not billed) ([Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)).
- **R2 needs a payment method on file.** You must "complete the checkout flow to add an R2 subscription" ([R2 get started](https://developers.cloudflare.com/r2/get-started/)); usage over the free tier is billed, with no hard cap. Community reports confirm the card dialog ([thread](https://community.cloudflare.com/t/why-using-r2-free-tier-involves-giving-card-info/945179)). For a strict "no card ever" rule, store images in **KV** (1 GB) instead, which needs no card.
- Access free plan: one community report says choosing it asked for a payment method ([thread](https://community.cloudflare.com/t/how-to-add-an-ztna-app-for-free-in-access-without-entering-credit-card-detail/764129)); not confirmed by Cloudflare. **(volatile / unverified)**
- **Export:** D1 is SQLite; `wrangler d1 export` dumps it to a standard `.sql` file. KV and R2 objects can be listed and downloaded by script. Low lock-in for data; moderate lock-in for code (Workers runtime APIs).

### Supabase (Postgres + Auth + Storage)

| Piece | Free limit | Source |
|---|---|---|
| Database | 500 MB per project | [Supabase pricing](https://supabase.com/pricing) |
| File storage | 1 GB, max upload 50 MB | [Supabase pricing](https://supabase.com/pricing) |
| Egress | 5 GB + 5 GB cached | [Supabase pricing](https://supabase.com/pricing) |
| Auth | 50,000 MAU | [Supabase pricing](https://supabase.com/pricing) |
| Projects | 2 active | [Supabase pricing](https://supabase.com/pricing) |

- **Inactivity pausing: free projects are paused after "1 week of inactivity"** ([pricing](https://supabase.com/pricing)). A project is inactive if it "does not receive sufficient user database activity over the past week"; a warning email arrives about one week before; restore by clicking *Resume project*; restorable "for up to 1 year after it was paused" ([project pausing](https://supabase.com/docs/guides/platform/free-project-pausing)). This window was 90 days in a June 2024 changelog ([changelog](https://supabase.com/changelog/27497-paused-free-plan-projects-are-restorable-for-90-days)) and is now 1 year. **(volatile)**
- Keep-alive pings are the usual workaround. A Cloudflare Workers cron or similar works; GitHub Actions schedules are a weaker choice because "in a public repository, scheduled workflows are automatically disabled when no repository activity has occurred in 60 days" ([GitHub docs](https://docs.github.com/en/actions/managing-workflow-runs-and-deployments/managing-workflow-runs/disabling-and-enabling-a-workflow)).
- No card required for the free plan.
- **Export:** standard Postgres (`pg_dump`), Storage files downloadable. Low lock-in for data; Auth and Row Level Security are Supabase-flavoured but well documented.
- Very agent-friendly: one dashboard/CLI for database, login and image storage.

### Neon (Postgres + Auth + Object Storage)

| Piece | Free limit | Source |
|---|---|---|
| Database | 1 GB per project, 20 GB across projects, 100 projects | [Neon pricing](https://neon.com/pricing) |
| Compute | 100 CU-hours per project per month | [Neon pricing](https://neon.com/pricing) |
| Egress | 5 GB per project, shared with Object Storage and Functions | [Neon pricing](https://neon.com/pricing), [Neon Object Storage](https://neon.com/docs/storage/overview) |
| Object Storage | 5 GB per project | [Neon pricing](https://neon.com/pricing), [Neon Object Storage](https://neon.com/docs/storage/overview) |
| Auth | up to 60k MAU per project | [Neon pricing](https://neon.com/pricing) |

- Compute "suspends after 5 min, cannot be turned off" on Free; first request after that has a cold start (duration not stated on the pricing page). Data is **not** paused or deleted for inactivity. No card required; the Free plan is permanent ([pricing](https://neon.com/pricing)).
- Hitting CU-hour or egress limits suspends compute until next month; storage over limit blocks writes; nothing is deleted ([pricing](https://neon.com/pricing)).
- The Postgres allowance rose from 0.5 GB to 1 GB per project, and Object Storage / Auth are newer products. **(volatile)**
- **Export:** standard Postgres; S3-style object storage. Low lock-in.
- Neon has no static web hosting; pair it with Vercel or Cloudflare Workers.

### Vercel Hobby (hosting, optional Blob)

- 100 GB Fast Data Transfer, 1 M function invocations, 4 active CPU-hours, 5,000 image transformations per month; **non-commercial personal use only**; exceeding a limit usually means waiting 30 days ([Hobby plan](https://vercel.com/docs/plans/hobby), page updated 2026-09-14).
- Blob on Hobby: 1 GB storage, 10,000 simple ops, **2,000 advanced ops (uploads)**, 10 GB transfer per month; no charge, but Blob stops for 30 days if exceeded ([Blob pricing](https://vercel.com/docs/vercel-blob/usage-and-pricing)).
- No card, no inactivity pausing documented. Excellent for Next.js; agents deploy with the CLI or a GitHub link.

### Ruled out or weaker

- **Firebase Spark:** Firestore 1 GiB, 50K reads/day, 20K writes/day; Hosting 10 GB, 360 MB/day transfer ([Firebase pricing](https://firebase.google.com/pricing)). But **Cloud Storage now requires the Blaze (pay-as-you-go, card) plan, even for default buckets, from 3 February 2026** ([Firebase storage FAQ](https://firebase.google.com/docs/storage/faqs-storage-changes-announced-sept-2024)). Images would need a second provider; Firestore is also the hardest to export into a relational shape.
- **Netlify Free:** moved to a "300 credit limit" model where bandwidth and compute draw from one pool ([Netlify pricing](https://www.netlify.com/pricing/)); the page does not say what happens when credits run out. Workable for hosting but harder to reason about. **(volatile)**
- **Turso Free:** 5 GB, 500 M rows read / 10 M written per month, 100 databases ([Turso pricing](https://turso.tech/pricing)). Fine as a database, but the pricing page contradicts itself on whether a card is needed and has no image storage. **(volatile)**

## Single-user login

All shortlisted stacks can do it without a third-party paid service:

- **Built-in auth** (Supabase Auth, Neon Auth): email magic link or password, sign-ups disabled after the owner's account is created.
- **Cloudflare Access** in front of the whole app: one-time PIN to the owner's email, no login code to write. Free for up to 50 users.
- **App-level single password / passkey** stored as a secret: smallest, no external dependency.

## Shortlist

### 1. Cloudflare all-in (recommended)

Workers (app + API, static assets) + D1 (database) + KV for images (or R2 if a card on file is acceptable) + Cloudflare Access or built-in login.

- No inactivity pausing, no cold-start database, generous daily limits for one person.
- One vendor, one CLI (`wrangler`), deploy in one command; agents handle it well.
- Watch: D1 500 MB per database on Free (ample for text, not for images); KV 1,000 writes/day (plenty for one person's captures); R2 needs a card and has no hard spending cap.
- Export: SQLite dump plus a script that downloads images.

### 2. Supabase + static host

Supabase (Postgres, Auth, 1 GB Storage) + hosting on Cloudflare Workers static assets or Vercel Hobby.

- The most "batteries included"; very well documented for agents.
- **Main risk: the project pauses after about a week with little database activity.** A single user on holiday will hit this. Needs a scheduled keep-alive ping (Cloudflare cron recommended over GitHub Actions). Restorable for 1 year, so data is not lost, but the app is down until resumed.
- 1 GB image storage is the tightest cap of the three.

### 3. Neon + Vercel Hobby

Neon (Postgres, Auth, 5 GB Object Storage) + Vercel Hobby for the Next.js app.

- No pausing of data; only a cold start after 5 idle minutes.
- Most headroom for images (5 GB) and database (1 GB) without a card.
- Watch: Neon Auth and Object Storage are new and their free numbers have recently changed; 5 GB egress shared across database and images; Vercel Hobby is personal/non-commercial only (fine here).

## Implications for the map

- A Firebase-based stack should be dropped: image storage now requires a card.
- If Supabase is chosen, a keep-alive job becomes part of the v1 spec.
- Whichever stack is chosen, compress images client-side before upload (keeps every option inside its free storage for years).
- Decide in plain language with the owner: **is a credit card on file acceptable if nothing is ever charged?** That single answer decides R2 vs KV for images on option 1.

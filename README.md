# Regulatory Wiki

A regulatory-intelligence wiki for Indian regulators. Scrapers watch each
regulator's own site for new instruments, an LLM classification step maps every
new document onto that regulator's taxonomy, a human reviews anything the
classifier was unsure about, and the result is browsable as a structured wiki.

## What it does

```
regulator website  ->  watcher/scraper  ->  adapter  ->  ingest (LLM)  ->  Postgres  ->  wiki UI
   (live source)      (scrapers/*)      (normalised   (lib/ingest.ts)    (Prisma)     (app/*)
                                          JSON)
```

- **Scrape** — one watcher per regulator under `scrapers/`, driven by
  `lib/sync.ts`. Most are Python (Playwright where the site needs a real
  browser); Saral Sanchar and DST are TypeScript. CCI and FIU-IND are
  standalone Python packages with their own SQLite store and OCR fallback for
  scanned pre-2015 PDFs.
- **Normalise** — each regulator's `run_*_adapter.py` turns its scraper output
  into the common normalised-JSON shape.
- **Ingest** — `lib/ingest.ts` deduplicates against what is already known, then
  calls the configured AI model (any OpenAI-compatible provider, set by
  `LLM_*` in `.env`) to classify each genuinely new document against that
  regulator's taxonomy (Instrument Type, Subject, Status, and other facets).
  Low-confidence results are flagged rather than published.
- **Review** — `/admin/review` is the human queue for flagged entries.
- **Browse** — the public wiki: documents, regulators, domains, subjects and
  instruments.

Regulators currently wired up: **DOT, MTCTE, MIB, EPFO, ESIC, CLC,
SARALSANCHAR, DST, DOS-ISRO, CCI, FIU-IND, MERC**.

**CPPP** has a scraper, adapter and seeded taxonomy but is deliberately *not*
registered for scheduled sync: a tender and its corrigendum arrive as two
unlinked documents, and that linking is unbuilt. See
`scrapers/cppp-taxonomy-findings.md`. **MERC**'s first sync is a ~20,600
document backfill rather than a daily delta — run it deliberately, not from the
cron (see the note in `lib/sync.ts`).

## Stack

Next.js 16 (App Router) · React 19 · Prisma 7 + PostgreSQL · NextAuth
(Credentials) · Tailwind 4 · Python 3.12 + Playwright for the scrapers.

> **Note on Next.js:** this project is on Next.js 16, which renamed the
> `middleware` file convention to `proxy` (see `proxy.ts`) and changed other
> APIs. Read `node_modules/next/dist/docs/` before assuming an older API —
> see `AGENTS.md`.

## Getting started

### 1. Prerequisites

- Node.js 20+
- Python 3.12+ (only needed to run the scrapers)
- A PostgreSQL database
- Poppler and Tesseract on `PATH` — only for the CCI and FIU-IND OCR fallback
  (`sudo apt-get install -y poppler-utils tesseract-ocr`)

### 2. Configure

```bash
cp .env.example .env
```

Fill in `DATABASE_URL`, the three `LLM_*` model settings, `NEXTAUTH_SECRET` and
`NEXTAUTH_URL`. Generate a fresh `NEXTAUTH_SECRET` per environment:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

### 3. Install

```bash
npm install
npx prisma generate        # writes the client into app/generated/prisma

# Python side, only if you will run the scrapers
pip install -r scrapers/requirements.txt
pip install -r scrapers/cci_scraper/requirements.txt
pip install -r scrapers/fiu_scraper/requirements.txt
python -m playwright install --with-deps chromium
```

### 4. Create the schema and seed the taxonomies

```bash
npx prisma migrate deploy          # `migrate dev` when changing the schema

# One seed script per regulator; each is idempotent (upserts).
npx tsx prisma/seed-dot.ts
npx tsx prisma/seed-mtcte.ts
npx tsx prisma/seed-mib.ts
npx tsx prisma/seed-employment-law.ts   # EPFO, ESIC, CLC
npx tsx prisma/seed-saral-sanchar.ts
npx tsx prisma/seed-dst.ts
npx tsx prisma/seed-dos-isro.ts
npx tsx prisma/seed-cci.ts
npx tsx prisma/seed-fiu.ts
npx tsx prisma/seed-merc.ts
npx tsx prisma/seed-cppp.ts
```

### 5. Create an admin account

There is no public signup by design. Provision an admin from a machine that
has `DATABASE_URL`:

```bash
npx tsx scripts/set-admin-password.ts you@firm.com 'a-strong-password' 'Your Name'
```

### 6. Run

```bash
npm run dev     # http://localhost:3000 — admin at /admin/review
```

## Running a sync

```bash
npm run sync                              # every regulator
npx tsx scripts/sync-all.ts --only CCI    # just one
npm run sync:runs                         # recent run history
```

Every run is recorded in the `SyncRun` / `SyncRunRegulator` tables — that, not
the console output, is the durable record. A regulator being *blocked* by its
source site is a recorded outcome, not a job failure: `sync-all.ts` exits
non-zero only if every regulator errored.

`.github/workflows/daily-sync.yml` runs the same command daily at 03:00 UTC.
It needs these repository settings under **Settings → Secrets and variables →
Actions**: secrets `DATABASE_URL` and `LLM_API_KEY`, and variables
`LLM_BASE_URL` and `LLM_MODEL`.

> **No credentials live in this repository.** `.env` is gitignored, and every
> connection string or key in tracked files is a placeholder. The real values
> exist in two places only: each developer's local `.env`, and the GitHub
> repository secrets above. Whoever runs this needs their own `DATABASE_URL`
> and model settings (`LLM_*`) in both. A repository without those secrets fails its
> scheduled run each morning; that is the pending-setup signal, not a broken
> build.

## Layout

| Path | What lives there |
| --- | --- |
| `app/` | Next.js routes — public wiki, `/admin/review`, auth route |
| `lib/` | Domain logic: `sync.ts`, `ingest.ts`, `queries.ts`, `auth.ts` |
| `prisma/` | Schema, migrations, and one seed script per regulator |
| `scrapers/` | Per-regulator watchers and adapters (Python + TypeScript) |
| `scripts/` | Operational CLIs: sync, per-regulator ingestion, backfills |
| `types/` | Ambient type declarations |

## Deployment notes

- The app needs `DATABASE_URL`, `NEXTAUTH_SECRET` and `NEXTAUTH_URL`. It reads
  the database only — the `LLM_*` model settings are needed by the sync job, not by the
  web app.
- Run `npx prisma migrate deploy` as part of each deploy.
- Set `NEXTAUTH_URL` to the real public origin, and use a `NEXTAUTH_SECRET`
  generated for that environment rather than one copied from another.
- Scraper output directories (`scrapers/*/data`, `scrapers/*/output`) are
  gitignored and regenerated by running the scrapers; nothing there is source.

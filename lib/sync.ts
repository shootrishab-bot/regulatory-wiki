/**
 * Daily sync: re-scrape each regulator, ingest only genuinely new documents.
 *
 * DESIGN NOTES
 * ------------
 * Nothing here re-implements scraping, blocked-detection, dedup, or
 * classification. Each of those already exists and is reused:
 *
 *   scraping + blocked-detection  the regulator's own Python watcher
 *   normalisation                 the regulator's own run_*_adapter.py
 *   dedup                         ingestBatch() -> findExistingSourceDocument,
 *                                 which matches on (regulatorId, sourceId),
 *                                 the scraper's own stable hash
 *   classification                ingestBatch() -> DeepSeek, unchanged
 *
 * This module is the orchestration and the honest bookkeeping around them.
 *
 * BLOCKED DETECTION, and its one real gap. The watchers already detect and
 * report blocking, but none of them exits with a distinct status code, so
 * blocking is read from the markers they already print:
 *
 *   DoT    "!!! BLOCKED (403 Access Denied)" / "were BLOCKED"   (real, tested)
 *   MIB    "[BLOCKED] ..."                                       (real)
 *   MTCTE  -- none. mtcte_watcher.py has no blocked-detection at all.
 *
 * That MTCTE gap is genuine and is NOT papered over: its entry below sets
 * hasBlockedDetection=false, and a run where MTCTE returns nothing is
 * reported as "no blocked-detection available" rather than being silently
 * presented as a confident "0 new documents".
 *
 * Blocking is graded, not binary. A 403 on one page does not discard the run:
 * dot_watcher.py deliberately keeps going and still writes its output, so a
 * partial block is recorded in `detail` and the documents that DID come back
 * are still ingested. Only a run that both saw blocking AND failed to produce
 * usable output is marked BLOCKED and skipped. Either way the run continues to
 * the next regulator -- one site refusing us must not cost us the other two.
 *
 * BLOCKED never means "zero new documents". That distinction is the whole
 * point of the status: a future digest must not report "nothing new from DoT"
 * when the truth is "we could not see DoT today".
 */

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { prisma } from "./prisma";
import { ingestBatch, type NormalizedDocument } from "./ingest";
import { withDbRetry, BATCH_RETRY_DELAYS_MS } from "./db-retry";

const SCRAPERS_DIR = path.join(process.cwd(), "scrapers");

export interface RegulatorSync {
  code: string;
  /**
   * Which interpreter runs `watcher`/`adapter`. Defaults to "python" --
   * every scraper in this project needs Playwright except Saral Sanchar's,
   * which needs no browser automation at all (eservices.dot.gov.in is a
   * plain, unprotected site -- confirmed live 2026-08-14, see
   * scrapers/saral-sanchar/scrape.ts's docstring) and is written in
   * TypeScript instead, run via `npx tsx`.
   */
  runtime?: "python" | "node";
  /** Entrypoint that scrapes and updates the master CSV (or, for a "node"
   * runtime script with no `adapter`, writes normalizedJson directly). */
  watcher: string;
  /**
   * Entrypoint that turns the master CSV into normalized JSON. Optional --
   * omit when `watcher` already writes normalizedJson itself (Saral
   * Sanchar's combined watch.ts has no intermediate CSV format to justify a
   * separate adapter step -- see its own module docstring).
   */
  adapter?: string;
  /** Normalized JSON path, relative to scrapers/. */
  normalizedJson: string;
  /**
   * Substrings the watcher prints when the site refuses us. Empty array means
   * this scraper has no blocked-detection -- see the module note.
   */
  blockedMarkers: string[];
  hasBlockedDetection: boolean;
  /**
   * Overrides the shared SCRAPE_TIMEOUT_MS (45 min, sized for DoT's real
   * per-topic-page crawl -- see that constant's own comment) for a
   * regulator whose real runtime shape is different enough that the shared
   * value is actively wrong for it. Added for CCI specifically -- see its
   * own entry below for the real measured numbers behind the value chosen,
   * not a guess.
   */
  scrapeTimeoutMs?: number;
}

export const REGULATORS: RegulatorSync[] = [
  {
    code: "DOT",
    watcher: "dot_watcher.py",
    adapter: "run_dot_adapter.py",
    normalizedJson: "dot/dot_normalized.json",
    blockedMarkers: ["BLOCKED (403 Access Denied)", "were BLOCKED", "!!! BLOCKED"],
    hasBlockedDetection: true,
  },
  {
    code: "MTCTE",
    watcher: "mtcte_watcher.py",
    adapter: "run_mtcte_adapter.py",
    normalizedJson: "data/mtcte_normalized.json",
    blockedMarkers: [],
    hasBlockedDetection: false,
  },
  {
    code: "MIB",
    watcher: "mib_updates_scrapper.py",
    adapter: "run_mib_adapter.py",
    normalizedJson: "data/mib_normalized.json",
    blockedMarkers: ["[BLOCKED]"],
    hasBlockedDetection: true,
  },
  // EPFO/ESIC/CLC share labour_scrape.py + labour_parser.py's real, generic
  // WAF/status-code blocked detection (is_blocked()) via labour_watcher_common.py,
  // which prints the literal "[BLOCKED]" marker (reusing MIB's exact text) on
  // any blocked page -- see labour_watcher_common.py's module docstring. MoLE
  // is deliberately NOT here: both its real sources are confirmed non-functional
  // (broken mirror / blocked production site) as of 2026-08-13, with zero real
  // document evidence to seed a taxonomy from -- see
  // EmploymentLaw_Regulatory_Taxonomy_v1.0.xlsx's Schema Note sheet.
  {
    code: "EPFO",
    watcher: "labour_watcher_epfo.py",
    adapter: "run_epfo_adapter.py",
    normalizedJson: "data/epfo_normalized.json",
    blockedMarkers: ["[BLOCKED]"],
    hasBlockedDetection: true,
  },
  {
    code: "ESIC",
    watcher: "labour_watcher_esic.py",
    adapter: "run_esic_adapter.py",
    normalizedJson: "data/esic_normalized.json",
    blockedMarkers: ["[BLOCKED]"],
    hasBlockedDetection: true,
  },
  {
    code: "CLC",
    watcher: "labour_watcher_clc.py",
    adapter: "run_clc_adapter.py",
    normalizedJson: "data/clc_normalized.json",
    blockedMarkers: ["[BLOCKED]"],
    hasBlockedDetection: true,
  },
  // Saral Sanchar (DoT eServices): no adapter step (watch.ts writes
  // normalizedJson directly, see RegulatorSync.adapter's own comment), and
  // no real blocked-detection yet -- scrape.ts only distinguishes "HTTP
  // request failed" from "succeeded", not a WAF/block signature the way
  // labour_scrape.py's is_blocked() does, so a run that comes back with zero
  // rows cannot yet be told apart from a real block. Honest about that gap
  // (hasBlockedDetection: false) rather than claiming detection that isn't
  // there, same treatment MTCTE got before its own gap was fixed.
  {
    code: "SARALSANCHAR",
    runtime: "node",
    watcher: "saral-sanchar/watch.ts",
    normalizedJson: "data/saral_sanchar_normalized.json",
    blockedMarkers: [],
    hasBlockedDetection: false,
  },
  // DST: fans out to 4 real source clusters (dst-core, dst-calls, nsdi,
  // aistic) inside scrapers/dst/watch.ts itself -- one combined entrypoint,
  // same reasoning as Saral Sanchar's watch.ts (no per-cluster intermediate
  // format worth a separate RegulatorSync entry each). No real
  // blocked-detection here either -- none of the 4 real sites showed any
  // WAF/block signal during real scraping (2026-08-17), so, same honesty as
  // Saral Sanchar, this is flagged as a real gap rather than a false
  // "detected, none found".
  {
    code: "DST",
    runtime: "node",
    watcher: "dst/watch.ts",
    normalizedJson: "data/dst_normalized.json",
    blockedMarkers: [],
    hasBlockedDetection: false,
  },
  // DOS-ISRO: fans out to 3 real sources (ISRO, NSIL, IN-SPACe) inside
  // dos_isro_watcher.py itself, same one-entrypoint-per-regulator shape as
  // every other Python regulator here. The watcher is already incremental
  // (load_existing_ids() + append_to_master() -- only genuinely new rows get
  // appended to the master CSV), but run_dos_isro_adapter.py re-normalizes
  // the WHOLE csv every run regardless, so this pre-filter step still does
  // the real "new since last sync" work off of Postgres, exactly like every
  // other regulator -- no special-casing needed. No real blocked-detection:
  // neither ISRO/NSIL's plain requests nor IN-SPACe's ServiceNow session
  // bootstrap showed a WAF/block signature during real scraping, so this is
  // flagged honestly (hasBlockedDetection: false) rather than claiming
  // detection that isn't there, same treatment as Saral Sanchar/DST.
  {
    code: "DOS-ISRO",
    watcher: "dos_isro_watcher.py",
    adapter: "run_dos_isro_adapter.py",
    normalizedJson: "data/dos_isro_normalized.json",
    blockedMarkers: [],
    hasBlockedDetection: false,
  },
  // CCI: architecturally different from every other regulator here -- its
  // real scraper (cci_scraper/, a standalone package) persists to its OWN
  // SQLite database (cci_scraper/data/cci/cci_scraper.db), not to a CSV/JSON
  // a plain adapter can read directly. run_cci_scrape.py bridges into that
  // package's real `scrape` command (cwd + sys.path adjustment only, no
  // scraping logic duplicated); run_cci_adapter.py exports the resulting
  // SQLite rows to the shared NormalizedDocument JSON contract. No real
  // blocked-detection has been observed against cci.gov.in yet, same
  // honesty as Saral Sanchar/DST rather than claiming detection that isn't
  // there.
  //
  // scrapeTimeoutMs: a real diagnostic run (2026-08-25) confirmed
  // run_cci_scrape.py re-downloading/re-OCRing/re-classifying the WHOLE real
  // ~1,324-document corpus on every call took ~48.5 minutes and exceeded the
  // shared 45-minute SCRAPE_TIMEOUT_MS -- root-caused to cci_scraper/pipeline.py
  // having no check for what was already known, not fixed by just raising this
  // number (see cci_scraper/pipeline.py's filter_changed_items() and its own
  // docstring for the real fix: an incremental skip via cheap HEAD-request
  // ETag/Last-Modified comparison against cci.gov.in's real file server).
  // Re-measured live after that fix, direct timed run, same corpus: a run
  // with no real content changes now completes in ~108 seconds (1,305/1,324
  // items correctly skipped, 2 genuinely new real documents still correctly
  // classified). 20 minutes here is a safety margin sized off that number --
  // roughly 11x the real no-change runtime, comfortably enough for a real
  // burst of new documents in one day (the download step alone is
  // rate-limited to one request per 2.0s, so even ~100 brand-new PDFs would
  // only add a few minutes) -- while staying well short of the ~48 minutes a
  // full-corpus reprocess takes, so a regression that broke the skip logic
  // again would still hit this timeout and surface as a real, visible ERROR
  // rather than being silently absorbed by a timeout large enough to hide it.
  {
    code: "CCI",
    watcher: "run_cci_scrape.py",
    adapter: "run_cci_adapter.py",
    normalizedJson: "data/cci_normalized.json",
    blockedMarkers: [],
    hasBlockedDetection: false,
    scrapeTimeoutMs: 20 * 60 * 1000,
  },
  // FIU-IND: architecturally identical to CCI -- its real scraper
  // (fiu_scraper/, a standalone package built 2026-08-25) persists to its OWN
  // SQLite database (fiu_scraper/data/fiu/fiu_scraper.db), not a CSV/JSON a
  // plain adapter can read directly. run_fiu_scrape.py bridges into that
  // package's real `scrape` command (cwd + sys.path adjustment only, same
  // pattern as run_cci_scrape.py); run_fiu_adapter.py exports the resulting
  // SQLite rows to the shared NormalizedDocument JSON contract.
  //
  // REPLACES the legacy fiu_watcher.py + fiu_adapter.py (single-page top-10
  // scrape, no taxonomy) -- confirmed via a real grep of the whole repo
  // (2026-08-25) that neither legacy script was ever actually registered
  // here or anywhere else, so this is FIU-IND's first real wiring into the
  // sync pipeline, not a replacement of a previously-working entry. Verified
  // end to end before the legacy scripts were removed: a real `scrape` run
  // reached fiu_scraper's SQLite, run_fiu_adapter.py's output was ingested
  // via ingestBatch(), and the resulting SourceDocument rows were confirmed
  // in Postgres -- see scrapers/fiu_scraper/taxonomy-findings.md.
  //
  // No real blocked-detection has been observed against fiuindia.gov.in --
  // live inspection found no WAF/session-challenge behavior at all (every
  // real page and PDF returns full content on a plain unauthenticated GET),
  // so this is an honest "not yet needed" rather than a claimed gap.
  {
    code: "FIU",
    watcher: "run_fiu_scrape.py",
    adapter: "run_fiu_adapter.py",
    normalizedJson: "data/fiu_normalized.json",
    blockedMarkers: [],
    hasBlockedDetection: false,
  },
];

export type SyncStatusValue = "OK" | "BLOCKED" | "ERROR" | "SKIPPED";

export interface RegulatorResult {
  code: string;
  status: SyncStatusValue;
  scrapedRows: number;
  newDocuments: number;
  ingested: number;
  flagged: number;
  errors: number;
  detail: string | null;
  durationMs: number;
}

interface PyResult {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function runScript(
  runtime: "python" | "node",
  script: string,
  timeoutMs: number
): Promise<PyResult> {
  return new Promise((resolve) => {
    const [cmd, args] =
      runtime === "node"
        ? (["npx", ["tsx", script]] as const)
        : (["python", [script]] as const);
    const child = spawn(cmd, args, {
      cwd: SCRAPERS_DIR,
      shell: process.platform === "win32", // npx needs a shell to resolve on Windows
      // Python defaults to the console codepage on Windows and dies on real
      // scraped titles containing curly quotes; force UTF-8 for both streams.
      // Harmless no-op for the node runtime.
      env: { ...process.env, PYTHONIOENCODING: "utf-8", PYTHONUTF8: "1" },
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, timeoutMs);
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr, timedOut });
    });
    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: -1, stdout, stderr: stderr + String(err), timedOut });
    });
  });
}

// DoT is genuinely slow rather than stuck: it expands every topic/detail page
// through Playwright, and single topic pages really do contain 115+ real
// sub-documents. A 30-minute cap cut it off mid-run during testing, so the
// ceiling is generous. MIB (plain requests) finishes in ~3 minutes.
const SCRAPE_TIMEOUT_MS = 45 * 60 * 1000;
const ADAPTER_TIMEOUT_MS = 5 * 60 * 1000;

export async function syncRegulator(
  reg: RegulatorSync,
  log: (msg: string) => void
): Promise<RegulatorResult> {
  const started = Date.now();
  const base: RegulatorResult = {
    code: reg.code,
    status: "OK",
    scrapedRows: 0,
    newDocuments: 0,
    ingested: 0,
    flagged: 0,
    errors: 0,
    detail: null,
    durationMs: 0,
  };
  const done = (r: Partial<RegulatorResult>): RegulatorResult => ({
    ...base,
    ...r,
    durationMs: Date.now() - started,
  });

  const runtime = reg.runtime ?? "python";

  // -- 1. scrape ----------------------------------------------------------
  log(`[${reg.code}] running ${reg.watcher} ...`);
  const scrape = await runScript(runtime, reg.watcher, reg.scrapeTimeoutMs ?? SCRAPE_TIMEOUT_MS);
  const combined = scrape.stdout + "\n" + scrape.stderr;

  // A blocked marker does NOT by itself mean the regulator must be skipped.
  // dot_watcher.py is explicitly built to tolerate a partial block: it records
  // the sections that 403'd, keeps scraping the rest, and still writes its
  // output. Confirmed live (2026-08-05): one DoT topic page returned a real
  // 403 while the surrounding sections scraped fine. Throwing that whole run
  // away would lose real documents. So the marker is recorded, and the status
  // depends on whether usable output actually came back.
  const blockedHit = reg.blockedMarkers.find((m) => combined.includes(m));
  const blockedNote = blockedHit
    ? `Scraper reported blocking (marker: "${blockedHit}") on at least one page.`
    : null;
  const blockedCount = blockedHit
    ? combined.split(blockedHit).length - 1
    : 0;
  if (blockedHit) {
    log(`[${reg.code}] blocking seen on ${blockedCount} page(s) -- recorded, continuing`);
  }

  const scrapeFailed = scrape.timedOut || scrape.code !== 0;
  if (scrapeFailed) {
    const why = scrape.timedOut
      ? "Scraper timed out."
      : `Scraper exited ${scrape.code}: ${(scrape.stderr || scrape.stdout).trim().split("\n").slice(-3).join(" | ").slice(0, 300)}`;
    // If the site was refusing us AND the run died, blocking is the more
    // useful explanation, and BLOCKED must never be read as "zero new".
    if (blockedHit) {
      log(`[${reg.code}] BLOCKED -- ${blockedNote} Run did not complete. Skipping, continuing to next regulator.`);
      return done({
        status: "BLOCKED",
        detail: `${blockedNote} Run did not complete: ${why} NOT treated as zero new documents.`,
      });
    }
    log(`[${reg.code}] ERROR -- ${why.slice(0, 160)}`);
    return done({ status: "ERROR", errors: 1, detail: why });
  }

  // -- 2. normalise ---------------------------------------------------------
  // Optional: skipped when the watcher already writes normalizedJson itself
  // (see RegulatorSync.adapter's own comment -- Saral Sanchar's watch.ts).
  if (reg.adapter) {
    log(`[${reg.code}] running ${reg.adapter} ...`);
    const adapt = await runScript(runtime, reg.adapter, ADAPTER_TIMEOUT_MS);
    if (adapt.code !== 0) {
      const tail = (adapt.stderr || adapt.stdout).trim().split("\n").slice(-3).join(" | ");
      log(`[${reg.code}] ERROR -- adapter exited ${adapt.code}: ${tail.slice(0, 160)}`);
      return done({
        status: "ERROR",
        errors: 1,
        detail: `Adapter exited ${adapt.code}: ${tail.slice(0, 400)}`,
      });
    }
  }

  const jsonPath = path.join(SCRAPERS_DIR, reg.normalizedJson);
  if (!fs.existsSync(jsonPath)) {
    return done({
      status: "ERROR",
      errors: 1,
      detail: `Adapter produced no output at ${reg.normalizedJson}`,
    });
  }
  let docs: NormalizedDocument[];
  try {
    docs = JSON.parse(fs.readFileSync(jsonPath, "utf-8"));
  } catch (e) {
    return done({
      status: "ERROR",
      errors: 1,
      detail: `Could not parse ${reg.normalizedJson}: ${e instanceof Error ? e.message : e}`,
    });
  }
  log(`[${reg.code}] scraper produced ${docs.length} rows total`);

  // -- 3. pre-filter against Postgres -------------------------------------
  // ingestBatch would dedup anyway, but checking first means we can report a
  // real "new documents" count and avoid paying for classification on rows we
  // already have. The membership test uses the same (regulatorId, sourceId)
  // key the pipeline dedups on.
  const regulator = await withDbRetry(
    () => prisma.regulator.findUnique({ where: { code: reg.code } }),
    "sync fetch regulator",
    BATCH_RETRY_DELAYS_MS
  );
  if (!regulator) {
    return done({ status: "ERROR", errors: 1, detail: `Regulator ${reg.code} not seeded.` });
  }
  const existing = await withDbRetry(
    () =>
      prisma.sourceDocument.findMany({
        where: { regulatorId: regulator.id },
        select: { sourceId: true },
      }),
    "sync dedup snapshot",
    BATCH_RETRY_DELAYS_MS
  );
  const seen = new Set(existing.map((e) => e.sourceId));
  const fresh = docs.filter((d) => !seen.has(d.source_id));

  log(`[${reg.code}] ${fresh.length} genuinely new (of ${docs.length}; ${seen.size} already stored)`);

  if (fresh.length === 0) {
    return done({
      status: "OK",
      scrapedRows: docs.length,
      newDocuments: 0,
      detail:
        [
          blockedNote,
          reg.hasBlockedDetection
            ? null
            : "NOTE: this scraper has no blocked-detection, so a zero here cannot fully distinguish 'nothing new' from 'silently blocked'.",
        ]
          .filter(Boolean)
          .join(" ") || null,
    });
  }

  // -- 4. ingest ----------------------------------------------------------
  log(`[${reg.code}] classifying and ingesting ${fresh.length} new documents ...`);
  const results = await ingestBatch(fresh, reg.code);
  const ingested = results.filter((r) => r.status === "ingested");
  const flagged = ingested.filter((r) => r.status === "ingested" && r.needsReview).length;
  const errored = results.filter((r) => r.status === "error").length;

  log(
    `[${reg.code}] done: ${ingested.length} ingested (${flagged} flagged), ${errored} errors`
  );

  return done({
    status: errored > 0 && ingested.length === 0 ? "ERROR" : "OK",
    scrapedRows: docs.length,
    newDocuments: fresh.length,
    ingested: ingested.length,
    flagged,
    errors: errored,
    detail:
      [
        blockedNote,
        reg.hasBlockedDetection ? null : "Scraper has no blocked-detection.",
      ]
        .filter(Boolean)
        .join(" ") || null,
  });
}

export async function runSync(opts: {
  trigger: string;
  only?: string[];
  log?: (msg: string) => void;
}): Promise<{ runId: string; results: RegulatorResult[] }> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const targets = opts.only?.length
    ? REGULATORS.filter((r) => opts.only!.includes(r.code))
    : REGULATORS;

  const run = await withDbRetry(
    () => prisma.syncRun.create({ data: { trigger: opts.trigger } }),
    "create SyncRun",
    BATCH_RETRY_DELAYS_MS
  );
  log(`sync run ${run.id} (${opts.trigger}) -- ${targets.map((t) => t.code).join(", ")}\n`);

  const results: RegulatorResult[] = [];
  for (const reg of targets) {
    let result: RegulatorResult;
    try {
      result = await syncRegulator(reg, log);
    } catch (e) {
      // One regulator blowing up must not abort the others.
      result = {
        code: reg.code,
        status: "ERROR",
        scrapedRows: 0,
        newDocuments: 0,
        ingested: 0,
        flagged: 0,
        errors: 1,
        detail: e instanceof Error ? e.message.slice(0, 400) : String(e),
        durationMs: 0,
      };
      log(`[${reg.code}] ERROR -- ${result.detail}`);
    }
    results.push(result);
    try {
      await withDbRetry(
        () =>
          prisma.syncRunRegulator.create({
            data: {
              syncRunId: run.id,
              regulatorCode: result.code,
              status: result.status,
              scrapedRows: result.scrapedRows,
              newDocuments: result.newDocuments,
              ingested: result.ingested,
              flagged: result.flagged,
              errors: result.errors,
              detail: result.detail,
              durationMs: result.durationMs,
            },
          }),
        "record SyncRunRegulator",
        BATCH_RETRY_DELAYS_MS
      );
    } catch (e) {
      // Bookkeeping is not worth losing the run over: the scrape and ingest
      // for this regulator have already completed and been persisted. Report
      // loudly and carry on to the next regulator.
      log(
        `[${result.code}] WARNING -- could not record the sync log row: ` +
          `${e instanceof Error ? e.message.split("\n")[0] : e}`
      );
    }
    log("");
  }

  await withDbRetry(
    () =>
      prisma.syncRun.update({
        where: { id: run.id },
        data: { finishedAt: new Date() },
      }),
    "finish SyncRun",
    BATCH_RETRY_DELAYS_MS
  );

  return { runId: run.id, results };
}

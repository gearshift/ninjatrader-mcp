import { describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { initializeSchema } from "../../db/schema.js";
import {
  createBarCloseHandler,
  createCandlesResponseHandler,
  ingestCandles,
} from "../ingest.js";
import { getInstrumentConfig } from "../../core/sessions/registry.js";
import { loadCalendar } from "../../core/sessions/calendar.js";
import { recomputeDerivedForSessionDay } from "../../core/cache/derived.js";
import { contractForLabel, contractName, loadRolloverWindows } from "../contract-windows.js";

// Contract identity through the ingest write paths: mirror windows label
// merged historical fetches, the bar_close `contract` field labels live bars.
// Fixtures use the real June-2026 NQ roll into 09-26 on 2026-06-12.

const unix = (y: number, mo1: number, d: number, h: number): number =>
  Math.floor(Date.UTC(y, mo1 - 1, d, h, 0, 0) / 1000);

// NQ session-days label = close-date; EDT sessions start 22:00 UTC the day
// before and run 23h.
const dayStart = (y: number, mo1: number, d: number): number => unix(y, mo1, d - 1, 22);
const D11_START = dayStart(2026, 6, 11); // session 2026-06-11 (old contract)
const D12_START = dayStart(2026, 6, 12); // session 2026-06-12 (NT8 rolls here)
const D12_END = D12_START + 82_800;
const AFTER = D12_END + 3_600;

function memDb() {
  const db = new Database(":memory:");
  initializeSchema(db);
  db.prepare(
    `INSERT INTO contract_rollovers
       (symbol, contract_month, rollover_date, offset_points, was_edited, fetched_at)
     VALUES (?, ?, ?, ?, 0, 1)`,
  ).run("NQ", "2026-06-01", "2026-03-16", 208.75);
  db.prepare(
    `INSERT INTO contract_rollovers
       (symbol, contract_month, rollover_date, offset_points, was_edited, fetched_at)
     VALUES (?, ?, ?, ?, 0, 1)`,
  ).run("NQ", "2026-09-01", "2026-06-12", 282.25);
  return db;
}

function bars15m(startUnix: number, fromIdx: number, toIdx: number) {
  const out = [];
  for (let i = fromIdx; i <= toIdx; i++) {
    out.push({
      timestamp: startUnix + i * 900,
      open: 100 + i, high: 101 + i, low: 99 + i, close: 100.5 + i, volume: 10,
    });
  }
  return out;
}

function contractsOf(db: Database.Database, tf: string, start: number, end: number) {
  return (
    db
      .prepare(
        `SELECT DISTINCT contract AS ct FROM candles
          WHERE symbol='NQ' AND timeframe=? AND timestamp > ? AND timestamp <= ?
          ORDER BY ct`,
      )
      .all(tf, start, end) as Array<{ ct: string | null }>
  ).map((r) => r.ct);
}

describe("contract-windows mapping", () => {
  it("formats delivery months the way NT8 spells FullName", () => {
    // Must stay byte-equal with the private consumer's contract-name
    // derivation — stored labels and mirror-derived expectations compare by
    // string equality.
    expect(contractName("NQ", "2026-09-01")).toBe("NQ 09-26");
    expect(contractName("MNQ", "2027-03-01")).toBe("MNQ 03-27");
  });

  it("refuses a corrupt mirror whole — one non-canonical date labels nothing", () => {
    // This side cannot throw (a corrupt mirror must not break the candle
    // path), so refusal means returning no windows at all — dropping only
    // the bad row would silently shift attribution for its neighbours.
    const db = memDb();
    db.prepare(
      `INSERT INTO contract_rollovers
         (symbol, contract_month, rollover_date, offset_points, was_edited, fetched_at)
       VALUES ('NQ', '2026-12-01', '2026-9-14', 0, 0, 1)`, // non-canonical rollover_date
    ).run();
    expect(loadRolloverWindows(db, "NQ")).toEqual([]);

    // ...and the ingest path stores NULL (unattested) rather than a label
    // derived from a mirror the other side of the seam would refuse.
    createCandlesResponseHandler(db)({
      v: 1,
      id: "t-corrupt",
      type: "candles_response",
      symbol: "NQ",
      timeframe: "15m",
      candles: bars15m(D12_START, 1, 92),
      dataSource: "My Broker Feed",
      contract: "NQ 09-26",
    });
    expect(contractsOf(db, "15m", D12_START, D12_END)).toEqual([null]);
  });

  it("rejects a calendar-impossible date the regex alone would pass", () => {
    // "2026-02-30" matches \d{4}-\d{2}-\d{2} and new Date() silently rolls it
    // into March — the round-trip check must catch it, same as the private
    // side's fromisoformat. Corrupt the MONTH here (the other test corrupts
    // rollover_date) so both arms of the check are exercised.
    const db = memDb();
    db.prepare(
      `INSERT INTO contract_rollovers
         (symbol, contract_month, rollover_date, offset_points, was_edited, fetched_at)
       VALUES ('NQ', '2026-02-30', '2026-09-14', 0, 0, 1)`,
    ).run();
    expect(loadRolloverWindows(db, "NQ")).toEqual([]);
  });

  it("the cross-check warn names the NEWEST mismatching day, not the oldest", () => {
    // Days iterate ascending, so a first-mismatch latch would always fire on
    // the oldest (expected) day and suppress the interesting case: a
    // divergence on TODAY.
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const db = memDb();
      createCandlesResponseHandler(db)({
        v: 1,
        id: "t-newest",
        type: "candles_response",
        symbol: "NQ",
        timeframe: "15m",
        candles: [...bars15m(D11_START, 1, 92), ...bars15m(D12_START, 1, 92)],
        dataSource: "My Broker Feed",
        contract: "NQ 12-26", // mismatches BOTH days' mirror labels
      });
      const warns = log.mock.calls
        .map((c) => String(c[0]))
        .filter((l) => l.includes("contract cross-check"));
      expect(warns).toHaveLength(1);
      expect(warns[0]).toContain("2026-06-12"); // the newest mismatching day
      expect(warns[0]).not.toContain("2026-06-11");
    } finally {
      log.mockRestore();
    }
  });

  it("maps a label to the window containing it, rolling AT the rollover date", () => {
    const db = memDb();
    const windows = loadRolloverWindows(db, "NQ");
    expect(contractForLabel(windows, "NQ", "2026-06-11")).toBe("NQ 06-26");
    // The measured June divergence began AT the session labelled with the
    // rollover date — label >= date means the new contract.
    expect(contractForLabel(windows, "NQ", "2026-06-12")).toBe("NQ 09-26");
    expect(contractForLabel(windows, "NQ", "2026-08-15")).toBe("NQ 09-26");
  });

  it("returns null before the earliest window and for an unsynced mirror", () => {
    const db = memDb();
    const windows = loadRolloverWindows(db, "NQ");
    expect(contractForLabel(windows, "NQ", "2026-03-15")).toBeNull();
    expect(contractForLabel([], "NQ", "2026-06-12")).toBeNull();
  });
});

describe("candles_response labels rows from the mirror, per day", () => {
  it("a merged fetch spanning the roll stamps each side with its own contract", () => {
    // The whole reason contractForDay is per-DAY: one response, two
    // contracts. A response-level label would mislabel the far side.
    const db = memDb();
    createCandlesResponseHandler(db)({
      v: 1,
      id: "t1",
      type: "candles_response",
      symbol: "NQ",
      timeframe: "15m",
      candles: [...bars15m(D11_START, 1, 92), ...bars15m(D12_START, 1, 92)],
      dataSource: "My Broker Feed",
      priceBasis: "as_traded",
      mergePolicy: "MergeNonBackAdjusted",
      contract: "NQ 09-26", // the resolved instrument — current window only
    });
    expect(contractsOf(db, "15m", D11_START, D11_START + 82_800)).toEqual(["NQ 06-26"]);
    expect(contractsOf(db, "15m", D12_START, D12_END)).toEqual(["NQ 09-26"]);
    // Derived rows inherit per day, same rule as price_basis.
    expect(contractsOf(db, "1h", D11_START, D11_START + 82_800)).toEqual(["NQ 06-26"]);
    expect(contractsOf(db, "1h", D12_START, D12_END)).toEqual(["NQ 09-26"]);
  });

  it("an unsynced mirror stores NULL — unattested, never guessed from the response", () => {
    const db = new Database(":memory:");
    initializeSchema(db); // no mirror rows
    createCandlesResponseHandler(db)({
      v: 1,
      id: "t2",
      type: "candles_response",
      symbol: "NQ",
      timeframe: "15m",
      candles: bars15m(D12_START, 1, 92),
      dataSource: "My Broker Feed",
      contract: "NQ 09-26",
    });
    expect(contractsOf(db, "15m", D12_START, D12_END)).toEqual([null]);
  });
});

describe("bar_close labels by what actually produced the bar", () => {
  const candle = {
    timestamp: D12_START + 900,
    open: 1, high: 2, low: 0.5, close: 1.5, volume: 3,
  };

  it("a live bar is the subscribed instrument's own trade — msg.contract wins", () => {
    // Roll-week wrinkle: NT8's series rolled on 06-12 but this subscription
    // still serves the June contract. The row must say June — labelling it
    // September because the table says so would attest bars that contract
    // never traded. The splice, not ingest, is where the mismatch refuses.
    const db = memDb();
    createBarCloseHandler(db)({
      v: 1, type: "bar_close", symbol: "NQ", timeframe: "15m",
      candle, contract: "NQ 06-26", dataSource: "My Broker Feed",
    });
    expect(contractsOf(db, "15m", D12_START, D12_END)).toEqual(["NQ 06-26"]);
  });

  it("a backfill bar is STILL the subscription's own trade — msg.contract wins", () => {
    // `backfill` is a staleness tag, not provenance — it's still a trade of
    // the subscribed instrument (e.g. a catch-up flush after a stall).
    // Labelling it from the mirror would launder old-contract bars into the
    // new era during a roll, exactly when stalls and rolls coincide.
    const db = memDb();
    createBarCloseHandler(db)({
      v: 1, type: "bar_close", symbol: "NQ", timeframe: "15m",
      candle, contract: "NQ 06-26", dataSource: "My Broker Feed", backfill: true,
    });
    expect(contractsOf(db, "15m", D12_START, D12_END)).toEqual(["NQ 06-26"]);
  });

  it("an old AddOn without the field stores NULL — never the mirror", () => {
    // A mirror-derived label would make the splice's cross-check circular.
    // NULL is unattested and fail-closed; day-refill relabels it honestly.
    const db = memDb();
    createBarCloseHandler(db)({
      v: 1, type: "bar_close", symbol: "NQ", timeframe: "15m",
      candle, dataSource: "My Broker Feed",
    });
    expect(contractsOf(db, "15m", D12_START, D12_END)).toEqual([null]);
  });
});

describe("derived-contract rule under heterogeneity", () => {
  it("a day whose 15m rows carry TWO contracts derives NULL, not a coin flip", () => {
    // The mixed-write hazard itself: merged fetch and stale subscription
    // wrote the same day. A derived bar cannot claim a contract its
    // constituents don't agree on.
    const db = memDb();
    ingestCandles("NQ", "15m", bars15m(D12_START, 1, 92), db, {
      mode: "day-refill",
      nowUnix: AFTER,
      contractForDay: () => "NQ 09-26",
    });
    db.prepare(
      `UPDATE candles SET contract = 'NQ 06-26'
        WHERE symbol='NQ' AND timeframe='15m' AND timestamp <= ?`,
    ).run(D12_START + 46 * 900);

    const config = getInstrumentConfig("NQ");
    const calendar = loadCalendar(db, config.session.name);
    recomputeDerivedForSessionDay(
      db, "NQ",
      { label: "2026-06-12", startUnix: D12_START, endUnix: D12_END },
      config, calendar, AFTER,
    );
    for (const tf of ["30m", "1h", "2h", "4h"]) {
      expect(contractsOf(db, tf, D12_START, D12_END), tf).toEqual([null]);
    }
  });
});

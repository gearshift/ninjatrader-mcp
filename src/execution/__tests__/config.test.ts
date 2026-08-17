import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  READ_ONLY_BUILD,
  isTradingRegistrationEnabled,
  isRiskReducingRegistrationEnabled,
} from "../config.js";

// Registration matrix (TRADING.md); process.env wins over .env.local, so these two keys fully determine the verdict.
describe("write-tool registration matrix", () => {
  const KEYS = ["NT_TRADING_ENABLED", "NT_TRADING_ALLOW_ACCOUNTS"] as const;
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of KEYS) saved[k] = process.env[k];
  });
  afterEach(() => {
    for (const k of KEYS) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  });
  function set(enabled: string, accounts: string): void {
    process.env.NT_TRADING_ENABLED = enabled;
    process.env.NT_TRADING_ALLOW_ACCOUNTS = accounts;
  }

  it("compiled read-only build registers no write tools even when env enables and allow-lists them", () => {
    set("1", "Sim101");
    expect(READ_ONLY_BUILD).toBe(true);
    expect(isTradingRegistrationEnabled()).toBe(false);
    expect(isRiskReducingRegistrationEnabled()).toBe(false);
  });

  it("disabled + allow-listed still registers no risk-reducing tools in the read-only build", () => {
    set("0", "Sim101");
    expect(isTradingRegistrationEnabled()).toBe(false);
    expect(isRiskReducingRegistrationEnabled()).toBe(false);
  });

  it("enabled + EMPTY allow-list → NONE (risk-adding needs an account too)", () => {
    set("1", "");
    expect(isTradingRegistrationEnabled()).toBe(false);
    expect(isRiskReducingRegistrationEnabled()).toBe(false);
  });

  it("disabled + empty allow-list → none", () => {
    set("0", "");
    expect(isTradingRegistrationEnabled()).toBe(false);
    expect(isRiskReducingRegistrationEnabled()).toBe(false);
  });
});

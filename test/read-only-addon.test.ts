import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const source = readFileSync(
  join(process.cwd(), "ninja-addon", "addons", "mcp-bridge.cs"),
  "utf8",
);

describe("read-only NinjaTrader AddOn build", () => {
  it("advertises no write capabilities", () => {
    expect(source).toMatch(/private const bool\s+ReadOnlyBuild\s*=\s*true\s*;/);
    expect(source).toMatch(/WriteCaps\s*=\s*new string\[0\]\s*;/);
  });

  it("routes every order-write message to the read-only rejection path", () => {
    const start = source.indexOf('case "place_order":');
    const end = source.indexOf("default:", start);
    expect(start).toBeGreaterThan(0);
    expect(end).toBeGreaterThan(start);
    const dispatch = source.slice(start, end);

    for (const type of [
      "place_order",
      "place_oco",
      "cancel_order",
      "cancel_all",
      "flatten",
      "change_order",
    ]) {
      expect(dispatch).toContain(`case "${type}":`);
    }
    expect(dispatch).toContain("RejectReadOnlyWrite(obj, type)");
    expect(dispatch).not.toMatch(/Handle(?:PlaceOrder|PlaceOco|CancelOrder|CancelAll|Flatten|ChangeOrder)/);
  });
});

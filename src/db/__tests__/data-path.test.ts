import { describe, expect, it } from "vitest";
import path from "node:path";
import { resolveDataPath } from "../data-path.js";

describe("resolveDataPath", () => {
  const repoRoot = path.resolve("C:/repo");

  it("nests Vitest workers and runs beneath the configured test base path", () => {
    expect(
      resolveDataPath(
        { VITEST: "true", NT_DATA_PATH: ".test-data", VITEST_POOL_ID: "3" },
        repoRoot,
        1234,
      ),
    ).toBe(path.resolve(".test-data", "vitest-1234-3"));
  });

  it("preserves an explicit runtime NT_DATA_PATH exactly outside Vitest", () => {
    expect(
      resolveDataPath({ NT_DATA_PATH: "C:/custom/nt-data" }, repoRoot, 1234),
    ).toBe(path.resolve("C:/custom/nt-data"));
  });

  it("uses the repository data directory for an unconfigured runtime", () => {
    expect(resolveDataPath({}, repoRoot, 1234)).toBe(path.join(repoRoot, "data"));
  });
});

import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const serverSource = readFileSync(join(process.cwd(), "src", "server.ts"), "utf8");

describe("read-only server composition", () => {
  it("does not wire the /feed order execution gateway", () => {
    expect(serverSource).toContain("consumerHub.bindExecution(null)");
    expect(serverSource).not.toContain('import { getExecutionService } from "./execution/service.js"');
    expect(serverSource).not.toContain("consumerHub.bindExecution(getExecutionService())");
  });
});

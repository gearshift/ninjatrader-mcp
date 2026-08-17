#!/usr/bin/env node
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

const forbidden = new Set([
  "place_order",
  "place_oco",
  "change_order",
  "cancel_order",
  "cancel_all",
  "flatten",
]);

const client = new Client(
  { name: "read-only-surface-verifier", version: "1.0.0" },
  { capabilities: {} },
);
const transport = new StdioClientTransport({
  command: process.execPath,
  args: ["scripts/mcp-entry.mjs"],
  cwd: process.cwd(),
  stderr: "pipe",
});

try {
  await client.connect(transport);
  const { tools } = await client.listTools();
  const names = tools.map((tool) => tool.name).sort();
  const exposedWrites = names.filter((name) => forbidden.has(name));
  if (exposedWrites.length > 0) {
    throw new Error(`write tools exposed: ${exposedWrites.join(", ")}`);
  }
  if (!names.includes("get_deployment_registry")) {
    throw new Error("get_deployment_registry is missing");
  }
  console.log(
    JSON.stringify(
      {
        ok: true,
        toolCount: names.length,
        writeToolsExposed: [],
        deploymentRegistryPresent: true,
      },
      null,
      2,
    ),
  );
} finally {
  await client.close();
}

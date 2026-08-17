import { existsSync } from "fs";
import { join } from "path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import {
  buildDeploymentRegistryView,
  loadDeploymentRegistry,
  type DeploymentRegistry,
  type ObservedAccount,
} from "../deployments/registry.js";
import { getLiveFeedRuntime } from "../live/runtime.js";
import { errorResult, jsonResult, type ToolResult } from "./result.js";

export interface DeploymentRegistryToolDeps {
  registryPath: () => string | undefined;
  loadRegistry: (path: string) => DeploymentRegistry;
  refreshAccounts: () => Promise<{ ok: boolean; error?: string }>;
  accounts: () => ObservedAccount[];
}

const defaultDeps: DeploymentRegistryToolDeps = {
  registryPath: () => {
    if (process.env.NT_DEPLOYMENT_REGISTRY) return process.env.NT_DEPLOYMENT_REGISTRY;
    const local = join(process.cwd(), "deployment-registry.json");
    return existsSync(local) ? local : undefined;
  },
  loadRegistry: loadDeploymentRegistry,
  refreshAccounts: async () => {
    const runtime = getLiveFeedRuntime();
    if (!runtime) return { ok: false, error: "live feed runtime not started" };
    return runtime.positions.pull();
  },
  accounts: () => getLiveFeedRuntime()?.positions.snapshotView() ?? [],
};

export function createGetDeploymentRegistryHandler(
  deps: DeploymentRegistryToolDeps,
) {
  return async (_args: Record<string, never>): Promise<ToolResult> => {
    const path = deps.registryPath();
    if (!path) {
      return jsonResult({
        ok: true,
        configured: false,
        enforced: false,
        deployments: [],
        advisories: [],
        message:
          "No deployment registry configured. Set NT_DEPLOYMENT_REGISTRY to a local JSON file. Registry metadata is observational and never authorizes or blocks orders.",
      });
    }

    let registry: DeploymentRegistry;
    try {
      registry = deps.loadRegistry(path);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorResult(`Invalid deployment registry '${path}': ${message}`, {
        ok: false,
        configured: true,
        enforced: false,
        registryPath: path,
      });
    }

    const refresh = await deps.refreshAccounts();
    const view = buildDeploymentRegistryView(registry, deps.accounts());
    return jsonResult({
      ...view,
      configured: true,
      registryPath: path,
      observationSource: refresh.ok ? "live" : "last-known",
      ...(refresh.ok
        ? {}
        : {
            warning:
              `${refresh.error ?? "account refresh failed"}; registry entries remain metadata, and observations may be stale.`,
          }),
    });
  };
}

export function registerGetDeploymentRegistry(server: McpServer): void {
  server.tool(
    "get_deployment_registry",
    "Read the operator-maintained registry of strategy deployments and annotate each entry with the latest observed NinjaTrader account positions/orders. The registry is metadata only: it does not hard-code instrument-to-firm routing and is never consulted by the order authorization gates. Read-only.",
    {},
    createGetDeploymentRegistryHandler(defaultDeps),
  );
}

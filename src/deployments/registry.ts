import { readFileSync } from "fs";
import { z } from "zod";

const deploymentSchema = z.object({
  id: z.string().min(1),
  strategy: z.string().min(1),
  account: z.string().min(1),
  connection: z.string().min(1).optional(),
  instruments: z.array(z.string().min(1)).default([]),
  enabled: z.boolean().default(true),
  tags: z.array(z.string().min(1)).default([]),
  notes: z.string().optional(),
});

const registrySchema = z.object({
  version: z.literal(1),
  deployments: z.array(deploymentSchema),
});

export type Deployment = z.infer<typeof deploymentSchema>;
export type DeploymentRegistry = z.infer<typeof registrySchema>;

export interface ObservedPosition {
  instrument: string;
  symbol: string;
  marketPosition: string;
  quantity: number;
}

export interface ObservedOrder {
  orderId: string;
  instrument: string;
}

export interface ObservedAccount {
  name: string;
  connection: string | null;
  connectionStatus: string | null;
  positions: ObservedPosition[];
  orders: ObservedOrder[];
}

export interface RegistryAdvisory {
  deploymentId: string;
  kind: "account_not_observed" | "connection_mismatch";
  severity: "info";
  message: string;
}

export function parseDeploymentRegistry(input: unknown): DeploymentRegistry {
  const registry = registrySchema.parse(input);
  const ids = new Set<string>();
  for (const deployment of registry.deployments) {
    if (ids.has(deployment.id)) {
      throw new Error(`duplicate deployment id: ${deployment.id}`);
    }
    ids.add(deployment.id);
  }
  return registry;
}

export function loadDeploymentRegistry(path: string): DeploymentRegistry {
  return parseDeploymentRegistry(JSON.parse(readFileSync(path, "utf8")));
}

/**
 * Join operator-declared deployment metadata to the latest observed account
 * state. This is deliberately advisory: no account, connection, strategy, or
 * instrument relationship in this registry is used to authorize or block an
 * order. The existing execution gates remain separate.
 */
export function buildDeploymentRegistryView(
  registry: DeploymentRegistry,
  accounts: ObservedAccount[],
): {
  ok: true;
  enforced: false;
  version: 1;
  deployments: Array<Deployment & Record<string, unknown>>;
  advisories: RegistryAdvisory[];
} {
  const byName = new Map(accounts.map((account) => [account.name, account]));
  const advisories: RegistryAdvisory[] = [];

  const deployments = registry.deployments.map((deployment) => {
    const account = byName.get(deployment.account);
    if (!account) {
      advisories.push({
        deploymentId: deployment.id,
        kind: "account_not_observed",
        severity: "info",
        message: `Configured account '${deployment.account}' is not in the latest observed NinjaTrader account snapshot.`,
      });
      return {
        ...deployment,
        accountObserved: false,
        connectionMatches: null,
        observation: null,
      };
    }

    const instrumentSet = new Set(deployment.instruments);
    const includeAll = instrumentSet.size === 0;
    const connectionMatches =
      deployment.connection === undefined || deployment.connection === account.connection;
    if (!connectionMatches) {
      advisories.push({
        deploymentId: deployment.id,
        kind: "connection_mismatch",
        severity: "info",
        message:
          `Registry connection '${deployment.connection}' differs from observed ` +
          `'${account.connection ?? "unknown"}'. This is advisory only.`,
      });
    }

    return {
      ...deployment,
      accountObserved: true,
      connectionMatches,
      observation: {
        connection: account.connection,
        connectionStatus: account.connectionStatus,
        positions: account.positions.filter(
          (position) => includeAll || instrumentSet.has(position.instrument),
        ),
        workingOrders: account.orders.filter(
          (order) => includeAll || instrumentSet.has(order.instrument),
        ),
      },
    };
  });

  return {
    ok: true,
    enforced: false,
    version: registry.version,
    deployments,
    advisories,
  };
}

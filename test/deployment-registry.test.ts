import { describe, expect, it } from "vitest";
import {
  buildDeploymentRegistryView,
  parseDeploymentRegistry,
} from "../src/deployments/registry.js";
import { createGetDeploymentRegistryHandler } from "../src/tools/deployment-registry.js";

const registryDocument = {
  version: 1,
  deployments: [
    {
      id: "lucid-mnq-session-open",
      strategy: "MnqSessionOpenAtrCapsResearch",
      account: "LUCID-EVAL",
      connection: "lucid",
      instruments: ["MNQ 09-26"],
      enabled: true,
      tags: ["evaluation"],
    },
    {
      id: "fundednext-mgc-mother",
      strategy: "MgcMotherEaS1CapsResearch",
      account: "FUNDEDNEXT-EVAL",
      connection: "fundednext",
      instruments: ["MGC 12-26"],
    },
  ],
};

describe("parseDeploymentRegistry", () => {
  it("accepts operator metadata without enforcing a permanent instrument-to-account mapping", () => {
    const parsed = parseDeploymentRegistry({
      version: 1,
      deployments: [
        ...registryDocument.deployments,
        {
          id: "second-mnq-route",
          strategy: "AnotherMnqStrategy",
          account: "ANOTHER-ACCOUNT",
          instruments: ["MNQ 09-26"],
        },
      ],
    });

    expect(parsed.deployments).toHaveLength(3);
    expect(parsed.deployments[1].enabled).toBe(true);
    expect(parsed.deployments[2].instruments).toEqual(["MNQ 09-26"]);
  });

  it("rejects duplicate deployment ids because ids are stable registry identities", () => {
    expect(() =>
      parseDeploymentRegistry({
        version: 1,
        deployments: [
          registryDocument.deployments[0],
          { ...registryDocument.deployments[0] },
        ],
      }),
    ).toThrow(/duplicate deployment id/i);
  });
});

describe("buildDeploymentRegistryView", () => {
  it("annotates configured deployments from observed account state without blocking mismatches", () => {
    const registry = parseDeploymentRegistry(registryDocument);
    const view = buildDeploymentRegistryView(registry, [
      {
        name: "LUCID-EVAL",
        connection: "lucid",
        connectionStatus: "Connected",
        positions: [
          {
            instrument: "MNQ 09-26",
            symbol: "MNQ",
            marketPosition: "Short",
            quantity: 1,
          },
        ],
        orders: [
          {
            orderId: "stop-1",
            name: "protective-stop",
            instrument: "MNQ 09-26",
            symbol: "MNQ",
            action: "BuyToCover",
            orderType: "StopMarket",
            state: "Working",
            quantity: 1,
            filled: 0,
          },
        ],
      },
      {
        name: "FUNDEDNEXT-EVAL",
        connection: "renamed-connection",
        connectionStatus: "Connected",
        positions: [],
        orders: [],
      },
    ]);

    expect(view.deployments[0]).toMatchObject({
      id: "lucid-mnq-session-open",
      accountObserved: true,
      connectionMatches: true,
      observation: {
        connectionStatus: "Connected",
        positions: [{ instrument: "MNQ 09-26", quantity: 1 }],
        workingOrders: [{ orderId: "stop-1" }],
      },
    });
    expect(view.deployments[1]).toMatchObject({
      id: "fundednext-mgc-mother",
      accountObserved: true,
      connectionMatches: false,
    });
    expect(view.advisories).toContainEqual(
      expect.objectContaining({
        deploymentId: "fundednext-mgc-mother",
        kind: "connection_mismatch",
      }),
    );
    expect(view.enforced).toBe(false);
  });

  it("reports an unobserved account as advisory metadata rather than a failure", () => {
    const registry = parseDeploymentRegistry(registryDocument);
    const view = buildDeploymentRegistryView(registry, []);

    expect(view.deployments[0].accountObserved).toBe(false);
    expect(view.advisories[0]).toMatchObject({
      kind: "account_not_observed",
      severity: "info",
    });
    expect(view.ok).toBe(true);
  });
});

describe("get_deployment_registry handler", () => {
  it("returns an unconfigured read-only view when no registry path is set", async () => {
    const handler = createGetDeploymentRegistryHandler({
      registryPath: () => undefined,
      loadRegistry: () => {
        throw new Error("must not load");
      },
      refreshAccounts: async () => ({ ok: true }),
      accounts: () => [],
    });

    const result = await handler({});
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toMatchObject({
      ok: true,
      configured: false,
      enforced: false,
      deployments: [],
    });
  });

  it("loads current registry metadata and refreshes observations without enforcing it", async () => {
    let refreshed = 0;
    const handler = createGetDeploymentRegistryHandler({
      registryPath: () => "deployments.json",
      loadRegistry: () => parseDeploymentRegistry(registryDocument),
      refreshAccounts: async () => {
        refreshed++;
        return { ok: true };
      },
      accounts: () => [
        {
          name: "LUCID-EVAL",
          connection: "lucid",
          connectionStatus: "Connected",
          positions: [],
          orders: [],
        },
      ],
    });

    const result = await handler({});
    const payload = JSON.parse(result.content[0].text);
    expect(refreshed).toBe(1);
    expect(payload).toMatchObject({
      ok: true,
      configured: true,
      enforced: false,
      registryPath: "deployments.json",
    });
    expect(payload.deployments).toHaveLength(2);
  });
});

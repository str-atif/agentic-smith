import { ToolRegistry } from "@clpc/tools";
import { afterEach, describe, expect, it } from "vitest";
import { CraftlandDiscovery } from "../src/discovery";
import { CraftlandIntegration } from "../src/craftland";
import { createStubMcpServer, StubMcpServer } from "./stub";

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitFor(
  predicate: () => boolean | Promise<boolean>,
  timeoutMs = 3000,
  intervalMs = 20
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await predicate()) return;
    await wait(intervalMs);
  }
  throw new Error(`Timed out waiting for condition`);
}

let servers: StubMcpServer[] = [];
let pendingPorts: number[] = [];

async function track(server: StubMcpServer): Promise<StubMcpServer> {
  servers.push(server);
  return server;
}

function discoveryFor(ports: () => number[], pid = 4242): CraftlandDiscovery {
  return new CraftlandDiscovery({
    detectProcessFn: async () => ({ pid, name: "Craftland Studio.exe" }),
    resolvePorts: async () => ports(),
    resolveExecPath: async () => null,
    readRegistry: async () => null,
    verifyTimeoutMs: 2000,
  });
}

afterEach(async () => {
  pendingPorts = [];
  for (const server of servers) {
    await server.close().catch(() => {});
  }
  servers = [];
});

describe("CraftlandIntegration lifecycle", () => {
  it("connects to a live Craftland MCP and registers tools", async () => {
    const server = await track(await createStubMcpServer());
    pendingPorts = [server.port];

    const registry = new ToolRegistry();
    const integration = new CraftlandIntegration({
      registry,
      discovery: discoveryFor(() => pendingPorts),
      pollIntervalMs: 30,
    });

    const states: string[] = [];
    integration.onStatus((info) => states.push(info.state));

    await integration.start();

    expect(integration.current.state).toBe("connected");
    expect(integration.current.pid).toBe(4242);
    expect(integration.current.port).toBe(server.port);
    expect(integration.current.endpoint).toBe("/mcp");
    expect(integration.current.serverName).toBe("FE Demo");
    expect(integration.current.toolCount).toBe(2);
    expect(integration.current.scene).toBe("Beach");

    expect(registry.find("mcp_craftland_set_spawn_point")).toBeDefined();
    expect(registry.find("mcp_craftland_get_map_info")).toBeDefined();

    await integration.stop();
    expect(registry.find("mcp_craftland_set_spawn_point")).toBeUndefined();
    expect(states).toContain("connected");
  });

  it("reports unavailable when Craftland is not running", async () => {
    pendingPorts = [];
    const integration = new CraftlandIntegration({
      discovery: discoveryFor(() => pendingPorts),
      pollIntervalMs: 30,
    });

    await integration.start();
    expect(integration.current.state).toBe("unavailable");

    await integration.stop();
  });

  it("moves to error when the MCP session fails after discovery", async () => {
    const server = await track(await createStubMcpServer());
    server.setToolsListError(true);
    pendingPorts = [server.port];

    const integration = new CraftlandIntegration({
      discovery: discoveryFor(() => pendingPorts),
      pollIntervalMs: 30,
    });

    await integration.start();
    expect(integration.current.state).toBe("error");
    expect(integration.current.error).toBeTruthy();

    await integration.stop();
  });

  it("reconnects automatically after a restart on a new port", async () => {
    let first = await track(await createStubMcpServer());
    let second = await track(await createStubMcpServer());

    const firstPort = first.port;
    let currentPort = firstPort;
    pendingPorts = [currentPort];

    const registry = new ToolRegistry();
    const integration = new CraftlandIntegration({
      registry,
      discovery: discoveryFor(() => pendingPorts),
      pollIntervalMs: 15,
    });

    await integration.start();
    expect(integration.current.state).toBe("connected");
    expect(integration.current.port).toBe(firstPort);
    expect(registry.find("mcp_craftland_set_spawn_point")).toBeDefined();

    const statuses: string[] = [];
    integration.onStatus((info) => statuses.push(info.state));

    await first.close();
    first = null as unknown as StubMcpServer;
    await waitFor(() => integration.current.state === "unavailable");

    expect(integration.current.state).toBe("unavailable");
    expect(registry.find("mcp_craftland_set_spawn_point")).toBeUndefined();

    currentPort = second.port;
    pendingPorts = [currentPort];
    await waitFor(() => integration.current.state === "connected");

    expect(integration.current.state).toBe("connected");
    expect(integration.current.port).toBe(second.port);
    expect(registry.find("mcp_craftland_set_spawn_point")).toBeDefined();
    expect(statuses).toContain("reconnecting");

    await integration.stop();
  });
});

describe("CraftlandIntegration retry", () => {
  it("manually reconnects after being unavailable", async () => {
    pendingPorts = [];
    const integration = new CraftlandIntegration({
      discovery: discoveryFor(() => pendingPorts),
      pollIntervalMs: 30,
    });

    await integration.start();
    expect(integration.current.state).toBe("unavailable");

    const server = await track(await createStubMcpServer());
    pendingPorts = [server.port];

    await integration.retry();
    expect(integration.current.state).toBe("connected");

    await integration.stop();
  });
});
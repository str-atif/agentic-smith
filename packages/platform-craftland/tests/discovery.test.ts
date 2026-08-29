import { afterEach, describe, expect, it } from "vitest";
import http, { Server } from "http";
import { AddressInfo } from "net";
import {
  CRAFTLAND_MCP_SERVER_NAME,
  CraftlandDiscovery,
  normalizeLocalUrl,
  probeMcpEndpoint,
  verifyMcpEndpoint,
} from "../src/discovery";
import { createStubMcpServer, StubMcpServer } from "./stub";
import { newestRegistryProject, parseDebugRegistry } from "../src/registry";

let servers: StubMcpServer[] = [];

async function track(server: StubMcpServer): Promise<StubMcpServer> {
  servers.push(server);
  return server;
}

afterEach(async () => {
  for (const server of servers) {
    await server.close().catch(() => {});
  }
  servers = [];
});

describe("probeMcpEndpoint", () => {
  it("reports ok with the canonical server name", async () => {
    const server = await track(await createStubMcpServer());
    const probe = await probeMcpEndpoint(server.url, 2000);
    expect(probe.ok).toBe(true);
    expect(probe.serverName).toBe("FE Demo");
    expect(probe.serverVersion).toBe("1.2.3");
    expect(probe.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("fails gracefully when nothing is listening on the port", async () => {
    const probe = await probeMcpEndpoint("http://127.0.0.1:1", 1500);
    expect(probe.ok).toBe(false);
    expect(probe.error).toBeTruthy();
  });

  it("fails gracefully on a non-MCP endpoint", async () => {
    const probe = await probeMcpEndpoint("http://127.0.0.1:65530", 1200);
    expect(probe.ok).toBe(false);
  });
});

describe("verifyMcpEndpoint", () => {
  it("accepts only the FE Demo server name", async () => {
    const server = await track(await createStubMcpServer());
    const endpoint = await verifyMcpEndpoint(server.url, 2000);
    expect(endpoint).not.toBeNull();
    expect(endpoint?.serverName).toBe(CRAFTLAND_MCP_SERVER_NAME);
    expect(endpoint?.port).toBe(server.port);
    expect(endpoint?.url).toBe(server.url);
  });

  it("rejects a server that does not identify as FE Demo", async () => {
    const server = await track(
      await createStubMcpServer({ serverName: "Some Other Tool" })
    );
    expect(await verifyMcpEndpoint(server.url, 2000)).toBeNull();
  });
});

describe("debug registry parsing", () => {
  it("parses .debug-registry.json and picks the newest project", () => {
    const registry = parseDebugRegistry(
      JSON.stringify({
        projects: {
          "C:\\proj\\old": {
            name: "Old",
            mcpServerUrl: "http://192.168.0.2:3000/old/mcp",
            facadeKey: "oldkey",
            timestamp: 100,
          },
          "C:\\proj\\new": {
            name: "New",
            mcpServerUrl: "http://192.168.0.2:3000/new/mcp",
            facadeKey: "newkey",
            timestamp: 200,
          },
        },
      })
    );
    const newest = newestRegistryProject(registry);
    expect(newest?.projectPath).toBe("C:\\proj\\new");
    expect(newest?.mcpServerUrl).toBe("http://192.168.0.2:3000/new/mcp");
    expect(newest?.facadeKey).toBe("newkey");
  });

  it("returns null for invalid json", () => {
    expect(parseDebugRegistry("not json")).toBeNull();
  });

  it("ignores project entries without an mcpServerUrl", () => {
    const registry = parseDebugRegistry(
      JSON.stringify({
        projects: { "C:\\proj\\x": { facadeKey: "k", timestamp: 5 } },
      })
    );
    expect(newestRegistryProject(registry)).toBeNull();
  });
});

describe("normalizeLocalUrl", () => {
  it("rewrites lan hosts to 127.0.0.1 and keeps the port and path", () => {
    expect(normalizeLocalUrl("http://192.168.0.2:3000/abc/mcp")).toBe(
      "http://127.0.0.1:3000/abc/mcp"
    );
  });

  it("leaves loopback hosts untouched", () => {
    expect(normalizeLocalUrl("http://127.0.0.1:3000/abc/mcp")).toBe(
      "http://127.0.0.1:3000/abc/mcp"
    );
  });
});

describe("CraftlandDiscovery registry-first discovery", () => {
  it("discovers via the debug registry before scanning ports", async () => {
    const server = await track(await createStubMcpServer());
    let portsCalled = false;
    const discovery = new CraftlandDiscovery({
      detectProcessFn: async () => ({ pid: 4242, name: "Craftland Studio.exe" }),
      resolveExecPath: async () =>
        "C:\\Programs\\Craftland Studio\\Craftland Studio.exe",
      readRegistry: async () => ({
        name: "ProjectName",
        mcpServerUrl: server.url,
        facadeKey: "s3cret",
        timestamp: 5,
        projectPath: "C:\\proj",
      }),
      resolvePorts: async () => {
        portsCalled = true;
        return [server.port];
      },
      verifyTimeoutMs: 2000,
    });

    const found = await discovery.findEndpoint();
    expect(found).not.toBeNull();
    expect(found?.pid).toBe(4242);
    expect(found?.key).toBe("s3cret");
    expect(found?.config.headers?.["x-api-key"]).toBe("s3cret");
    expect(found?.url).toBe(server.url);
    expect(portsCalled).toBe(false);
  });

  it("normalizes a lan registry url to loopback before probing", async () => {
    const server = await track(await createStubMcpServer());
    const discovery = new CraftlandDiscovery({
      detectProcessFn: async () => ({ pid: 4242, name: "Craftland Studio.exe" }),
      resolveExecPath: async () =>
        "C:\\Programs\\Craftland Studio\\Craftland Studio.exe",
      readRegistry: async () => ({
        name: "ProjectName",
        mcpServerUrl: `http://192.168.0.2:${server.port}`,
        facadeKey: "k",
        timestamp: 5,
        projectPath: "C:\\proj",
      }),
      verifyTimeoutMs: 2000,
    });

    const found = await discovery.findEndpoint();
    expect(found?.port).toBe(server.port);
    expect(found?.url).toBe(`http://127.0.0.1:${server.port}`);
  });

  it("probes a registry url that already ends with /mcp without double-appending", async () => {
    const projectId = "7thzqnj22b7-mte22lwo-lzcuacbyvqd";
    const inline: Server = http.createServer((req, res) => {
      void (async () => {
        if (req.method !== "POST" || req.url !== `/${projectId}/mcp`) {
          res.writeHead(404).end();
          return;
        }
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        }
        const message = JSON.parse(Buffer.concat(chunks).toString("utf-8"));
        const id = message.id ?? null;
        const method = typeof message.method === "string" ? message.method : "";
        if (id === null || id === undefined) {
          res.writeHead(202).end();
          return;
        }
        const result =
          method === "initialize"
            ? {
                protocolVersion: "2025-06-18",
                capabilities: {},
                serverInfo: { name: "FE Demo", version: "0.0.1" },
              }
            : { tools: [{ name: "set_spawn_point" }] };
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ jsonrpc: "2.0", id, result }));
      })().catch(() => res.writeHead(500).end());
    });
    await new Promise<void>((resolve) =>
      inline.listen(0, "127.0.0.1", () => resolve())
    );
    const address = inline.address() as AddressInfo;
    try {
      const registryUrl = `http://127.0.0.1:${address.port}/${projectId}/mcp`;
      const discovery = new CraftlandDiscovery({
        detectProcessFn: async () => ({ pid: 4242, name: "Craftland Studio.exe" }),
        resolveExecPath: async () =>
          "C:\\Programs\\Craftland Studio\\Craftland Studio.exe",
        readRegistry: async () => ({
          name: "ProjectName",
          mcpServerUrl: registryUrl,
          facadeKey: "k",
          timestamp: 5,
          projectPath: "C:\\proj",
        }),
        verifyTimeoutMs: 2000,
      });

      const found = await discovery.findEndpoint();
      expect(found).not.toBeNull();
      expect(found?.url).toBe(registryUrl);
      expect(found?.config.url).toBe(registryUrl);
    } finally {
      await new Promise<void>((done) => inline.close(() => done()));
    }
  });
});

describe("CraftlandDiscovery", () => {
  it("discovers the endpoint for a live stub through injectable ports", async () => {
    const server = await track(await createStubMcpServer());
    const discovery = new CraftlandDiscovery({
      detectProcessFn: async () => ({ pid: 4242, name: "Craftland Studio.exe" }),
      resolvePorts: async () => [server.port],
      verifyTimeoutMs: 2000,
    });

    const found = await discovery.findEndpoint();
    expect(found).not.toBeNull();
    expect(found?.pid).toBe(4242);
    expect(found?.port).toBe(server.port);
    expect(found?.config.id).toBe("craftland");
    expect(found?.config.url).toBe(server.url);
    expect(found?.config.transport).toBe("http");
  });

  it("scans multiple candidate ports until one verifies", async () => {
    const empty = await track(await createStubMcpServer({ serverName: "Wrong Server" }));
    const real = await track(await createStubMcpServer());
    const discovery = new CraftlandDiscovery({
      detectProcessFn: async () => ({ pid: 1, name: "Craftland Studio.exe" }),
      resolvePorts: async () => [empty.port, real.port],
      verifyTimeoutMs: 2000,
    });

    const found = await discovery.findEndpoint();
    expect(found?.port).toBe(real.port);
  });

  it("returns null when no process is running", async () => {
    const discovery = new CraftlandDiscovery({
      detectProcessFn: async () => null,
    });
    expect(await discovery.findEndpoint()).toBeNull();
  });

  it("returns null when the process owns no listening ports", async () => {
    const discovery = new CraftlandDiscovery({
      detectProcessFn: async () => ({ pid: 4242, name: "Craftland Studio.exe" }),
      resolvePorts: async () => [],
    });
    expect(await discovery.findEndpoint()).toBeNull();
  });
});
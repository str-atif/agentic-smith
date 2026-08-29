import { HttpClientTransport, McpClientBase, McpServerConfig } from "@clpc/mcp-client";
import { CraftlandProcessInfo, ProcessRunner, debugCraftland } from "./process";
import { detectCraftlandProcess, detectCraftlandProcesses, resolveProcessExecutablePath } from "./process";
import { listListeningPortsForPid } from "./ports";
import { DebugRegistryProject, readDebugRegistry } from "./registry";

export const CRAFTLAND_MCP_SERVER_NAME = "FE Demo";

export interface McpEndpointProbe {
  ok: boolean;
  serverName?: string;
  serverVersion?: string;
  latencyMs?: number;
  error?: string;
}

export interface DiscoveredEndpoint {
  url: string;
  port: number;
  serverName: string;
  serverVersion?: string;
  latencyMs?: number;
}

export interface CraftlandDiscoveryResult extends DiscoveredEndpoint {
  pid: number;
  key?: string;
  config: McpServerConfig;
}

export interface CraftlandDiscoveryOptions {
  runner?: ProcessRunner;
  detectProcessFn?: () => Promise<CraftlandProcessInfo | null>;
  resolvePorts?: (pid: number) => Promise<number[]>;
  resolveExecPath?: (pid: number) => Promise<string | null>;
  readRegistry?: (pid: number, installDir?: string) => Promise<DebugRegistryProject | null>;
  verifyTimeoutMs?: number;
}

function portFromUrl(url: string): number {
  try {
    const parsed = new URL(url);
    if (parsed.port) return Number.parseInt(parsed.port, 10);
  } catch {
    // fall through to regex
  }
  const match = /:(\d+)(\/|$)/.exec(url);
  return match ? Number.parseInt(match[1], 10) : 0;
}

export function normalizeLocalUrl(url: string): string {
  try {
    const parsed = new URL(url);
    if (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost") {
      return url;
    }
    const port = parsed.port ? `:${parsed.port}` : "";
    const pathname = parsed.pathname === "/" ? "" : parsed.pathname;
    return `${parsed.protocol}//127.0.0.1${port}${pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return url;
  }
}

export async function probeMcpEndpoint(
  url: string,
  timeoutMs = 4000
): Promise<McpEndpointProbe> {
  const startedAt = Date.now();
  const serverConfig: McpServerConfig = {
    id: "probe",
    name: "probe",
    transport: "http",
    url,
  };
  const client = new McpClientBase(serverConfig, new HttpClientTransport(serverConfig), timeoutMs);
  try {
    await client.connect();
    const probe: McpEndpointProbe = {
      ok: true,
      serverName: client.info?.name,
      serverVersion: client.info?.version,
      latencyMs: Date.now() - startedAt,
    };
    debugCraftland(
      `probe ${url} -> ok name=${probe.serverName} version=${probe.serverVersion} ${probe.latencyMs}ms`
    );
    return probe;
  } catch (error) {
    const probe: McpEndpointProbe = {
      ok: false,
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - startedAt,
    };
    debugCraftland(`probe ${url} -> failure: ${probe.error} (${probe.latencyMs}ms)`);
    return probe;
  } finally {
    await client.disconnect().catch(() => {});
  }
}

export async function verifyMcpEndpoint(
  url: string,
  timeoutMs = 4000
): Promise<DiscoveredEndpoint | null> {
  const probe = await probeMcpEndpoint(url, timeoutMs);
  if (!probe.ok) return null;
  const serverName = probe.serverName || CRAFTLAND_MCP_SERVER_NAME;
  return {
    url,
    port: portFromUrl(url),
    serverName,
    serverVersion: probe.serverVersion,
    latencyMs: probe.latencyMs,
  };
}

export class CraftlandDiscovery {
  private readonly runner?: ProcessRunner;
  private readonly detectFn?: () => Promise<CraftlandProcessInfo | null>;
  private readonly resolvePortsFn?: (pid: number) => Promise<number[]>;
  private readonly resolvePathFn?: (pid: number) => Promise<string | null>;
  private readonly readRegistryFn?: (
    pid: number,
    installDir?: string
  ) => Promise<DebugRegistryProject | null>;
  private readonly verifyTimeoutMs: number;

  constructor(options: CraftlandDiscoveryOptions = {}) {
    this.runner = options.runner;
    this.detectFn = options.detectProcessFn;
    this.resolvePortsFn = options.resolvePorts;
    this.resolvePathFn = options.resolveExecPath;
    this.readRegistryFn = options.readRegistry;
    this.verifyTimeoutMs = options.verifyTimeoutMs ?? 4000;
  }

  async detectProcess(): Promise<CraftlandProcessInfo | null> {
    if (this.detectFn) {
      return this.detectFn();
    }
    return detectCraftlandProcess(this.runner);
  }

  async resolveExecPath(pid: number): Promise<string | null> {
    if (this.resolvePathFn) {
      return this.resolvePathFn(pid);
    }
    return resolveProcessExecutablePath(pid, this.runner);
  }

  async resolveRegistry(pid: number, installDir?: string): Promise<DebugRegistryProject | null> {
    if (this.readRegistryFn) {
      return this.readRegistryFn(pid, installDir);
    }
    if (!installDir) return null;
    return readDebugRegistry(installDir);
  }

  async resolvePorts(pid: number): Promise<number[]> {
    if (this.resolvePortsFn) {
      return this.resolvePortsFn(pid);
    }
    return listListeningPortsForPid(pid, this.runner);
  }

  private toResult(
    endpoint: DiscoveredEndpoint,
    pid: number,
    key?: string
  ): CraftlandDiscoveryResult {
    return {
      pid,
      key,
      config: {
        id: "craftland",
        name: CRAFTLAND_MCP_SERVER_NAME,
        transport: "http",
        url: endpoint.url,
        headers: key ? { "x-api-key": key } : undefined,
      },
      url: endpoint.url,
      port: endpoint.port,
      serverName: endpoint.serverName,
      serverVersion: endpoint.serverVersion,
      latencyMs: endpoint.latencyMs,
    };
  }

  private async findFromRegistry(pid: number): Promise<CraftlandDiscoveryResult | null> {
    const exePath = await this.resolveExecPath(pid);
    if (!exePath) {
      debugCraftland("registry path: unable to resolve executable path");
      return null;
    }
    const installDir = exePath.replace(/[\\/][^\\/]+$/, "");
    debugCraftland(`registry path: installDir=${installDir}`);
    const project = await this.resolveRegistry(pid, installDir);
    if (!project || !project.mcpServerUrl) return null;
    const url = normalizeLocalUrl(project.mcpServerUrl);
    const endpoint = await verifyMcpEndpoint(url, this.verifyTimeoutMs);
    if (!endpoint) return null;
    return this.toResult(endpoint, pid, project.facadeKey || undefined);
  }

  async findEndpointFor(pid: number): Promise<CraftlandDiscoveryResult | null> {
    const registryPath = await this.findFromRegistry(pid);
    if (registryPath) return registryPath;
    debugCraftland("registry path yielded no endpoint, falling back to owned-port probing");
    const ports = await this.resolvePorts(pid);
    for (const port of ports) {
      const url = `http://127.0.0.1:${port}`;
      const endpoint = await verifyMcpEndpoint(url, this.verifyTimeoutMs);
      if (endpoint) {
        return this.toResult(endpoint, pid);
      }
    }
    return null;
  }

  async findEndpoint(): Promise<CraftlandDiscoveryResult | null> {
    const processes = this.detectFn
      ? [(await this.detectFn())].filter((p): p is CraftlandProcessInfo => Boolean(p))
      : await detectCraftlandProcesses(this.runner);

    if (processes.length === 0) {
      debugCraftland("process detection: no Craftland Studio process found");
      return null;
    }

    for (const processInfo of processes) {
      const result = await this.findEndpointFor(processInfo.pid);
      if (result) {
        debugCraftland(
          `discovery result: pid=${result.pid} url=${result.url} server=${result.serverName} key=${result.key ? "provided" : "none"}`
        );
        return result;
      }
    }
    return null;
  }
}
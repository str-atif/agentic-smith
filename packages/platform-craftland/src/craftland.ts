import {
  createMcpClient,
  McpClient,
  McpResource,
  registerMcpTools,
} from "@clpc/mcp-client";
import { ToolRegistry } from "@clpc/tools";
import { CraftlandInfo } from "@clpc/types";
import {
  CraftlandDiscovery,
  CraftlandDiscoveryOptions,
  CraftlandDiscoveryResult,
} from "./discovery";
import { debugCraftland } from "./process";

export interface CraftlandIntegrationOptions {
  registry?: ToolRegistry;
  pollIntervalMs?: number;
  discovery?: CraftlandDiscovery;
  discoveryOptions?: CraftlandDiscoveryOptions;
  serverId?: string;
}

export type CraftlandStatusListener = (info: CraftlandInfo) => void;

function inferProjectScene(resources: McpResource[]): {
  project?: string;
  scene?: string;
} {
  if (!resources || resources.length === 0) {
    return {};
  }
  const paths = resources
    .map((resource) => {
      const raw = resource.uri && resource.uri !== resource.name
        ? resource.uri
        : resource.name || "";
      return raw.replace(/^resource:\/+/, "");
    })
    .filter(Boolean)
    .sort(
      (a, b) =>
        b.split(/[/\\]/).length - a.split(/[/\\]/).length
    );
  const segments = (paths[0] ?? "").split(/[/\\]/).filter(Boolean);
  if (segments.length >= 3) {
    return {
      project: segments[segments.length - 2],
      scene: segments[segments.length - 1],
    };
  }
  if (segments.length === 2) {
    return { project: segments[0], scene: segments[1] };
  }
  return {};
}

export class CraftlandIntegration {
  private registry?: ToolRegistry;
  private discovery: CraftlandDiscovery;
  private pollIntervalMs: number;
  private serverId: string;
  private info: CraftlandInfo = {
    state: "unavailable",
    lastUpdated: new Date().toISOString(),
  };
  private client: McpClient | null = null;
  private lastEndpoint: { pid: number; port: number; url: string } | null = null;
  private registeredTools: string[] = [];
  private listeners = new Set<CraftlandStatusListener>();
  private timer: NodeJS.Timeout | null = null;
  private running = false;
  private connecting = false;
  private stopRequested = false;

  constructor(options: CraftlandIntegrationOptions = {}) {
    this.registry = options.registry;
    this.pollIntervalMs = options.pollIntervalMs ?? 4000;
    this.serverId = options.serverId ?? "craftland";
    this.discovery =
      options.discovery ??
      new CraftlandDiscovery(options.discoveryOptions ?? {});
  }

  get current(): CraftlandInfo {
    return { ...this.info };
  }

  setRegistry(registry: ToolRegistry): void {
    const toolsWereRegistered = this.registeredTools.length > 0 && !this.registry;
    this.registry = registry;
    if (toolsWereRegistered && this.client) {
      void this.rebuildTools(this.client);
    }
  }

  onStatus(listener: CraftlandStatusListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    this.stopRequested = false;
    await this.refresh("detecting");
    this.timer = setInterval(() => void this.poll(), this.pollIntervalMs);
    if (typeof this.timer.unref === "function") {
      this.timer.unref();
    }
  }

  async stop(): Promise<void> {
    this.stopRequested = true;
    this.running = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.disconnect();
    this.emit();
  }

  async retry(): Promise<void> {
    if (this.connecting) return;
    this.stopRequested = false;
    await this.refresh("reconnecting");
  }

  async connect(): Promise<void> {
    await this.refresh("connecting");
  }

  async disconnect(): Promise<void> {
    this.unregisterTools();
    if (this.client) {
      const client = this.client;
      this.client = null;
      await client.disconnect().catch(() => {});
    }
    this.lastEndpoint = null;
    this.patch({
      state: "disconnected",
      pid: undefined,
      port: undefined,
      endpoint: undefined,
      toolCount: undefined,
      project: undefined,
      scene: undefined,
      serverName: undefined,
      error: undefined,
    });
    this.emit();
  }

  private async poll(): Promise<void> {
    if (this.connecting || this.stopRequested) return;
    const found = await this.discovery.findEndpoint();
    if (
      found &&
      this.lastEndpoint &&
      found.url === this.lastEndpoint.url &&
      this.info.state === "connected"
    ) {
      return;
    }
    await this.refresh(
      this.info.state === "connected" ? "reconnecting" : "detecting"
    );
  }

  private async refresh(
    desiredState: CraftlandInfo["state"]
  ): Promise<void> {
    if (this.connecting || this.stopRequested) return;
    this.connecting = true;
    let found: CraftlandDiscoveryResult | null = null;
    try {
      this.patch({ state: desiredState, error: undefined });
      this.emit();
      found = await this.discovery.findEndpoint();
      if (!found) {
        await this.disconnect();
        this.patch({
          state: "unavailable",
          pid: undefined,
          port: undefined,
          endpoint: undefined,
          toolCount: undefined,
          project: undefined,
          scene: undefined,
          serverName: undefined,
          error: undefined,
        });
        this.emit();
        return;
      }
      await this.connectTo(found);
    } catch (error) {
      await this.disconnect().catch(() => {});
      this.patch({
        state: "error",
        error: error instanceof Error ? error.message : String(error),
        pid: found?.pid,
        port: found?.port,
      });
      this.emit();
    } finally {
      this.connecting = false;
    }
  }

  private async connectTo(found: CraftlandDiscoveryResult): Promise<void> {
    this.patch({
      state: "connecting",
      pid: found.pid,
      port: found.port,
      endpoint: "/mcp",
      serverName: found.serverName,
      error: undefined,
    });
    this.emit();

    const client = createMcpClient(found.config);
    await client.connect();
    const tools = await client.listTools();
    debugCraftland(
      `mcp connection: url=${found.url} serverInfo=${JSON.stringify(client.info)} tools=${tools.length}`
    );

    if (this.registry) {
      await this.rebuildTools(client);
    }

    const { project, scene } = await this.readProjectAndScene(client);

    this.client = client;
    this.lastEndpoint = { pid: found.pid, port: found.port, url: found.url };
    this.patch({
      state: "connected",
      pid: found.pid,
      port: found.port,
      endpoint: "/mcp",
      toolCount: tools.length,
      serverName: client.info?.name ?? found.serverName,
      project,
      scene,
      error: undefined,
    });
    this.emit();
  }

  private async rebuildTools(client: McpClient): Promise<void> {
    if (!this.registry) return;
    this.unregisterTools();
    const names = await registerMcpTools(client, this.registry, {
      serverId: this.serverId,
    });
    this.registeredTools = names;
  }

  private async readProjectAndScene(client: McpClient): Promise<{
    project?: string;
    scene?: string;
  }> {
    try {
      const resources = await client.listResources();
      return inferProjectScene(resources);
    } catch {
      return {};
    }
  }

  private unregisterTools(): void {
    if (!this.registry) return;
    for (const name of this.registeredTools) {
      this.registry.unregister(name);
    }
    this.registeredTools = [];
  }

  private patch(fields: Partial<CraftlandInfo>): void {
    this.info = { ...this.info, ...fields, lastUpdated: new Date().toISOString() };
  }

  private emit(): void {
    const snapshot = this.current;
    for (const listener of this.listeners) {
      try {
        listener(snapshot);
      } catch {
        // a listener must never break the bus
      }
    }
  }
}
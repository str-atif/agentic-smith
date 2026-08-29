import { ToolRegistry } from "@clpc/tools";
import { describe, expect, it } from "vitest";
import { CraftlandDiscovery } from "../src/discovery";
import { CraftlandIntegration } from "../src/craftland";

describe("real Craftland Studio integration", () => {
  it("connects to the live Craftland MCP server when Studio is running", async () => {
    const discovery = new CraftlandDiscovery({ verifyTimeoutMs: 4000 });
    const found = await discovery.findEndpoint();

    if (!found) {
      console.log(
        "[integration] Craftland Studio not detected — skipping live verification"
      );
      return;
    }

    console.log(
      `[integration] Found Craftland Studio (pid ${found.pid}) MCP at ${found.url}`
    );

    const registry = new ToolRegistry();
    const integration = new CraftlandIntegration({ registry, discovery });
    const statuses: string[] = [];
    integration.onStatus((info) => statuses.push(info.state));

    await integration.start();

    expect(integration.current.state).toBe("connected");
    expect(integration.current.pid).toBe(found.pid);
    expect(integration.current.serverName).toBe("FE Demo");
    expect(integration.current.toolCount).toBeGreaterThan(0);
    expect(registry.size).toBeGreaterThan(0);

    const invoker = registry.createInvoker();
    const tool = registry.list()[0];
    const call = await invoker.invoke({
      id: "integration-check",
      name: tool.name,
      arguments: {},
    });

    expect(["ok", "error"]).toContain(call.ok ? "ok" : "error");
    console.log(`[integration] ${tool.name} -> ok=${call.ok}`);

    await integration.stop();
    expect(statuses).toContain("connected");
  }, 30_000);
});
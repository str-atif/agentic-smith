import { describe, expect, it } from "vitest";
import { CraftlandIntegration } from "./index";

describe("CraftlandIntegration", () => {
  it("reports that Craftland is not detected (skeleton)", async () => {
    const integration = new CraftlandIntegration();
    expect(await integration.detectCraftland()).toBe(false);
    expect(await integration.discoverMcpServer()).toBeNull();
    expect(integration.getServerConfig()).toBeNull();
  });

  it("throws when connecting without an MCP client configured", async () => {
    const integration = new CraftlandIntegration();
    await expect(integration.connect()).rejects.toThrow(/no MCP client/i);
  });

  it("exposes a manually supplied server config", () => {
    const integration = new CraftlandIntegration({
      serverConfig: { id: "craft", name: "Craftland", transport: "stdio", command: "clpc-craftland" },
    });
    expect(integration.getServerConfig()?.id).toBe("craft");
  });
});
import { describe, expect, it } from "vitest";
import { ToolRegistry } from "./registry";
import { ToolInvoker } from "./invoker";
import { Tool, ToolLifecycleEvent } from "./types";

const echoTool: Tool = {
  name: "echo",
  description: "Echoes the provided text back",
  parameters: {
    type: "object",
    properties: { text: { type: "string" } },
    required: ["text"],
  },
  requiresApproval: false,
  async execute(call) {
    return { ok: true, output: call.arguments?.text, durationMs: 0 };
  },
};

describe("ToolRegistry", () => {
  it("registers, lists, finds and unregisters tools", () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    expect(registry.size).toBe(1);
    expect(registry.find("echo")).toBe(echoTool);
    expect(registry.list()).toEqual([echoTool]);
    expect(registry.unregister("echo")).toBe(true);
    expect(registry.find("echo")).toBeUndefined();
  });

  it("throws on duplicate names", () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    expect(() => registry.register(echoTool)).toThrow(/already registered/);
  });
});

describe("ToolInvoker", () => {
  it("executes a tool and reports lifecycle events", async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    const lifecycle: ToolLifecycleEvent[] = [];
    const invoker = registry.createInvoker({
      onLifecycle: (event) => lifecycle.push(event),
    });

    const result = await invoker.invoke({ id: "c1", name: "echo", arguments: { text: "hi" } });

    expect(result.ok).toBe(true);
    expect(result.output).toBe("hi");
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
    expect(lifecycle.map((event) => event.type)).toEqual([
      "tool_started",
      "tool_completed",
    ]);
  });

  it("fails on invalid arguments", async () => {
    const registry = new ToolRegistry();
    registry.register(echoTool);
    const invoker = registry.createInvoker({});
    const result = await invoker.invoke({ id: "c1", name: "echo", arguments: {} });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid arguments/);
  });

  it("rejects execution errors as tool_failed", async () => {
    const registry = new ToolRegistry();
    registry.register({
      ...echoTool,
      name: "boom_tool",
      parameters: { type: "object", properties: {} },
      async execute() {
        throw new Error("kaboom");
      },
    });
    const lifecycle: ToolLifecycleEvent[] = [];
    const invoker = registry.createInvoker({
      onLifecycle: (event) => lifecycle.push(event),
    });

    const result = await invoker.invoke({ id: "c1", name: "boom_tool" });
    expect(result.ok).toBe(false);
    expect(result.error).toBe("kaboom");
    expect(lifecycle.some((event) => event.type === "tool_failed")).toBe(true);
  });

  it("reports unknown tools as failures", async () => {
    const invoker = new ToolInvoker(new ToolRegistry(), {});
    const result = await invoker.invoke({ id: "c1", name: "missing" });
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Unknown tool/);
  });
});
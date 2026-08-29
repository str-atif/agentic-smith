import { Tool } from "./types";
import { ToolInvoker, ToolInvokerOptions } from "./invoker";

export class ToolRegistry {
  private tools = new Map<string, Tool>();

  register(tool: Tool): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool);
  }

  unregister(name: string): boolean {
    return this.tools.delete(name);
  }

  find(name: string): Tool | undefined {
    return this.tools.get(name);
  }

  list(): Tool[] {
    return [...this.tools.values()];
  }

  createInvoker(options?: ToolInvokerOptions): ToolInvoker {
    return new ToolInvoker(this, options);
  }

  get size(): number {
    return this.tools.size;
  }
}
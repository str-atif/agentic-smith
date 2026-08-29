import { spawn, ChildProcess, SpawnOptions } from "child_process";
import { McpServerConfig } from "./types";
import { McpRequestTransport } from "./base";

export type SpawnFn = (
  command: string,
  args: string[],
  options: SpawnOptions
) => ChildProcess;

const defaultSpawn: SpawnFn = (command, args, options) =>
  spawn(command, args, options);

export class StdioClientTransport implements McpRequestTransport {
  private config: McpServerConfig;
  private spawnFn: SpawnFn;
  private child?: ChildProcess;
  private buffer = "";
  private messageHandler: (raw: string) => void = () => {};
  private closeHandler: () => void = () => {};

  constructor(config: McpServerConfig, spawnFn: SpawnFn = defaultSpawn) {
    this.config = config;
    this.spawnFn = spawnFn;
  }

  start(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.config.command) {
        reject(new Error("MCP stdio transport requires a command"));
        return;
      }

      try {
        this.child = this.spawnFn(this.config.command, this.config.args ?? [], {
          stdio: ["pipe", "pipe", "pipe"],
        });
      } catch (error) {
        reject(error);
        return;
      }

      this.child.stdout?.setEncoding("utf8");
      this.child.stdout?.on("data", (chunk: string) => {
        this.buffer += chunk;
        let newlineIndex = this.buffer.indexOf("\n");
        while (newlineIndex >= 0) {
          const line = this.buffer.slice(0, newlineIndex).trim();
          this.buffer = this.buffer.slice(newlineIndex + 1);
          if (line) {
            this.messageHandler(line);
          }
          newlineIndex = this.buffer.indexOf("\n");
        }
      });

      this.child.on("error", () => {
        this.closeHandler();
        void this.close();
      });
      this.child.on("close", () => this.closeHandler());

      this.child.on("spawn", () => resolve());
    });
  }

  async send(raw: string): Promise<void> {
    if (!this.child?.stdin || !this.child.stdin.writable) {
      throw new Error("MCP stdio transport stdin is not available");
    }
    await new Promise<void>((resolve, reject) => {
      this.child!.stdin!.write(raw + "\n", (error) =>
        error ? reject(error) : resolve()
      );
    });
  }

  onMessage(handler: (raw: string) => void): void {
    this.messageHandler = handler;
  }

  onClose(handler: () => void): void {
    this.closeHandler = handler;
  }

  async close(): Promise<void> {
    try {
      this.child?.kill();
    } catch {
      // process already gone
    }
  }
}
import { ProcessRunner, defaultRunner } from "./process";
import { debugCraftland } from "./process";

export function parsePort(localAddress: string): number | null {
  const trimmed = localAddress.trim();
  const ipv6 = /^\[[^\]]+\]:(\d+)$/.exec(trimmed);
  if (ipv6) return Number.parseInt(ipv6[1], 10);
  const ipv4 = /^[^:]+:(\d+)$/.exec(trimmed);
  if (ipv4) return Number.parseInt(ipv4[1], 10);
  return null;
}

export function parseNetstatPorts(stdout: string, pid: number): number[] {
  const ports = new Set<number>();
  for (const line of stdout.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    if (parts.length < 5) continue;
    const [proto, localAddress] = parts;
    const state = parts[parts.length - 2];
    const pidCell = parts[parts.length - 1];
    if (proto.toUpperCase() !== "TCP") continue;
    if (state.toUpperCase() !== "LISTENING") continue;
    if (pidCell !== String(pid)) continue;
    const port = parsePort(localAddress);
    if (port !== null && port > 0 && port <= 65535) {
      ports.add(port);
    }
  }
  const result = [...ports];
  debugCraftland(
    `netstat parsed listening ports for pid ${pid}: [${result.join(", ") || "none"}]`
  );
  return result;
}

export async function listListeningPortsForPid(
  pid: number,
  runner: ProcessRunner = defaultRunner
): Promise<number[]> {
  try {
    debugCraftland("ports: netstat -ano -p TCP");
    const stdout = await runner.runFile("netstat", ["-ano", "-p", "TCP"]);
    debugCraftland(`netstat raw output:\n${stdout.trim()}`);
    return parseNetstatPorts(stdout, pid);
  } catch {
    return [];
  }
}
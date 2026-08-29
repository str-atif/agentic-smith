import { execFile, ExecFileException } from "child_process";

export interface CraftlandProcessInfo {
  pid: number;
  name: string;
}

export interface ProcessRunner {
  runFile(file: string, args: string[]): Promise<string>;
}

export const defaultRunner: ProcessRunner = {
  runFile(file, args): Promise<string> {
    return new Promise((resolve, reject) => {
      execFile(
        file,
        args,
        {
          windowsHide: true,
          timeout: 15_000,
          maxBuffer: 16 * 1024 * 1024,
        },
        (error: ExecFileException | null, stdout: string) => {
          if (error && !stdout) {
            reject(error);
            return;
          }
          resolve(stdout);
        }
      );
    });
  },
};

export const CRAFTLAND_PROCESS_NAME = "Craftland Studio.exe";

export function debugCraftland(message: string): void {
  if (process.env.CLPC_DEBUG_CRAFTLAND === "1") {
    console.log(`[clpc:craftland] ${message}`);
  }
}

export function parseTasklistPids(
  stdout: string,
  imageName: string = CRAFTLAND_PROCESS_NAME
): CraftlandProcessInfo[] {
  const results: CraftlandProcessInfo[] = [];
  const seen = new Set<number>();
  const targetName = imageName.toLowerCase().replace(/\.exe$/i, "");
  for (const line of stdout.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const cells = trimmed.split(",").map((cell) => cell.trim().replace(/^"+|"+$/g, ""));
    if (cells.length < 2) continue;
    if (cells[0].toLowerCase().includes(targetName) || cells[0].toLowerCase().includes("craftland")) {
      const pid = Number.parseInt(cells[1], 10);
      if (Number.isInteger(pid) && pid > 0 && !seen.has(pid)) {
        seen.add(pid);
        results.push({ pid, name: cells[0] });
      }
    }
  }
  return results;
}

export function parseTasklistPid(
  stdout: string,
  imageName: string
): CraftlandProcessInfo | null {
  const list = parseTasklistPids(stdout, imageName);
  return list[0] ?? null;
}

export async function detectCraftlandProcesses(
  runner: ProcessRunner = defaultRunner
): Promise<CraftlandProcessInfo[]> {
  try {
    debugCraftland("detecting all Craftland processes via tasklist");
    const stdout = await runner.runFile("tasklist", [
      "/FO",
      "CSV",
      "/NH",
    ]);
    const parsed = parseTasklistPids(stdout, CRAFTLAND_PROCESS_NAME);
    debugCraftland(`parsed craftland pids: ${JSON.stringify(parsed.map((p) => p.pid))}`);
    return parsed;
  } catch {
    return [];
  }
}

export async function detectCraftlandProcess(
  runner: ProcessRunner = defaultRunner
): Promise<CraftlandProcessInfo | null> {
  const list = await detectCraftlandProcesses(runner);
  return list[0] ?? null;
}

export async function resolveProcessExecutablePath(
  pid: number,
  runner: ProcessRunner = defaultRunner
): Promise<string | null> {
  try {
    const command = `(Get-Process -Id ${pid}).Path`;
    debugCraftland(`exe-path: powershell -NoProfile -NonInteractive -Command "${command}"`);
    const stdout = await runner.runFile(
      "powershell",
      ["-NoProfile", "-NonInteractive", "-Command", command]
    );
    const path = stdout.trim();
    debugCraftland(`exe-path stdout: "${path}"`);
    return path || null;
  } catch {
    return null;
  }
}
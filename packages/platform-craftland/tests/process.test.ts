import { describe, expect, it } from "vitest";
import {
  CRAFTLAND_PROCESS_NAME,
  detectCraftlandProcess,
  parseTasklistPid,
} from "../src/process";

const FOUND_CSV = `"Craftland Studio.exe","12345","Console","1","10,240 K","Running","DESKTOP-ABC","C:\\Games\\Craftland Studio\\Craftland Studio.exe"
`;

const NOT_FOUND_CSV = `"explorer.exe","4321","Console","1","80,100 K","Running","DESKTOP-ABC","C:\\Windows\\explorer.exe"
`;

describe("parseTasklistPid", () => {
  it("reads the PID from a tasklist CSV row", () => {
    expect(parseTasklistPid(FOUND_CSV, CRAFTLAND_PROCESS_NAME)).toEqual({
      pid: 12345,
      name: "Craftland Studio.exe",
    });
  });

  it("returns null when the image is not present", () => {
    expect(parseTasklistPid(NOT_FOUND_CSV, CRAFTLAND_PROCESS_NAME)).toBeNull();
  });

  it("returns null when the PID cell is missing or invalid", () => {
    expect(parseTasklistPid(`"Craftland Studio.exe","N/A",...`, CRAFTLAND_PROCESS_NAME)).toBeNull();
    expect(parseTasklistPid("", CRAFTLAND_PROCESS_NAME)).toBeNull();
  });

  it("matches the image name case-insensitively", () => {
    expect(parseTasklistPid(FOUND_CSV, "craftland studio.exe")).not.toBeNull();
  });
});

describe("detectCraftlandProcess", () => {
  it("resolves the found process via the runner", async () => {
    const runner = {
      async runFile(file: string, args: string[]): Promise<string> {
        expect(file).toBe("tasklist");
        expect(args).toContain("IMAGENAME eq Craftland Studio.exe");
        return FOUND_CSV;
      },
    };
    expect(await detectCraftlandProcess(runner)).toEqual({
      pid: 12345,
      name: "Craftland Studio.exe",
    });
  });

  it("returns null when the process is absent", async () => {
    const runner = {
      async runFile(): Promise<string> {
        return NOT_FOUND_CSV;
      },
    };
    expect(await detectCraftlandProcess(runner)).toBeNull();
  });

  it("returns null when the runner throws (process not found, command error)", async () => {
    const runner = {
      async runFile(): Promise<string> {
        throw new Error("ERROR: The process could not be found");
      },
    };
    expect(await detectCraftlandProcess(runner)).toBeNull();
  });
});
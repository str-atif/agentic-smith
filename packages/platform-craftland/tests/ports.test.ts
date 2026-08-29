import { describe, expect, it } from "vitest";
import { listListeningPortsForPid, parseNetstatPorts, parsePort } from "../src/ports";

const NETSTAT_SAMPLE = `
Active Connections

  Proto  Local Address          Foreign Address        State           PID
  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       1000
  TCP    127.0.0.1:5000         0.0.0.0:0              LISTENING       4242
  TCP    127.0.0.1:5001         127.0.0.1:51000        ESTABLISHED     4242
  TCP    [::1]:3000             [::]:0                 LISTENING       4242
  TCP    127.0.0.1:99999        0.0.0.0:0              LISTENING       4242
  TCP    0.0.0.0:12345          0.0.0.0:0              LISTENING       7777
  UDP    127.0.0.1:5002         *:*                                    4242
  TCP    [fe80::1]:8080         [::]:0                 LISTENING       4242
`;

describe("parsePort", () => {
  it("parses IPv4 and bracket IPv6 local addresses", () => {
    expect(parsePort("127.0.0.1:5000")).toBe(5000);
    expect(parsePort("[::1]:3000")).toBe(3000);
    expect(parsePort("[::]:0")).toBe(0);
  });

  it("rejects non-port strings", () => {
    expect(parsePort("*:*")).toBeNull();
    expect(parsePort("")).toBeNull();
  });
});

describe("parseNetstatPorts", () => {
  it("returns only LISTENING TCP ports owned by the PID", () => {
    expect(parseNetstatPorts(NETSTAT_SAMPLE, 4242).sort((a, b) => a - b)).toEqual([
      3000, 5000, 8080,
    ]);
  });

  it("excludes threads owned by other PIDs", () => {
    expect(parseNetstatPorts(NETSTAT_SAMPLE, 1000)).toEqual([135]);
    expect(parseNetstatPorts(NETSTAT_SAMPLE, 7777)).toEqual([12345]);
  });

  it("rejects out-of-range ports", () => {
    expect(parseNetstatPorts(NETSTAT_SAMPLE, 4242)).not.toContain(99999);
  });

  it("handles empty input", () => {
    expect(parseNetstatPorts("", 4242)).toEqual([]);
  });
});

describe("listListeningPortsForPid", () => {
  it("delegates to netstat -ano -p TCP", async () => {
    const runner = {
      async runFile(file: string, args: string[]): Promise<string> {
        expect(file).toBe("netstat");
        expect(args).toContain("-ano");
        return NETSTAT_SAMPLE;
      },
    };
    expect(await listListeningPortsForPid(4242, runner)).toContain(5000);
  });

  it("returns an empty list when netstat fails", async () => {
    const runner = {
      async runFile(): Promise<string> {
        throw new Error("netstat failed");
      },
    };
    expect(await listListeningPortsForPid(4242, runner)).toEqual([]);
  });
});
import * as fs from "fs";
import * as path from "path";
import { debugCraftland } from "./process";

export const DEBUG_REGISTRY_FILE = ".debug-registry.json";

export interface DebugRegistryProject {
  name: string;
  mcpServerUrl: string;
  facadeKey: string;
  timestamp: number;
  projectPath: string;
}

export interface DebugRegistry {
  projects: Record<string, DebugRegistryProject>;
}

export function registryFilePath(installDir: string): string {
  return path.join(installDir, DEBUG_REGISTRY_FILE);
}

export function parseDebugRegistry(stdout: string): DebugRegistry | null {
  try {
    const raw = JSON.parse(stdout) as {
      projects?: Record<string, unknown>;
    };
    const projects: Record<string, DebugRegistryProject> = {};
    for (const [projectPath, value] of Object.entries(raw.projects ?? {})) {
      const entry = value as {
        name?: unknown;
        mcpServerUrl?: unknown;
        facadeKey?: unknown;
        timestamp?: unknown;
      };
      if (typeof entry.mcpServerUrl !== "string") continue;
      projects[projectPath] = {
        name: typeof entry.name === "string" ? entry.name : "",
        mcpServerUrl: entry.mcpServerUrl,
        facadeKey:
          typeof entry.facadeKey === "string" ? entry.facadeKey : "",
        timestamp:
          typeof entry.timestamp === "number" ? entry.timestamp : 0,
        projectPath,
      };
    }
    return { projects };
  } catch {
    return null;
  }
}

export function newestRegistryProject(
  registry: DebugRegistry | null
): DebugRegistryProject | null {
  if (!registry) return null;
  let newest: DebugRegistryProject | null = null;
  for (const project of Object.values(registry.projects)) {
    if (!newest || project.timestamp > newest.timestamp) {
      newest = project;
    }
  }
  return newest;
}

export function readDebugRegistry(
  installDir: string
): DebugRegistryProject | null {
  const file = registryFilePath(installDir);
  if (!fs.existsSync(file)) {
    debugCraftland(`registry: ${file} not found`);
    return null;
  }
  const parsed = parseDebugRegistry(fs.readFileSync(file, "utf8"));
  const project = newestRegistryProject(parsed);
  debugCraftland(
    `registry: ${file} -> ${
      project
        ? `mcpServerUrl=${project.mcpServerUrl} facadeKey=${project.facadeKey}`
        : "no project entries"
    }`
  );
  return project;
}
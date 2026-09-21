import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";

export interface RawGitOutput {
  code: number;
  stdout: string;
  stderr: string;
}

export function inTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export async function rawRunGit(
  cwd: string,
  args: string[],
  stdin?: string,
  env?: Record<string, string>,
): Promise<RawGitOutput> {
  if (!inTauri()) {
    throw new Error("Este app precisa rodar dentro do Tauri (use `npm run tauri dev`).");
  }
  return invoke<RawGitOutput>("run_git", { cwd, args, stdin: stdin ?? null, env: env ?? null });
}

export function pathExists(cwd: string, rel: string): Promise<boolean> {
  return invoke<boolean>("path_exists", { cwd, rel });
}

export function startupPath(): Promise<string | null> {
  return invoke<string | null>("startup_path");
}

export async function pickFolder(title: string): Promise<string | null> {
  const res = await open({ directory: true, multiple: false, title });
  return typeof res === "string" ? res : null;
}

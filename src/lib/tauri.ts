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

export function openPath(path: string): Promise<void> {
  return invoke<void>("open_path", { path });
}

export function openUrl(url: string): Promise<void> {
  return invoke<void>("open_url", { url });
}

export interface HttpResponse {
  status: number;
  /** Nomes em minúsculas. */
  headers: Record<string, string>;
  body: string;
}

/** HTTPS via núcleo Rust; só hosts liberados lá (hoje, `api.github.com`). */
export function httpRequest(
  method: string,
  url: string,
  headers?: Record<string, string>,
  body?: string,
): Promise<HttpResponse> {
  return invoke<HttpResponse>("http_request", { method, url, headers: headers ?? null, body: body ?? null });
}

export type GitHubAuth = "keyring" | "gh" | "env" | "none";

/** De onde vem o token do GitHub. O token em si nunca sai do núcleo. */
export function githubAuthStatus(): Promise<GitHubAuth> {
  return invoke<GitHubAuth>("github_auth_status");
}

/** Salva o token no chaveiro do sistema (`null` remove). */
export function githubTokenSet(token: string | null): Promise<GitHubAuth> {
  return invoke<GitHubAuth>("github_token_set", { token });
}

export async function pickFolder(title: string): Promise<string | null> {
  const res = await open({ directory: true, multiple: false, title });
  return typeof res === "string" ? res : null;
}

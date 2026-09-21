import type { LogFilter } from "../../types";
import { LOG_FORMAT, REFS_FORMAT, STASH_FORMAT } from "./parse";

export const STATUS_ARGS = ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"];
export const REFS_ARGS = ["for-each-ref", `--format=${REFS_FORMAT}`, "refs/heads", "refs/remotes", "refs/tags"];
export const STASH_ARGS = ["stash", "list", `--format=${STASH_FORMAT}`];
export const SUBMODULE_ARGS = ["submodule", "status"];

export const DEFAULT_FILTER: LogFilter = { text: "", author: "", path: "", currentOnly: false };

export const isFiltering = (f: LogFilter) => !!(f.text || f.author || f.path);

/**
 * Consulta do histórico. Usamos `--branches --remotes --tags HEAD` em vez de
 * `--all` para não poluir o grafo com os commits internos de `refs/stash`.
 */
export function logArgs(filter: LogFilter, limit: number): string[] {
  const args = ["log", "--topo-order", "--decorate=full", `--format=${LOG_FORMAT}`, `-n${limit}`];
  if (filter.text) args.push("-i", `--grep=${filter.text}`);
  if (filter.author) args.push("-i", `--author=${filter.author}`);
  if (filter.currentOnly) args.push("HEAD");
  else args.push("--branches", "--remotes", "--tags", "HEAD");
  if (filter.path) args.push("--follow", "--", filter.path);
  return args;
}

/** Lista de arquivos alterados por um commit (contra o 1º pai; raiz usa --root). */
export function commitFilesArgs(hash: string, hasParent: boolean): string[] {
  return hasParent
    ? ["diff", "--name-status", "-z", "-M", `${hash}^1`, hash]
    : ["diff-tree", "--root", "--no-commit-id", "-r", "--name-status", "-z", "-M", hash];
}

export function commitDiffArgs(hash: string, hasParent: boolean, path: string, oldPath?: string): string[] {
  const paths = oldPath && oldPath !== path ? [oldPath, path] : [path];
  return hasParent
    ? ["diff", "--no-color", "-M", "-U3", `${hash}^1`, hash, "--", ...paths]
    : ["show", "--no-color", "--format=", "--root", "-U3", hash, "--", ...paths];
}

export const worktreeDiffArgs = (path: string, staged: boolean): string[] => [
  "diff",
  "--no-color",
  "-U3",
  ...(staged ? ["--cached"] : []),
  "--",
  path,
];

/** Diff de arquivo não rastreado contra /dev/null (código de saída 1 = tem diferenças). */
export const untrackedDiffArgs = (path: string): string[] => [
  "diff",
  "--no-color",
  "--no-index",
  "-U3",
  "--",
  "/dev/null",
  path,
];

export type RefKind = "head" | "local" | "remote" | "tag";

export interface RefLabel {
  kind: RefKind;
  /** Nome curto (ex.: `main`, `origin/main`, `v1.0`). */
  name: string;
  /** `true` quando HEAD aponta para este ref (ou HEAD destacado). */
  current?: boolean;
}

export interface Commit {
  hash: string;
  parents: string[];
  author: string;
  email: string;
  /** Unix seconds (data do autor). */
  date: number;
  subject: string;
  refs: RefLabel[];
}

export interface Branch {
  /** Nome curto: `main` ou `feature/x` (sem o remote). */
  name: string;
  /** Nome completo de exibição: `main` ou `origin/feature/x`. */
  display: string;
  remote?: string;
  hash: string;
  upstream?: string;
  ahead: number;
  behind: number;
  gone: boolean;
  current: boolean;
}

export interface TagRef {
  name: string;
  /** Hash do commit apontado (já dereferenciado se for anotada). */
  hash: string;
  annotated: boolean;
}

export interface Stash {
  index: number;
  ref: string;
  hash: string;
  message: string;
  date: number;
}

export interface Submodule {
  path: string;
  hash: string;
  state: "ok" | "uninitialized" | "modified" | "conflict";
  describe?: string;
}

/** Entrada do `git status --porcelain=v2`. `.` = sem mudança naquela coluna. */
export interface FileEntry {
  path: string;
  origPath?: string;
  index: string;
  worktree: string;
  conflicted: boolean;
  untracked: boolean;
}

export interface HeadInfo {
  /** `null` quando o repositório ainda não tem commits. */
  hash: string | null;
  /** `null` quando HEAD está destacado. */
  branch: string | null;
  detached: boolean;
  upstream?: string;
  ahead: number;
  behind: number;
}

export type OperationKind = "merge" | "rebase" | "cherry-pick" | "revert";

export interface CommitFile {
  status: string;
  path: string;
  oldPath?: string;
}

export interface DiffLine {
  type: " " | "+" | "-" | "\\";
  text: string;
  oldNo?: number;
  newNo?: number;
}

export interface Hunk {
  header: string;
  context: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

export interface FileDiff {
  /** Linhas antes do primeiro `@@` (diff --git, index, ---, +++). */
  header: string[];
  hunks: Hunk[];
  binary: boolean;
  /** Diff combinado (conflitos): exibido como texto cru. */
  combined: boolean;
  raw: string;
}

export interface BlameLine {
  lineNo: number;
  hash: string;
  author: string;
  time: number;
  summary: string;
  text: string;
}

/** O que está selecionado no painel de arquivos para exibir no diff. */
export type FileSelection =
  | { source: "unstaged"; path: string; untracked: boolean; conflicted: boolean }
  | { source: "staged"; path: string }
  | { source: "commit"; hash: string; path: string; oldPath?: string; root: boolean };

export type Selection = { type: "wip" } | { type: "commit"; hash: string } | null;

export interface LogFilter {
  text: string;
  author: string;
  path: string;
  /** Só o histórico de HEAD, em vez de todas as branches. */
  currentOnly: boolean;
}

export interface CommandLogEntry {
  id: number;
  time: number;
  cwd: string;
  args: string[];
  code: number;
  ms: number;
  stdout: string;
  stderr: string;
}

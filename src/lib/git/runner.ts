import type { CommandLogEntry } from "../../types";
import { rawRunGit } from "../tauri";

export class GitError extends Error {
  constructor(
    public args: string[],
    public code: number,
    public stdout: string,
    public stderr: string,
  ) {
    super((stderr || stdout).trim() || `git ${args[0] ?? ""} falhou (código ${code})`);
    this.name = "GitError";
  }
}

export interface GitOptions {
  stdin?: string;
  /** Não lança em código de saída ≠ 0. */
  allowFail?: boolean;
  env?: Record<string, string>;
  /** Não registra no Command Log (usado em consultas de fundo). */
  silent?: boolean;
  /** Não adiciona `--literal-pathspecs` (usado no console). */
  raw?: boolean;
}

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

type LogSink = (e: Omit<CommandLogEntry, "id">) => void;
let sink: LogSink | null = null;

/** O store registra aqui o destino do Command Log (evita import circular). */
export function setCommandLogSink(fn: LogSink) {
  sink = fn;
}

const MAX_LOGGED = 6000;
const clip = (s: string) => (s.length > MAX_LOGGED ? s.slice(0, MAX_LOGGED) + "\n… (truncado)" : s);

/**
 * Executa `git` no repositório `cwd`.
 * Caminhos são sempre tratados literalmente (sem glob) salvo `raw: true`.
 */
export async function git(cwd: string, args: string[], opts: GitOptions = {}): Promise<GitResult> {
  const finalArgs = opts.raw ? args : ["--literal-pathspecs", ...args];
  const t0 = performance.now();
  let res: GitResult;
  try {
    res = await rawRunGit(cwd, finalArgs, opts.stdin, opts.env);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    sink?.({ time: Date.now(), cwd, args, code: -1, ms: 0, stdout: "", stderr: msg });
    throw new GitError(args, -1, "", msg);
  }
  if (!opts.silent) {
    sink?.({
      time: Date.now(),
      cwd,
      args,
      code: res.code,
      ms: Math.round(performance.now() - t0),
      stdout: clip(res.stdout),
      stderr: clip(res.stderr),
    });
  }
  if (res.code !== 0 && !opts.allowFail) {
    throw new GitError(args, res.code, res.stdout, res.stderr);
  }
  return res;
}

/** Atalho: retorna só o stdout. */
export async function gitOut(cwd: string, args: string[], opts: GitOptions = {}): Promise<string> {
  return (await git(cwd, args, opts)).stdout;
}

/** Tokeniza uma linha de comando estilo shell (aspas simples/duplas e `\`). */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | null = null;
  let has = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quote) {
      if (ch === quote) quote = null;
      else if (ch === "\\" && quote === '"' && i + 1 < line.length) cur += line[++i];
      else cur += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
      has = true;
    } else if (ch === "\\" && i + 1 < line.length) {
      cur += line[++i];
      has = true;
    } else if (/\s/.test(ch)) {
      if (cur || has) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += ch;
    }
  }
  if (cur || has) out.push(cur);
  return out;
}

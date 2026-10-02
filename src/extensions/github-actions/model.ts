/** Partes puras da extensão GitHub Actions (testadas em tests/extensions.test.ts). */

export interface GitHubSlug {
  owner: string;
  repo: string;
}

export type RunStatus = "queued" | "in_progress" | "completed" | "waiting" | "requested" | "pending";
export type RunConclusion =
  | "success"
  | "failure"
  | "cancelled"
  | "skipped"
  | "timed_out"
  | "action_required"
  | "neutral"
  | "stale"
  | "startup_failure"
  | null;

export interface WorkflowRun {
  id: number;
  name: string | null;
  display_title: string;
  run_number: number;
  run_attempt?: number;
  workflow_id: number;
  head_branch: string | null;
  head_sha: string;
  event: string;
  status: RunStatus;
  conclusion: RunConclusion;
  html_url: string;
  created_at: string;
  updated_at: string;
  run_started_at?: string;
  actor?: { login: string } | null;
}

export interface JobStep {
  number: number;
  name: string;
  status: RunStatus;
  conclusion: RunConclusion;
}

export interface Job {
  id: number;
  name: string;
  status: RunStatus;
  conclusion: RunConclusion;
  html_url: string;
  started_at: string | null;
  completed_at: string | null;
  steps?: JobStep[];
}

/** Estado resumido para ícones/badges. */
export type Light = "success" | "failure" | "pending" | "cancelled" | "neutral";

/** Interpreta URLs de remote do github.com (SSH, scp-like, HTTPS, git://). */
export function parseGitHubUrl(url: string): GitHubSlug | null {
  const m =
    /^(?:git@github\.com:|ssh:\/\/git@github\.com(?::\d+)?\/|https?:\/\/(?:[^@/]+@)?github\.com\/|git:\/\/github\.com\/)([^/\s]+)\/([^/\s]+?)(?:\.git)?\/?$/i.exec(
      url.trim(),
    );
  return m ? { owner: m[1], repo: m[2] } : null;
}

/**
 * Escolhe o remote do GitHub a partir de `git config --get-regexp ^remote\..*\.url$`.
 * Preferência: origin, upstream, depois o primeiro que for do GitHub.
 */
export function pickGitHubRemote(configOut: string): GitHubSlug | null {
  const remotes = new Map<string, GitHubSlug>();
  for (const line of configOut.split("\n")) {
    const m = /^remote\.(.+)\.url\s+(.+)$/.exec(line.trim());
    const slug = m && parseGitHubUrl(m[2]);
    if (m && slug && !remotes.has(m[1])) remotes.set(m[1], slug);
  }
  return remotes.get("origin") ?? remotes.get("upstream") ?? remotes.values().next().value ?? null;
}

export function lightOf(r: { status: RunStatus; conclusion: RunConclusion }): Light {
  if (r.status !== "completed") return "pending";
  switch (r.conclusion) {
    case "success":
      return "success";
    case "failure":
    case "timed_out":
    case "startup_failure":
    case "action_required":
      return "failure";
    case "cancelled":
      return "cancelled";
    default:
      return "neutral";
  }
}

const SEVERITY: Light[] = ["pending", "failure", "cancelled", "success", "neutral"];

/** Combina vários estados: em andamento > falha > cancelado > sucesso > neutro. */
export function worst(lights: Light[]): Light | null {
  if (!lights.length) return null;
  return SEVERITY.find((l) => lights.includes(l)) ?? "neutral";
}

/**
 * Estado de CI por commit. Considera só a execução mais recente de cada
 * workflow para aquele SHA (um re-run que passou substitui a falha anterior).
 */
export function statusByCommit(runs: WorkflowRun[]): Map<string, Light> {
  const latest = new Map<string, WorkflowRun>();
  for (const r of runs) {
    const k = `${r.head_sha}:${r.workflow_id}`;
    const cur = latest.get(k);
    if (!cur || r.id > cur.id || (r.id === cur.id && (r.run_attempt ?? 1) > (cur.run_attempt ?? 1))) latest.set(k, r);
  }
  const bySha = new Map<string, Light[]>();
  for (const r of latest.values()) bySha.set(r.head_sha, [...(bySha.get(r.head_sha) ?? []), lightOf(r)]);
  return new Map([...bySha].map(([sha, ls]) => [sha, worst(ls)!]));
}

/** Duração legível entre dois instantes ISO (ou até agora). */
export function duration(fromIso: string | null | undefined, toIso?: string | null): string {
  if (!fromIso) return "";
  const ms = (toIso ? Date.parse(toIso) : Date.now()) - Date.parse(fromIso);
  if (!Number.isFinite(ms) || ms < 0) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

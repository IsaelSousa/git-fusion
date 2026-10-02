import { useEffect } from "react";
import { create } from "zustand";
import type { Commit } from "../../types";
import { type GitHubAuth, githubAuthStatus, githubTokenSet } from "../../lib/tauri";
import { short, timeAgo } from "../../lib/util";
import { useStore } from "../../store";
import { IconRefresh } from "../../components/Icons";
import type { ExtContext, Extension } from "../api";
import {
  type GitHubSlug,
  type Job,
  type Light,
  type WorkflowRun,
  duration,
  lightOf,
  pickGitHubRemote,
  statusByCommit,
} from "./model";

const TAB = "runs";
const POLL_MS = 15_000;
const MIN_INTERVAL_MS = 20_000;

interface GhaState {
  path: string | null;
  slug: GitHubSlug | null;
  phase: "idle" | "not-github" | "loading" | "ready" | "error";
  error: string | null;
  /** O GitHub recusou sem token (repositório privado ou token inválido). */
  needsAuth: boolean;
  auth: GitHubAuth | null;
  runs: WorkflowRun[];
  byCommit: Map<string, Light>;
  jobs: Record<number, Job[] | "loading" | { error: string }>;
  expanded: number | null;
  scope: "branch" | "all";
}

const INITIAL: Omit<GhaState, "auth" | "scope"> = {
  path: null,
  slug: null,
  phase: "idle",
  error: null,
  needsAuth: false,
  runs: [],
  byCommit: new Map(),
  jobs: {},
  expanded: null,
};

const useGha = create<GhaState>(() => ({ ...INITIAL, auth: null, scope: "branch" }));
const G = () => useGha.getState();

let ctx: ExtContext | null = null;
let etag: { path: string; value: string } | null = null;
let lastLoad = 0;
let pollTimer: ReturnType<typeof setTimeout> | null = null;
let loadSeq = 0;

/* ------------------------------------------------------------------ API */

async function api(method: string, path: string, headers: Record<string, string> = {}) {
  return ctx!.http({
    method,
    url: `https://api.github.com${path}`,
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28", ...headers },
  });
}

const AUTH_LABEL: Record<GitHubAuth, string> = {
  keyring: "token salvo no GitFusion",
  gh: "token do GitHub CLI (gh)",
  env: "token de GH_TOKEN/GITHUB_TOKEN",
  none: "sem token (só repositórios públicos)",
};

function describeFailure(status: number, headers: Record<string, string>, body: string): { error: string; needsAuth: boolean } {
  const auth = G().auth ?? "none";
  let msg = "";
  try {
    msg = (JSON.parse(body) as { message?: string }).message ?? "";
  } catch {
    /* corpo não-JSON */
  }
  if ((status === 403 || status === 429) && headers["x-ratelimit-remaining"] === "0") {
    const reset = Number(headers["x-ratelimit-reset"]);
    const when = reset ? ` Libera ${timeAgo(reset)}.` : "";
    return {
      error: `Limite da API do GitHub atingido.${when}${auth === "none" ? " Com um token o limite é bem maior." : ""}`,
      needsAuth: auth === "none",
    };
  }
  if (status === 401) return { error: "O token do GitHub é inválido ou expirou.", needsAuth: true };
  if (status === 404 && auth === "none")
    return { error: "Repositório privado ou inexistente: configure um token do GitHub para ver as execuções.", needsAuth: true };
  if (status === 404 || status === 403)
    return { error: `Sem acesso às Actions deste repositório com o ${AUTH_LABEL[auth]}.`, needsAuth: true };
  return { error: `GitHub respondeu ${status}${msg ? `: ${msg}` : ""}`, needsAuth: false };
}

/* ------------------------------------------------------------ carregamento */

function stopPolling() {
  if (pollTimer) clearTimeout(pollTimer);
  pollTimer = null;
}

async function load(force = false) {
  if (!ctx) return;
  const path = ctx.repo();
  if (path !== G().path) {
    stopPolling();
    etag = null;
    useGha.setState({ ...INITIAL, path });
  }
  if (!path) return;
  if (!force && Date.now() - lastLoad < MIN_INTERVAL_MS) return;
  lastLoad = Date.now();
  const seq = ++loadSeq;

  const remotes = await ctx.git(["config", "--get-regexp", "^remote\\..*\\.url$"]);
  const slug = pickGitHubRemote(remotes.stdout);
  if (seq !== loadSeq || ctx.repo() !== path) return;
  if (!slug) {
    stopPolling();
    useGha.setState({ slug: null, phase: "not-github", runs: [], byCommit: new Map() });
    return;
  }
  const sameRepo = G().slug?.owner === slug.owner && G().slug?.repo === slug.repo;
  if (!sameRepo) etag = null;
  useGha.setState({ slug, phase: G().phase === "ready" && sameRepo ? "ready" : "loading" });

  try {
    if (!G().auth) useGha.setState({ auth: await githubAuthStatus().catch(() => "none" as const) });
    const res = await api(
      "GET",
      `/repos/${slug.owner}/${slug.repo}/actions/runs?per_page=50`,
      etag?.path === path ? { "If-None-Match": etag.value } : {},
    );
    if (seq !== loadSeq || ctx.repo() !== path) return;

    if (res.status === 304) {
      useGha.setState({ phase: "ready", error: null, needsAuth: false });
    } else if (res.status === 200) {
      const runs = (JSON.parse(res.body) as { workflow_runs: WorkflowRun[] }).workflow_runs ?? [];
      etag = res.headers.etag ? { path, value: res.headers.etag } : null;
      useGha.setState({ phase: "ready", error: null, needsAuth: false, runs, byCommit: statusByCommit(runs) });
    } else {
      useGha.setState({ phase: "error", ...describeFailure(res.status, res.headers, res.body) });
    }
  } catch (e) {
    if (seq !== loadSeq) return;
    useGha.setState({ phase: "error", error: e instanceof Error ? e.message : String(e), needsAuth: false });
  }

  // Enquanto houver execução em andamento, acompanha de perto.
  stopPolling();
  if (G().runs.some((r) => r.status !== "completed")) pollTimer = setTimeout(() => void load(true), POLL_MS);
}

async function loadJobs(run: WorkflowRun) {
  const slug = G().slug;
  if (!slug) return;
  useGha.setState((s) => ({ jobs: { ...s.jobs, [run.id]: "loading" } }));
  try {
    const res = await api("GET", `/repos/${slug.owner}/${slug.repo}/actions/runs/${run.id}/jobs?per_page=100`);
    const value =
      res.status === 200
        ? ((JSON.parse(res.body) as { jobs: Job[] }).jobs ?? [])
        : { error: describeFailure(res.status, res.headers, res.body).error };
    useGha.setState((s) => ({ jobs: { ...s.jobs, [run.id]: value } }));
  } catch (e) {
    useGha.setState((s) => ({ jobs: { ...s.jobs, [run.id]: { error: e instanceof Error ? e.message : String(e) } } }));
  }
}

function toggleRun(run: WorkflowRun) {
  const open = G().expanded === run.id ? null : run.id;
  useGha.setState({ expanded: open });
  if (open !== null && (G().jobs[run.id] === undefined || run.status !== "completed")) void loadJobs(run);
}

async function runAction(run: WorkflowRun, kind: "rerun" | "rerun-failed-jobs" | "cancel") {
  const slug = G().slug;
  if (!slug || !ctx) return;
  const verb = kind === "cancel" ? "Cancelamento" : "Re-execução";
  try {
    const res = await api("POST", `/repos/${slug.owner}/${slug.repo}/actions/runs/${run.id}/${kind}`);
    if (res.status >= 200 && res.status < 300) {
      ctx.toast("success", `${verb} solicitada para "${run.display_title}".`);
      setTimeout(() => void load(true), 2000);
    } else if (res.status === 403 || res.status === 404) {
      ctx.toast("error", `${verb} recusada: o token precisa de permissão de escrita em Actions neste repositório.`);
    } else {
      ctx.toast("error", `${verb} falhou: ${describeFailure(res.status, res.headers, res.body).error}`);
    }
  } catch (e) {
    ctx.toast("error", `${verb} falhou: ${e instanceof Error ? e.message : String(e)}`);
  }
}

async function configureToken() {
  if (!ctx) return;
  const auth = G().auth ?? (await githubAuthStatus().catch(() => "none" as const));
  const r = await ctx.ask({
    title: "Token do GitHub",
    message:
      `Atual: ${AUTH_LABEL[auth]}.\n\n` +
      "Cole um token (fine-grained com leitura de Actions, ou escrita para re-executar/cancelar). " +
      "Ele fica no chaveiro do sistema e só é enviado para api.github.com.\n\n" +
      "Deixe vazio para remover e voltar a usar o GitHub CLI (gh) ou GH_TOKEN.",
    okLabel: "Salvar",
    fields: [{ name: "token", label: "Token", type: "password", placeholder: "github_pat_…" }],
  });
  if (!r) return;
  try {
    const next = await githubTokenSet(String(r.token).trim() || null);
    etag = null;
    useGha.setState({ auth: next });
    ctx.toast("success", `GitHub: ${AUTH_LABEL[next]}.`);
    await load(true);
  } catch (e) {
    ctx.toast("error", e instanceof Error ? e.message : String(e));
  }
}

/* ------------------------------------------------------------- componentes */

const LIGHT_TEXT: Record<Light, string> = {
  success: "Sucesso",
  failure: "Falhou",
  pending: "Em andamento",
  cancelled: "Cancelado",
  neutral: "Sem resultado",
};
const LIGHT_GLYPH: Record<Light, string> = { success: "✓", failure: "✕", pending: "●", cancelled: "⊘", neutral: "–" };

function Dot({ light, title }: { light: Light; title?: string }) {
  return (
    <span className={`gha-light gha-${light}`} title={title ?? LIGHT_TEXT[light]}>
      {LIGHT_GLYPH[light]}
    </span>
  );
}

const unix = (iso: string) => Date.parse(iso) / 1000;

function visibleRuns(s: GhaState, branch: string | null) {
  return s.scope === "branch" && branch ? s.runs.filter((r) => r.head_branch === branch) : s.runs;
}

function JobsList({ run }: { run: WorkflowRun }) {
  const jobs = useGha((s) => s.jobs[run.id]);
  if (jobs === undefined || jobs === "loading") return <div className="gha-jobs muted">Carregando jobs…</div>;
  if (!Array.isArray(jobs)) return <div className="gha-jobs err">{jobs.error}</div>;
  if (!jobs.length) return <div className="gha-jobs muted">Nenhum job.</div>;
  return (
    <div className="gha-jobs">
      {jobs.map((j) => (
        <div key={j.id} className="gha-job">
          <div className="gha-job-head">
            <Dot light={lightOf(j)} />
            <a
              href={j.html_url}
              onClick={(e) => {
                e.preventDefault();
                void ctx?.openUrl(j.html_url);
              }}
            >
              {j.name}
            </a>
            <span className="muted">{duration(j.started_at, j.completed_at)}</span>
          </div>
          {j.steps?.map((st) => (
            <div key={st.number} className="gha-step">
              <Dot light={lightOf(st)} />
              <span className="ellipsis">{st.name}</span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

function RunRow({ run }: { run: WorkflowRun }) {
  const expanded = useGha((s) => s.expanded === run.id);
  const light = lightOf(run);
  const done = run.status === "completed";
  const failed = light === "failure" || light === "cancelled";
  const stop = (e: React.MouseEvent) => e.stopPropagation();

  return (
    <div className={`gha-run${expanded ? " open" : ""}`}>
      <div className="gha-run-head" onClick={() => toggleRun(run)}>
        <Dot light={light} />
        <div className="gha-run-main">
          <div className="gha-run-title ellipsis" title={run.display_title}>
            {run.display_title}
          </div>
          <div className="gha-run-meta muted">
            {run.name ?? "workflow"} #{run.run_number}
            {run.head_branch && <span className="chip chip-local">{run.head_branch}</span>}
            <span>{run.event}</span>
            {run.actor && <span>{run.actor.login}</span>}
            <span title={new Date(run.created_at).toLocaleString("pt-BR")}>{timeAgo(unix(run.created_at))}</span>
            <span>{duration(run.run_started_at ?? run.created_at, done ? run.updated_at : null)}</span>
          </div>
        </div>
        <button
          className="btn xs mono gha-sha"
          title="Mostrar o commit no grafo"
          onClick={(e) => {
            stop(e);
            ctx?.revealCommit(run.head_sha);
          }}
        >
          {short(run.head_sha)}
        </button>
        <span className="gha-run-actions" onClick={stop}>
          {!done && (
            <button className="btn xs" onClick={() => runAction(run, "cancel")}>
              Cancelar
            </button>
          )}
          {done && failed && (
            <button className="btn xs" onClick={() => runAction(run, "rerun-failed-jobs")}>
              Re-executar falhas
            </button>
          )}
          {done && (
            <button className="btn xs" onClick={() => runAction(run, "rerun")}>
              Re-executar
            </button>
          )}
          <button className="btn xs" onClick={() => ctx?.openUrl(run.html_url)}>
            Abrir no GitHub
          </button>
        </span>
      </div>
      {expanded && <JobsList run={run} />}
    </div>
  );
}

function ActionsTab() {
  const s = useGha();
  const branch = useStore((st) => st.head.branch);
  const runs = visibleRuns(s, branch);

  // Abrir a aba sempre busca dados frescos (com ETag, custa pouco).
  useEffect(() => {
    void load(true);
  }, []);

  let body;
  if (s.phase === "not-github") body = <div className="empty">O repositório não tem um remote do github.com.</div>;
  else if (s.phase === "idle" || (s.phase === "loading" && !s.runs.length)) body = <div className="empty">Carregando execuções…</div>;
  else if (s.phase === "error")
    body = (
      <div className="empty">
        <div className="err">{s.error}</div>
        {s.needsAuth && (
          <button className="btn btn-primary gha-cta" onClick={configureToken}>
            Configurar token do GitHub…
          </button>
        )}
      </div>
    );
  else if (!runs.length)
    body = <div className="empty">{s.scope === "branch" && branch ? `Nenhuma execução para ${branch}.` : "Nenhuma execução de workflow."}</div>;
  else body = runs.map((r) => <RunRow key={`${r.id}:${r.run_attempt ?? 1}`} run={r} />);

  return (
    <div className="gha">
      <div className="gha-bar">
        {s.slug ? (
          <a
            className="gha-slug"
            href={`https://github.com/${s.slug.owner}/${s.slug.repo}/actions`}
            onClick={(e) => {
              e.preventDefault();
              void ctx?.openUrl(`https://github.com/${s.slug!.owner}/${s.slug!.repo}/actions`);
            }}
          >
            {s.slug.owner}/{s.slug.repo}
          </a>
        ) : (
          <span className="muted">GitHub Actions</span>
        )}
        <span className="seg">
          <button className={s.scope === "branch" ? "on" : ""} onClick={() => useGha.setState({ scope: "branch" })}>
            {branch ?? "Branch atual"}
          </button>
          <button className={s.scope === "all" ? "on" : ""} onClick={() => useGha.setState({ scope: "all" })}>
            Todas
          </button>
        </span>
        <span className="grow-fill" />
        {s.auth && (
          <button className="btn xs" title="Configurar token do GitHub" onClick={configureToken}>
            {AUTH_LABEL[s.auth]}
          </button>
        )}
        <button className="icon-btn" title="Atualizar execuções" onClick={() => load(true)}>
          <IconRefresh className={s.phase === "loading" ? "spin" : ""} />
        </button>
      </div>
      <div className="gha-list">{body}</div>
    </div>
  );
}

function TabBadge() {
  const running = useGha((s) => s.runs.filter((r) => r.status !== "completed").length);
  return running > 0 ? <span className="side-count gha-running">{running}</span> : null;
}

function CommitBadge({ commit }: { commit: Commit }) {
  const light = useGha((s) => s.byCommit.get(commit.hash));
  return light ? <Dot light={light} title={`GitHub Actions: ${LIGHT_TEXT[light]}`} /> : null;
}

/** Estado do CI no último commit da branch atual. */
function ToolbarStatus() {
  const branch = useStore((s) => s.head.branch);
  const headHash = useStore((s) => s.head.hash);
  const fromHead = useGha((s) => (headHash ? s.byCommit.get(headHash) : undefined));
  const fromBranch = useGha((s) => {
    if (!branch) return undefined;
    const latest = s.runs.find((r) => r.head_branch === branch);
    return latest ? (s.byCommit.get(latest.head_sha) ?? undefined) : undefined;
  });
  const phase = useGha((s) => s.phase);
  if (phase === "not-github") return null;
  const light = fromHead ?? fromBranch;
  return (
    <button
      className="tb-btn"
      title={light ? `CI de ${branch ?? "HEAD"}: ${LIGHT_TEXT[light]}` : "GitHub Actions"}
      onClick={() => ctx?.showDockTab(TAB)}
    >
      {light ? <Dot light={light} /> : <span className="gha-light gha-neutral">–</span>}
      <span className="tb-label">CI</span>
    </button>
  );
}

/* --------------------------------------------------------------- extensão */

export const githubActions: Extension = {
  id: "github-actions",
  name: "GitHub Actions",
  description:
    "Mostra as execuções de workflows do GitHub: aba no painel inferior, status do CI em cada commit do grafo e na barra superior, com re-execução e cancelamento.",
  hosts: ["api.github.com"],
  activate(c) {
    ctx = c;
    c.ui.dockTab({ id: TAB, label: "Actions", component: ActionsTab, badge: TabBadge });
    c.ui.commitBadge(CommitBadge);
    c.ui.toolbarItem({ id: "status", label: "Status do CI (GitHub Actions)", component: ToolbarStatus });
    c.on("repoChanged", () => void load(true));
    c.on("refreshed", () => void load());
  },
  deactivate() {
    stopPolling();
    ctx = null;
    etag = null;
    loadSeq++;
    useGha.setState({ ...INITIAL });
  },
  configure: configureToken,
};

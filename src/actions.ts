import type {
  Branch,
  Commit,
  CommitFile,
  FileDiff,
  FileEntry,
  FileSelection,
  OperationKind,
  TagRef,
} from "./types";
import { GitError, git, gitOut } from "./lib/git/runner";
import {
  isStaged,
  isUnstaged,
  parseBlame,
  parseDiff,
  parseLog,
  parseNameStatus,
  parseRefs,
  parseStashes,
  parseStatus,
  parseSubmodules,
} from "./lib/git/parse";
import { layoutGraph } from "./lib/git/graph";
import {
  DEFAULT_FILTER,
  REFS_ARGS,
  STASH_ARGS,
  STATUS_ARGS,
  SUBMODULE_ARGS,
  commitDiffArgs,
  commitFilesArgs,
  isFiltering,
  logArgs,
  untrackedDiffArgs,
  worktreeDiffArgs,
} from "./lib/git/queries";
import { type PatchMode, patchArgs } from "./lib/git/patch";
import { pathExists, pickFolder } from "./lib/tauri";
import { copyText, short } from "./lib/util";
import {
  EMPTY_GRAPH,
  EMPTY_HEAD,
  PAGE,
  WIP_HASH,
  ask,
  confirmDialog,
  save,
  toast,
  useStore,
} from "./store";

const S = () => useStore.getState();
const set = useStore.setState;

const NO_LOCKS = { GIT_OPTIONAL_LOCKS: "0" };

/* ================================================================= repos */

const resetRepoData = () => ({
  head: EMPTY_HEAD,
  local: [],
  remote: [],
  tags: [],
  stashes: [],
  submodules: [],
  commits: [],
  graph: EMPTY_GRAPH,
  hasMore: false,
  limit: PAGE,
  files: [],
  operation: null,
  filter: DEFAULT_FILTER,
  selection: null,
  fileSel: null,
  commitMsg: "",
  amend: false,
  dock: "diff" as const,
  reveal: null,
});

function errorText(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.length > 700 ? msg.slice(0, 700) + "…" : msg;
}

export async function openRepo(path: string) {
  let top: string;
  try {
    top = (await gitOut(path, ["rev-parse", "--show-toplevel"], { silent: true })).trim();
  } catch (e) {
    if (e instanceof GitError && e.code === -1) {
      toast("error", `Não foi possível abrir "${path}": ${errorText(e)}`);
      forget(path);
      return;
    }
    const ok = await confirmDialog(
      "Não é um repositório Git",
      `"${path}" não é um repositório Git. Inicializar um novo repositório aqui (git init)?`,
      { okLabel: "Inicializar" },
    );
    if (!ok) return;
    try {
      await gitOut(path, ["init"]);
    } catch (err) {
      toast("error", errorText(err));
      return;
    }
    top = path;
  }

  const tabs = S().tabs.includes(top) ? S().tabs : [...S().tabs, top];
  const recent = [top, ...S().recent.filter((r) => r !== top)].slice(0, 15);
  save("tabs", tabs);
  save("recent", recent);
  save("active", top);
  set({ tabs, recent, active: top, ...resetRepoData() });
  await refresh();
  const { files, head } = S();
  set({ selection: files.length ? { type: "wip" } : head.hash ? { type: "commit", hash: head.hash } : null });
}

function forget(path: string) {
  const tabs = S().tabs.filter((t) => t !== path);
  const recent = S().recent.filter((t) => t !== path);
  save("tabs", tabs);
  save("recent", recent);
  set({ tabs, recent });
  if (S().active === path) set({ active: null, ...resetRepoData() });
}

export async function browseAndOpen() {
  const p = await pickFolder("Abrir repositório");
  if (p) await openRepo(p);
}

export async function switchTab(path: string) {
  if (S().active === path) return;
  save("active", path);
  set({ active: path, ...resetRepoData() });
  await refresh();
  const { files, head } = S();
  set({ selection: files.length ? { type: "wip" } : head.hash ? { type: "commit", hash: head.hash } : null });
}

export function closeTab(path: string) {
  const tabs = S().tabs.filter((t) => t !== path);
  save("tabs", tabs);
  set({ tabs });
  if (S().active === path) {
    const next = tabs[tabs.length - 1];
    if (next) void switchTabForce(next);
    else set({ active: null, ...resetRepoData() });
  }
}

async function switchTabForce(path: string) {
  set({ active: null });
  await switchTab(path);
}

export async function cloneRepo() {
  const r = await ask({
    title: "Clonar repositório",
    okLabel: "Clonar",
    fields: [
      { name: "url", label: "URL do repositório", type: "text", placeholder: "https://github.com/usuario/repo.git", required: true },
      { name: "parent", label: "Clonar dentro de", type: "folder", required: true },
      { name: "name", label: "Nome da pasta (opcional)", type: "text", placeholder: "deixe vazio para usar o nome do repositório" },
    ],
  });
  if (!r) return;
  const url = String(r.url).trim();
  const parent = String(r.parent).trim();
  const derived = url.replace(/\/+$/, "").split(/[/:]/).pop()!.replace(/\.git$/, "");
  const name = String(r.name).trim() || derived;
  set({ busy: `Clonando ${url}…` });
  try {
    await git(parent, ["clone", "--progress", url, name], { raw: true });
    toast("success", "Repositório clonado.");
    await openRepo(`${parent.replace(/\/+$/, "")}/${name}`);
  } catch (e) {
    toast("error", errorText(e));
  } finally {
    set({ busy: null });
  }
}

/* ============================================================== refresh */

let refreshSeq = 0;

async function detectOperation(path: string): Promise<OperationKind | null> {
  const dir = (await gitOut(path, ["rev-parse", "--git-dir"], { silent: true })).trim();
  const has = (rel: string) => pathExists(path, `${dir}/${rel}`);
  const [rebaseM, rebaseA, cherry, revert, merge] = await Promise.all([
    has("rebase-merge"),
    has("rebase-apply"),
    has("CHERRY_PICK_HEAD"),
    has("REVERT_HEAD"),
    has("MERGE_HEAD"),
  ]);
  return rebaseM || rebaseA ? "rebase" : cherry ? "cherry-pick" : revert ? "revert" : merge ? "merge" : null;
}

export async function refresh() {
  const path = S().active;
  if (!path) return;
  const seq = ++refreshSeq;
  set({ loading: true });
  try {
    const { head, files } = parseStatus(await gitOut(path, STATUS_ARGS, { silent: true, env: NO_LOCKS }));
    const { filter, limit } = S();

    const [refsOut, stashOut, subOut, operation, logOut] = await Promise.all([
      gitOut(path, REFS_ARGS, { silent: true }),
      gitOut(path, STASH_ARGS, { silent: true, allowFail: true }),
      gitOut(path, SUBMODULE_ARGS, { silent: true, allowFail: true }),
      detectOperation(path),
      head.hash ? gitOut(path, logArgs(filter, limit), { silent: true }) : Promise.resolve(""),
    ]);
    if (seq !== refreshSeq) return; // uma atualização mais nova já assumiu

    const refs = parseRefs(refsOut);
    const real = parseLog(logOut);
    const filtering = isFiltering(filter);
    const list: Commit[] = [...real];
    if (files.length && !filtering) {
      list.unshift({
        hash: WIP_HASH,
        parents: head.hash ? [head.hash] : [],
        author: "",
        email: "",
        date: Date.now() / 1000,
        subject: "",
        refs: [],
      });
    }
    const graph = filtering
      ? { rows: list.map(() => ({ col: 0, color: 0, segments: [], merge: false })), lanes: 1 }
      : layoutGraph(list);

    set((s) => ({
      head,
      files,
      operation,
      local: refs.local.sort((a, b) => a.name.localeCompare(b.name)),
      remote: refs.remote.sort((a, b) => a.display.localeCompare(b.display)),
      tags: refs.tags.sort((a, b) => b.name.localeCompare(a.name, undefined, { numeric: true })),
      stashes: parseStashes(stashOut),
      submodules: parseSubmodules(subOut),
      commits: list,
      graph,
      hasMore: real.length >= limit,
      tick: s.tick + 1,
      loading: false,
    }));
  } catch (e) {
    if (seq === refreshSeq) {
      set({ loading: false });
      toast("error", errorText(e));
    }
  }
}

export async function loadMore() {
  set((s) => ({ limit: s.limit + PAGE }));
  await refresh();
}

export async function setFilter(patch: Partial<ReturnType<typeof S>["filter"]>) {
  set((s) => ({ filter: { ...s.filter, ...patch }, limit: PAGE }));
  await refresh();
}

export async function clearFilter() {
  set({ filter: DEFAULT_FILTER, limit: PAGE });
  await refresh();
}

/* =========================================================== seleção/ui */

export function selectWip() {
  set({ selection: { type: "wip" }, fileSel: null, dock: "diff" });
}

export function selectCommit(hash: string) {
  if (hash === WIP_HASH) return selectWip();
  set({ selection: { type: "commit", hash }, fileSel: null, dock: "diff" });
}

/** Seleciona e centraliza um commit no grafo (carregando mais histórico se preciso). */
export async function revealCommit(hash: string) {
  if (!S().commits.some((c) => c.hash === hash)) {
    if (isFiltering(S().filter)) await clearFilter();
    if (!S().commits.some((c) => c.hash === hash) && S().hasMore) {
      set({ limit: 50000 });
      await refresh();
    }
    if (!S().commits.some((c) => c.hash === hash)) {
      toast("info", "Commit fora do histórico carregado.");
      return;
    }
  }
  selectCommit(hash);
  set((s) => ({ reveal: { hash, n: (s.reveal?.n ?? 0) + 1 } }));
}

export function selectFile(fileSel: FileSelection | null) {
  set({ fileSel, dock: "diff" });
}

export function toggleTheme() {
  const theme = S().theme === "dark" ? "light" : "dark";
  save("theme", theme);
  set({ theme });
}

export async function copy(text: string, what = "Copiado") {
  try {
    await copyText(text);
    toast("success", `${what}.`);
  } catch {
    toast("error", "Não foi possível copiar.");
  }
}

/* ===================================================== execução genérica */

/**
 * Executa uma operação mostrando "ocupado", reportando erros e atualizando o
 * repositório ao final. Retorna `undefined` se falhou.
 */
export async function run<T>(
  label: string,
  fn: (path: string) => Promise<T>,
  success?: string,
): Promise<T | undefined> {
  const path = S().active;
  if (!path) return undefined;
  set({ busy: label });
  try {
    const r = await fn(path);
    if (success) toast("success", success);
    return r;
  } catch (e) {
    toast("error", `${label}: ${errorText(e)}`);
    return undefined;
  } finally {
    set({ busy: null });
    await refresh();
  }
}

const runGit = (label: string, args: string[], success?: string) =>
  run(label, (p) => git(p, args), success);

/* ================================================================ remoto */

export const fetchAll = () => runGit("Fetch", ["fetch", "--all", "--prune"], "Fetch concluído.");

export const pull = (mode: "default" | "ff-only" | "rebase" = "default") =>
  runGit("Pull", ["pull", ...(mode === "ff-only" ? ["--ff-only"] : mode === "rebase" ? ["--rebase"] : [])], "Pull concluído.");

async function listRemotes(path: string): Promise<string[]> {
  return (await gitOut(path, ["remote"], { silent: true })).split("\n").filter(Boolean);
}

export async function push(opts: { force?: boolean; tags?: boolean } = {}) {
  const path = S().active;
  if (!path) return;
  const { head } = S();
  if (opts.tags) return void (await runGit("Push tags", ["push", "--tags"], "Tags enviadas."));
  if (opts.force) {
    const ok = await confirmDialog(
      "Force push",
      `Sobrescrever "${head.upstream ?? "o remoto"}" com "${head.branch}"? Usa --force-with-lease (falha se alguém enviou algo novo).`,
      { okLabel: "Force push", danger: true },
    );
    if (!ok) return;
  }
  const force = opts.force ? ["--force-with-lease"] : [];

  if (head.branch && !head.upstream) {
    const remotes = await listRemotes(path);
    if (!remotes.length) return void toast("error", "Este repositório não tem nenhum remote configurado.");
    let remote = remotes.includes("origin") ? "origin" : remotes[0];
    const r = await ask({
      title: "Publicar branch",
      message: `"${head.branch}" ainda não tem upstream.`,
      okLabel: "Publicar",
      fields: [
        {
          name: "remote",
          label: "Remote",
          type: "select",
          value: remote,
          options: remotes.map((x) => ({ value: x, label: x })),
        },
      ],
    });
    if (!r) return;
    remote = String(r.remote);
    return void (await runGit("Push", ["push", "--set-upstream", ...force, remote, head.branch], "Branch publicada."));
  }
  await runGit("Push", ["push", ...force], "Push concluído.");
}

/* ================================================================ branches */

export async function checkoutBranch(b: Branch) {
  if (b.remote) {
    const exists = S().local.some((l) => l.name === b.name);
    return void (await runGit("Checkout", exists ? ["switch", b.name] : ["switch", "--track", b.display], `Checkout de ${b.name}.`));
  }
  if (b.current) return;
  await runGit("Checkout", ["switch", b.name], `Checkout de ${b.name}.`);
}

export const checkoutCommit = (hash: string) =>
  runGit("Checkout", ["switch", "--detach", hash], `HEAD destacado em ${short(hash)}.`);

export const checkoutTag = (t: TagRef) =>
  runGit("Checkout", ["switch", "--detach", `refs/tags/${t.name}`], `HEAD destacado em ${t.name}.`);

export async function createBranch(start?: string) {
  const r = await ask({
    title: "Nova branch",
    message: start ? `A partir de ${start.length === 40 ? short(start) : start}` : "A partir do HEAD atual",
    okLabel: "Criar",
    fields: [
      { name: "name", label: "Nome da branch", type: "text", required: true, placeholder: "feature/minha-ideia" },
      { name: "checkout", label: "Fazer checkout após criar", type: "checkbox", value: true },
    ],
  });
  if (!r) return;
  const name = String(r.name).trim();
  const args = r.checkout ? ["switch", "-c", name] : ["branch", name];
  if (start) args.push(start);
  await runGit("Criar branch", args, `Branch ${name} criada.`);
}

export async function deleteBranch(b: Branch) {
  if (b.remote) {
    const ok = await confirmDialog("Excluir branch remota", `Excluir "${b.display}" do servidor? Isso afeta todos que usam o remote.`, {
      okLabel: "Excluir",
      danger: true,
    });
    if (!ok) return;
    return void (await runGit("Excluir branch remota", ["push", b.remote, "--delete", b.name], `${b.display} excluída.`));
  }
  const r = await ask({
    title: "Excluir branch",
    message: `Excluir a branch local "${b.name}"?`,
    okLabel: "Excluir",
    danger: true,
    fields: [{ name: "force", label: "Forçar (mesmo com commits não mesclados)", type: "checkbox", value: false }],
  });
  if (!r) return;
  await runGit("Excluir branch", ["branch", r.force ? "-D" : "-d", b.name], `Branch ${b.name} excluída.`);
}

export async function renameBranch(b: Branch) {
  const r = await ask({
    title: "Renomear branch",
    okLabel: "Renomear",
    fields: [{ name: "name", label: "Novo nome", type: "text", value: b.name, required: true }],
  });
  if (!r || String(r.name).trim() === b.name) return;
  await runGit("Renomear branch", ["branch", "-m", b.name, String(r.name).trim()], "Branch renomeada.");
}

export async function mergeInto(ref: string, label = ref) {
  const r = await ask({
    title: "Merge",
    message: `Mesclar "${label}" em "${S().head.branch ?? "HEAD"}".`,
    okLabel: "Mesclar",
    fields: [{ name: "noff", label: "Sempre criar commit de merge (--no-ff)", type: "checkbox", value: false }],
  });
  if (!r) return;
  await runGit("Merge", ["merge", ...(r.noff ? ["--no-ff"] : []), ref], `${label} mesclada.`);
}

export async function rebaseOnto(ref: string, label = ref) {
  const ok = await confirmDialog("Rebase", `Reaplicar "${S().head.branch ?? "HEAD"}" sobre "${label}"? O histórico da branch atual será reescrito.`, {
    okLabel: "Rebase",
  });
  if (ok) await runGit("Rebase", ["rebase", ref], "Rebase concluído.");
}

export async function setUpstream(b: Branch) {
  const remotes = S().remote.map((r) => r.display);
  const r = await ask({
    title: "Definir upstream",
    okLabel: "Definir",
    fields: [
      {
        name: "up",
        label: `Upstream de ${b.name}`,
        type: "select",
        value: b.upstream ?? remotes[0] ?? "",
        options: remotes.map((x) => ({ value: x, label: x })),
      },
    ],
  });
  if (r?.up) await runGit("Definir upstream", ["branch", `--set-upstream-to=${r.up}`, b.name], "Upstream definido.");
}

/* ================================================================== commits */

export async function cherryPick(c: Commit) {
  await runGit("Cherry-pick", ["cherry-pick", ...(c.parents.length > 1 ? ["-m", "1"] : []), c.hash], `Cherry-pick de ${short(c.hash)}.`);
}

export async function revertCommit(c: Commit) {
  await runGit("Revert", ["revert", "--no-edit", ...(c.parents.length > 1 ? ["-m", "1"] : []), c.hash], `Commit ${short(c.hash)} revertido.`);
}

export async function resetTo(hash: string) {
  const r = await ask({
    title: "Reset",
    message: `Mover "${S().head.branch ?? "HEAD"}" para ${short(hash)}.`,
    okLabel: "Reset",
    fields: [
      {
        name: "mode",
        label: "Modo",
        type: "select",
        value: "mixed",
        options: [
          { value: "soft", label: "Soft — mantém alterações no stage" },
          { value: "mixed", label: "Mixed — mantém alterações no working tree" },
          { value: "hard", label: "Hard — DESCARTA todas as alterações" },
        ],
      },
    ],
  });
  if (!r) return;
  if (r.mode === "hard") {
    const ok = await confirmDialog("Reset --hard", "Todas as alterações não commitadas serão perdidas definitivamente.", {
      okLabel: "Descartar e resetar",
      danger: true,
    });
    if (!ok) return;
  }
  await runGit("Reset", ["reset", `--${r.mode}`, hash], `Reset ${r.mode} para ${short(hash)}.`);
}

export async function createTag(hash?: string) {
  const r = await ask({
    title: "Nova tag",
    message: hash ? `No commit ${short(hash)}` : "No HEAD atual",
    okLabel: "Criar tag",
    fields: [
      { name: "name", label: "Nome da tag", type: "text", required: true, placeholder: "v1.0.0" },
      { name: "annotated", label: "Tag anotada", type: "checkbox", value: false },
      { name: "message", label: "Mensagem", type: "textarea", showIf: "annotated" },
      { name: "push", label: "Enviar para o remote após criar", type: "checkbox", value: false },
    ],
  });
  if (!r) return;
  const name = String(r.name).trim();
  const args = ["tag"];
  if (r.annotated) args.push("-a", name, "-m", String(r.message).trim() || name);
  else args.push(name);
  if (hash) args.push(hash);
  await run("Criar tag", async (p) => {
    await git(p, args);
    if (r.push) await git(p, ["push", "origin", `refs/tags/${name}`]);
  }, `Tag ${name} criada.`);
}

export async function deleteTag(t: TagRef) {
  const r = await ask({
    title: "Excluir tag",
    message: `Excluir a tag "${t.name}"?`,
    okLabel: "Excluir",
    danger: true,
    fields: [{ name: "remote", label: "Excluir também do remote (origin)", type: "checkbox", value: false }],
  });
  if (!r) return;
  await run("Excluir tag", async (p) => {
    await git(p, ["tag", "-d", t.name]);
    if (r.remote) await git(p, ["push", "origin", "--delete", `refs/tags/${t.name}`]);
  }, `Tag ${t.name} excluída.`);
}

export const pushTag = (t: TagRef) => runGit("Push tag", ["push", "origin", `refs/tags/${t.name}`], `Tag ${t.name} enviada.`);

/* =================================================================== stash */

export async function stashPush() {
  const r = await ask({
    title: "Guardar alterações (stash)",
    okLabel: "Stash",
    fields: [
      { name: "message", label: "Mensagem (opcional)", type: "text" },
      { name: "untracked", label: "Incluir arquivos não rastreados", type: "checkbox", value: true },
    ],
  });
  if (!r) return;
  const msg = String(r.message).trim();
  await runGit("Stash", ["stash", "push", ...(r.untracked ? ["-u"] : []), ...(msg ? ["-m", msg] : [])], "Alterações guardadas.");
}

export const stashPop = (ref = "stash@{0}") => runGit("Stash pop", ["stash", "pop", ref], "Stash aplicado e removido.");
export const stashApply = (ref: string) => runGit("Stash apply", ["stash", "apply", ref], "Stash aplicado.");

export async function stashDrop(ref: string) {
  if (await confirmDialog("Descartar stash", `Excluir ${ref} permanentemente?`, { okLabel: "Excluir", danger: true })) {
    await runGit("Stash drop", ["stash", "drop", ref], "Stash excluído.");
  }
}

/* =================================================== stage / commit / diff */

const nulList = (paths: string[]) => paths.join("\0") + "\0";
const FROM_STDIN = ["--pathspec-from-file=-", "--pathspec-file-nul"];

export const stagePaths = (paths: string[]) =>
  paths.length ? run("Stage", (p) => git(p, ["add", ...FROM_STDIN], { stdin: nulList(paths) })) : undefined;

export const stageAll = () => runGit("Stage", ["add", "-A"]);

export function unstagePaths(entries: FileEntry[]) {
  if (!entries.length) return;
  const paths = entries.flatMap((f) => (f.origPath ? [f.path, f.origPath] : [f.path]));
  const args = S().head.hash ? ["restore", "--staged", ...FROM_STDIN] : ["rm", "--cached", "-r", "-q", ...FROM_STDIN];
  return run("Unstage", (p) => git(p, args, { stdin: nulList(paths) }));
}

export const unstageAll = () => unstagePaths(S().files.filter(isStaged));

export async function discardFiles(entries: FileEntry[]) {
  if (!entries.length) return;
  const label = entries.length === 1 ? `"${entries[0].path}"` : `${entries.length} arquivos`;
  const ok = await confirmDialog("Descartar alterações", `Descartar as alterações em ${label}? Isso não pode ser desfeito.`, {
    okLabel: "Descartar",
    danger: true,
  });
  if (!ok) return;
  const tracked = entries.filter((f) => !f.untracked);
  const untracked = entries.filter((f) => f.untracked);
  await run("Descartar", async (p) => {
    if (tracked.length) await git(p, ["restore", ...FROM_STDIN], { stdin: nulList(tracked.map((f) => f.path)) });
    for (let i = 0; i < untracked.length; i += 100) {
      await git(p, ["clean", "-f", "-q", "--", ...untracked.slice(i, i + 100).map((f) => f.path)]);
    }
  });
  const fs = S().fileSel;
  if (fs && fs.source !== "commit" && entries.some((f) => f.path === fs.path)) set({ fileSel: null });
}

export const discardAllUnstaged = () => discardFiles(S().files.filter(isUnstaged));

export async function applyPatch(patch: string, mode: PatchMode) {
  const label = mode === "stage" ? "Stage" : mode === "unstage" ? "Unstage" : "Descartar";
  await run(label, (p) => git(p, patchArgs(mode), { stdin: patch }));
}

export async function toggleAmend(on: boolean) {
  set({ amend: on });
  if (on && !S().commitMsg.trim() && S().active) {
    try {
      const msg = await gitOut(S().active!, ["log", "-1", "--format=%B"], { silent: true });
      set({ commitMsg: msg.trim() });
    } catch {
      /* sem commits: nada a preencher */
    }
  }
}

export async function commit() {
  const { commitMsg, amend, files } = S();
  const msg = commitMsg.trim();
  if (!msg) return void toast("error", "Escreva uma mensagem de commit.");
  if (!amend && !files.some(isStaged) && S().operation !== "merge")
    return void toast("error", "Não há nada no stage para commitar.");
  const done = await run(
    amend ? "Amend" : "Commit",
    async (p) => {
      await git(p, ["commit", "-F", "-", ...(amend ? ["--amend"] : [])], { stdin: msg + "\n" });
      return true;
    },
    amend ? "Commit alterado." : "Commit criado.",
  );
  if (done) set({ commitMsg: "", amend: false, selection: { type: "wip" } });
}

/* ====================================================== merge/rebase em curso */

const OP_CMD: Record<OperationKind, { cont: string[]; abort: string[]; skip?: string[] }> = {
  merge: { cont: ["commit", "--no-edit"], abort: ["merge", "--abort"] },
  rebase: { cont: ["rebase", "--continue"], abort: ["rebase", "--abort"], skip: ["rebase", "--skip"] },
  "cherry-pick": { cont: ["cherry-pick", "--continue"], abort: ["cherry-pick", "--abort"] },
  revert: { cont: ["revert", "--continue"], abort: ["revert", "--abort"] },
};

export async function operationStep(kind: "cont" | "abort" | "skip") {
  const op = S().operation;
  if (!op) return;
  const args = OP_CMD[op][kind];
  if (!args) return;
  if (kind === "abort") {
    const ok = await confirmDialog("Abortar operação", `Abortar o ${op} em andamento? O estado anterior será restaurado.`, {
      okLabel: "Abortar",
      danger: true,
    });
    if (!ok) return;
  }
  await runGit(op, args);
}

export const resolveConflict = (path: string, side: "ours" | "theirs") =>
  run("Resolver conflito", async (p) => {
    await git(p, ["checkout", `--${side}`, "--", path]);
    await git(p, ["add", "--", path]);
  });

export const markResolved = (path: string) => runGit("Marcar resolvido", ["add", "--", path]);

/* ======================================================= submódulos e afins */

export const updateSubmodules = () =>
  runGit("Submódulos", ["submodule", "update", "--init", "--recursive"], "Submódulos atualizados.");

/* ==================================================== consultas de detalhe */

export interface CommitDetail {
  body: string;
  committer: string;
  committerEmail: string;
  committerDate: number;
}

export async function fetchCommitDetail(path: string, hash: string): Promise<CommitDetail> {
  const out = await gitOut(path, ["show", "-s", "--format=%B%x00%cn%x00%ce%x00%ct", hash], { silent: true });
  const [body, committer, committerEmail, ct] = out.split("\0");
  return { body: body.trim(), committer, committerEmail, committerDate: Number(ct) };
}

export async function fetchCommitFiles(path: string, hash: string, root: boolean): Promise<CommitFile[]> {
  return parseNameStatus(await gitOut(path, commitFilesArgs(hash, !root), { silent: true }));
}

const MAX_DIFF_CHARS = 2_000_000;

export async function fetchDiff(path: string, sel: FileSelection): Promise<FileDiff> {
  let out: string;
  if (sel.source === "commit") {
    out = await gitOut(path, commitDiffArgs(sel.hash, !sel.root, sel.path, sel.oldPath), { silent: true });
  } else if (sel.source === "staged") {
    out = await gitOut(path, worktreeDiffArgs(sel.path, true), { silent: true });
  } else if (sel.untracked) {
    out = (await git(path, untrackedDiffArgs(sel.path), { silent: true, allowFail: true })).stdout;
  } else {
    out = await gitOut(path, worktreeDiffArgs(sel.path, false), { silent: true });
  }
  if (out.length > MAX_DIFF_CHARS) {
    const mb = (out.length / 1_000_000).toFixed(1);
    return { header: [], hunks: [], binary: false, combined: true, raw: `(diff grande demais para exibir: ${mb} MB)` };
  }
  return parseDiff(out);
}

export async function fetchTreePaths(path: string, rev: string): Promise<string[]> {
  const out = await gitOut(path, ["ls-tree", "-r", "--name-only", "-z", rev], { silent: true });
  return out.split("\0").filter(Boolean);
}

export async function fetchFileContent(path: string, rev: string, file: string): Promise<{ text: string; binary: boolean; truncated: boolean }> {
  const size = Number((await gitOut(path, ["cat-file", "-s", `${rev}:${file}`], { silent: true })).trim());
  if (size > 1_500_000) return { text: `(arquivo grande demais para exibir: ${(size / 1e6).toFixed(1)} MB)`, binary: false, truncated: true };
  const text = await gitOut(path, ["show", `${rev}:${file}`], { silent: true });
  return { text, binary: text.includes("�") && text.includes("\0"), truncated: false };
}

export async function fetchBlame(path: string, rev: string, file: string) {
  return parseBlame(await gitOut(path, ["blame", "--porcelain", rev, "--", file], { silent: true }));
}

export function showFileHistory(file: string) {
  return setFilter({ path: file });
}

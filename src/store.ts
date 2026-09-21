import { create } from "zustand";
import type {
  Branch,
  Commit,
  CommandLogEntry,
  FileEntry,
  FileSelection,
  HeadInfo,
  LogFilter,
  OperationKind,
  Selection,
  Stash,
  Submodule,
  TagRef,
} from "./types";
import { DEFAULT_FILTER } from "./lib/git/queries";
import type { GraphLayout } from "./lib/git/graph";
import { setCommandLogSink } from "./lib/git/runner";

/* ------------------------------------------------------------ persistência */

export function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem("gitfusion." + key);
    return raw === null ? fallback : (JSON.parse(raw) as T);
  } catch {
    return fallback;
  }
}

export function save(key: string, value: unknown) {
  try {
    localStorage.setItem("gitfusion." + key, JSON.stringify(value));
  } catch {
    /* armazenamento indisponível: segue sem persistir */
  }
}

/* ------------------------------------------------------------------- UI */

export interface Toast {
  id: number;
  kind: "info" | "success" | "error";
  text: string;
}

export interface MenuItem {
  label?: string;
  action?: () => void;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
}

export type FieldValue = string | boolean;

export interface FieldDef {
  name: string;
  label: string;
  type: "text" | "textarea" | "checkbox" | "select" | "folder";
  value?: FieldValue;
  placeholder?: string;
  options?: { value: string; label: string }[];
  required?: boolean;
  /** Só exibe este campo se o checkbox nomeado estiver marcado. */
  showIf?: string;
}

export interface DialogState {
  title: string;
  message?: string;
  fields: FieldDef[];
  okLabel: string;
  danger?: boolean;
  resolve: (v: Record<string, FieldValue> | null) => void;
}

/* ------------------------------------------------- barra de ferramentas */

export const TOOLBAR_LABELS: Record<string, string> = {
  fetch: "Fetch",
  pull: "Pull (com opções)",
  push: "Push (com opções)",
  branch: "Nova branch",
  stash: "Stash",
  pop: "Stash pop",
  search: "Busca de commits",
  filter: "Filtros do histórico",
  refresh: "Atualizar",
  sep1: "Separador 1",
  sep2: "Separador 2",
  spacer: "Espaço flexível",
};

export interface ToolbarConfig {
  order: string[];
  hidden: string[];
  /** `false` = somente ícones. */
  labels: boolean;
}

export const DEFAULT_TOOLBAR: ToolbarConfig = {
  order: ["fetch", "pull", "push", "sep1", "branch", "stash", "pop", "sep2", "spacer", "search", "filter", "refresh"],
  hidden: [],
  labels: true,
};

/** Descarta ids desconhecidos e acrescenta itens novos que a config salva ainda não conhece. */
function loadToolbar(): ToolbarConfig {
  const saved = load<Partial<ToolbarConfig>>("toolbar", {});
  const known = new Set(DEFAULT_TOOLBAR.order);
  const order = (saved.order ?? []).filter((id, i, a) => known.has(id) && a.indexOf(id) === i);
  for (const id of DEFAULT_TOOLBAR.order) if (!order.includes(id)) order.push(id);
  return {
    order,
    hidden: (saved.hidden ?? []).filter((id) => known.has(id)),
    labels: saved.labels ?? true,
  };
}

export function setToolbar(patch: Partial<ToolbarConfig>) {
  const next = { ...useStore.getState().toolbar, ...patch };
  save("toolbar", next);
  useStore.setState({ toolbar: next });
}

export type DockTab = "diff" | "tree" | "console" | "log";

export const WIP_HASH = "__WIP__";

export const EMPTY_HEAD: HeadInfo = { hash: null, branch: null, detached: false, ahead: 0, behind: 0 };
export const EMPTY_GRAPH: GraphLayout = { rows: [], lanes: 1 };
export const PAGE = 1000;

interface AppState {
  /* workspace */
  tabs: string[];
  active: string | null;
  recent: string[];
  theme: "dark" | "light";
  filesView: "list" | "tree";
  toolbar: ToolbarConfig;
  customizingToolbar: boolean;

  /* repositório ativo */
  loading: boolean;
  busy: string | null;
  /** Incrementa a cada refresh; painéis dependentes recarregam. */
  tick: number;
  head: HeadInfo;
  local: Branch[];
  remote: Branch[];
  tags: TagRef[];
  stashes: Stash[];
  submodules: Submodule[];
  /** Commits exibidos (inclui a linha virtual WIP quando há mudanças). */
  commits: Commit[];
  graph: GraphLayout;
  hasMore: boolean;
  limit: number;
  files: FileEntry[];
  operation: OperationKind | null;

  filter: LogFilter;
  selection: Selection;
  fileSel: FileSelection | null;
  commitMsg: string;
  amend: boolean;
  dock: DockTab;
  /** Hash a ser exibido/centralizado no grafo (efeito pontual). */
  reveal: { hash: string; n: number } | null;

  commandLog: CommandLogEntry[];
  toasts: Toast[];
  dialog: DialogState | null;
  menu: { x: number; y: number; items: MenuItem[] } | null;
}

export const useStore = create<AppState>(() => ({
  tabs: load<string[]>("tabs", []),
  active: null,
  recent: load<string[]>("recent", []),
  theme: load<"dark" | "light">("theme", "dark"),
  filesView: load<"list" | "tree">("filesView", "list"),
  toolbar: loadToolbar(),
  customizingToolbar: false,

  loading: false,
  busy: null,
  tick: 0,
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
  dock: "diff",
  reveal: null,

  commandLog: [],
  toasts: [],
  dialog: null,
  menu: null,
}));

let logId = 0;
setCommandLogSink((e) =>
  useStore.setState((s) => ({
    commandLog: [...s.commandLog.slice(-299), { ...e, id: ++logId }],
  })),
);

/* ---------------------------------------------------------------- helpers */

let toastId = 0;

export function toast(kind: Toast["kind"], text: string) {
  const id = ++toastId;
  useStore.setState((s) => ({ toasts: [...s.toasts, { id, kind, text }] }));
  setTimeout(
    () => useStore.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
    kind === "error" ? 9000 : 3500,
  );
}

export function dismissToast(id: number) {
  useStore.setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
}

export function ask(cfg: Omit<DialogState, "resolve">): Promise<Record<string, FieldValue> | null> {
  return new Promise((resolve) => useStore.setState({ dialog: { ...cfg, resolve } }));
}

export async function confirmDialog(
  title: string,
  message: string,
  opts: { okLabel?: string; danger?: boolean } = {},
): Promise<boolean> {
  const r = await ask({ title, message, fields: [], okLabel: opts.okLabel ?? "Confirmar", danger: opts.danger });
  return r !== null;
}

export function showMenu(e: { clientX: number; clientY: number; preventDefault: () => void }, items: MenuItem[]) {
  e.preventDefault();
  useStore.setState({ menu: { x: e.clientX, y: e.clientY, items } });
}

export function showMenuAt(x: number, y: number, items: MenuItem[]) {
  useStore.setState({ menu: { x, y, items } });
}

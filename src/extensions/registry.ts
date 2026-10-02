import type { ComponentType } from "react";
import { create } from "zustand";
import type { Commit } from "../types";
import { revealCommit } from "../actions";
import { git } from "../lib/git/runner";
import { httpRequest, openUrl } from "../lib/tauri";
import { ask, load, save, toast, useStore } from "../store";
import type { DockTabContribution, ExtContext, ExtEvent, Extension, ToolbarContribution, Unsub } from "./api";

type Owned<T> = T & { ext: string };

interface ExtensionsState {
  available: Extension[];
  enabled: Record<string, boolean>;
  /** Ids já prefixados: `ext:<extensão>:<id>`. */
  dockTabs: Owned<DockTabContribution>[];
  toolbarItems: Owned<ToolbarContribution>[];
  commitBadges: Owned<{ key: string; component: ComponentType<{ commit: Commit }> }>[];
  managing: boolean;
}

export const useExtensions = create<ExtensionsState>(() => ({
  available: [],
  enabled: load<Record<string, boolean>>("extensions", {}),
  dockTabs: [],
  toolbarItems: [],
  commitBadges: [],
  managing: false,
}));

const set = useExtensions.setState;
const E = () => useExtensions.getState();

export const extItemId = (ext: string, id: string) => `ext:${ext}:${id}`;

export const isEnabled = (ext: Extension, enabled = E().enabled) => enabled[ext.id] ?? ext.defaultEnabled ?? true;

/* --------------------------------------------------------------- eventos */

const listeners = new Map<ExtEvent, Set<() => void>>();

function emit(event: ExtEvent) {
  for (const fn of listeners.get(event) ?? []) {
    try {
      fn();
    } catch (e) {
      console.error(`[extensões] erro em "${event}":`, e);
    }
  }
}

/* ----------------------------------------------------------- ciclo de vida */

const running = new Map<string, Unsub[]>();

function makeContext(ext: Extension, disposables: Unsub[]): ExtContext {
  const track = (u: Unsub): Unsub => {
    disposables.push(u);
    return u;
  };
  const without = <K extends "dockTabs" | "toolbarItems" | "commitBadges">(key: K, id: string) => () =>
    set((s) => ({ [key]: (s[key] as { ext: string; id?: string; key?: string }[]).filter((c) => (c.id ?? c.key) !== id) }));
  let badgeSeq = 0;

  return {
    id: ext.id,
    repo: () => useStore.getState().active,
    git: async (args, opts) => {
      const cwd = useStore.getState().active;
      if (!cwd) throw new Error("nenhum repositório aberto");
      return git(cwd, args, { silent: true, allowFail: true, ...opts });
    },
    http: async ({ method = "GET", url, headers, body }) => {
      let host = "";
      try {
        host = new URL(url).host;
      } catch {
        /* cai na recusa abaixo */
      }
      if (!url.startsWith("https://") || !ext.hosts?.includes(host)) {
        throw new Error(`a extensão "${ext.name}" não tem permissão para acessar ${host || url}`);
      }
      return httpRequest(method, url, headers, body);
    },
    openUrl,
    storage: {
      get: (key, fallback) => load(`ext.${ext.id}.${key}`, fallback),
      set: (key, value) => save(`ext.${ext.id}.${key}`, value),
    },
    toast,
    ask,
    showDockTab: (id) => useStore.setState({ dock: extItemId(ext.id, id) }),
    revealCommit: (hash) => void revealCommit(hash),
    on: (event, fn) => {
      if (!listeners.has(event)) listeners.set(event, new Set());
      listeners.get(event)!.add(fn);
      return track(() => listeners.get(event)?.delete(fn));
    },
    ui: {
      dockTab: (t) => {
        const id = extItemId(ext.id, t.id);
        set((s) => ({ dockTabs: [...s.dockTabs.filter((c) => c.id !== id), { ...t, id, ext: ext.id }] }));
        return track(without("dockTabs", id));
      },
      toolbarItem: (t) => {
        const id = extItemId(ext.id, t.id);
        set((s) => ({ toolbarItems: [...s.toolbarItems.filter((c) => c.id !== id), { ...t, id, ext: ext.id }] }));
        return track(without("toolbarItems", id));
      },
      commitBadge: (component) => {
        const key = `${ext.id}#${++badgeSeq}`;
        set((s) => ({ commitBadges: [...s.commitBadges, { key, component, ext: ext.id }] }));
        return track(without("commitBadges", key));
      },
    },
  };
}

async function activate(ext: Extension) {
  if (running.has(ext.id)) return;
  const disposables: Unsub[] = [];
  running.set(ext.id, disposables);
  try {
    await ext.activate(makeContext(ext, disposables));
  } catch (e) {
    deactivate(ext);
    toast("error", `Falha ao ativar a extensão "${ext.name}": ${e instanceof Error ? e.message : String(e)}`);
  }
}

function deactivate(ext: Extension) {
  const disposables = running.get(ext.id);
  if (!disposables) return;
  running.delete(ext.id);
  try {
    ext.deactivate?.();
  } catch (e) {
    console.error(`[extensões] erro ao desativar "${ext.id}":`, e);
  }
  for (const d of disposables.splice(0)) d();
  const dock = useStore.getState().dock;
  if (dock.startsWith(extItemId(ext.id, ""))) useStore.setState({ dock: "diff" });
}

export async function setExtensionEnabled(id: string, on: boolean) {
  const ext = E().available.find((x) => x.id === id);
  if (!ext) return;
  const enabled = { ...E().enabled, [id]: on };
  save("extensions", enabled);
  set({ enabled });
  if (on) {
    await activate(ext);
    // a extensão recém-ativada precisa saber qual repo está aberto
    if (useStore.getState().active) emit("repoChanged");
  } else deactivate(ext);
}

let started = false;

/** Registra as extensões disponíveis e ativa as habilitadas. Idempotente. */
export async function startExtensions(list: Extension[]) {
  if (started) return;
  started = true;
  set({ available: list });

  useStore.subscribe((s, prev) => {
    if (s.active !== prev.active) emit("repoChanged");
    else if (s.tick !== prev.tick) emit("refreshed");
  });

  await Promise.all(list.filter((x) => isEnabled(x)).map(activate));
  if (useStore.getState().active) emit("repoChanged");
}

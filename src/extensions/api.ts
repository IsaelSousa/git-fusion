import type { ComponentType } from "react";
import type { Commit } from "../types";
import type { GitOptions } from "../lib/git/runner";
import type { HttpResponse } from "../lib/tauri";
import type { DialogState, FieldValue, Toast } from "../store";

/**
 * Contrato das extensões do GitFusion.
 *
 * Uma extensão é um módulo que, ao ser ativado, recebe um `ExtContext` e
 * registra contribuições na interface (abas no dock, itens na barra, badges no
 * grafo). Tudo o que ela registra é desfeito automaticamente ao desativar.
 */
export interface Extension {
  /** Identificador estável (vai nas chaves de configuração e nos ids `ext:<id>:…`). */
  id: string;
  name: string;
  description: string;
  /** Hosts que a extensão pode acessar via `ctx.http` (o núcleo Rust também restringe). */
  hosts?: string[];
  /** Ativa ao instalar? (padrão: sim) */
  defaultEnabled?: boolean;
  activate(ctx: ExtContext): void | Promise<void>;
  deactivate?(): void;
  /** Botão "Configurar…" na tela de extensões. */
  configure?(): void | Promise<void>;
}

export type ExtEvent = "repoChanged" | "refreshed";

export type Unsub = () => void;

export interface HttpRequest {
  method?: string;
  url: string;
  headers?: Record<string, string>;
  body?: string;
}

export interface DockTabContribution {
  id: string;
  label: string;
  component: ComponentType;
  /** Conteúdo pequeno ao lado do rótulo (ex.: contador). */
  badge?: ComponentType;
}

export interface ToolbarContribution {
  id: string;
  /** Nome exibido no "Personalizar barra de ferramentas". */
  label: string;
  component: ComponentType;
}

export interface ExtContext {
  readonly id: string;
  /** Caminho do repositório ativo. */
  repo(): string | null;
  /** `git` no repositório ativo; por padrão não entra no log de comandos e não lança erro. */
  git(args: string[], opts?: GitOptions): Promise<{ code: number; stdout: string; stderr: string }>;
  /** HTTPS restrito a `Extension.hosts`. */
  http(req: HttpRequest): Promise<HttpResponse>;
  openUrl(url: string): Promise<void>;
  storage: {
    get<T>(key: string, fallback: T): T;
    set(key: string, value: unknown): void;
  };
  toast(kind: Toast["kind"], text: string): void;
  ask(cfg: Omit<DialogState, "resolve">): Promise<Record<string, FieldValue> | null>;
  /** Abre uma aba do dock registrada por esta extensão. */
  showDockTab(id: string): void;
  /** Seleciona e centraliza um commit no grafo. */
  revealCommit(hash: string): void;
  on(event: ExtEvent, fn: () => void): Unsub;
  ui: {
    dockTab(t: DockTabContribution): Unsub;
    toolbarItem(t: ToolbarContribution): Unsub;
    /** Componente renderizado ao lado da mensagem de cada commit no grafo. */
    commitBadge(component: ComponentType<{ commit: Commit }>): Unsub;
  };
}

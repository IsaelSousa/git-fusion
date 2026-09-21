// @vitest-environment jsdom
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { StrictMode } from "react";
import { act } from "react";
import { type Root, createRoot } from "react-dom/client";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ repo: "" }));

// O "Tauri" dos testes: mesmas assinaturas do núcleo Rust, mas executando o git real.
vi.mock("@tauri-apps/api/core", () => ({
  invoke: async (cmd: string, a: Record<string, unknown>) => {
    if (cmd === "run_git") {
      const r = spawnSync("git", a.args as string[], {
        cwd: a.cwd as string,
        input: (a.stdin as string | null) ?? undefined,
        encoding: "utf8",
        env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true", GIT_MERGE_AUTOEDIT: "no", ...((a.env as object) ?? {}) },
      });
      return { code: r.status ?? -1, stdout: r.stdout, stderr: r.stderr };
    }
    if (cmd === "path_exists") return existsSync(join(a.cwd as string, a.rel as string));
    if (cmd === "startup_path") return h.repo;
    throw new Error("comando desconhecido: " + cmd);
  },
}));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: async () => null }));

const g = (args: string[], input?: string) => {
  const r = spawnSync("git", args, { cwd: h.repo, input, encoding: "utf8" });
  if (r.status !== 0) throw new Error(r.stderr);
  return r.stdout;
};
const w = (f: string, c: string) => writeFileSync(join(h.repo, f), c);

let root: Root;
let container: HTMLElement;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function waitFor<T>(fn: () => T | null | undefined | false, what: string, ms = 8000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timeout esperando: " + what + "\n" + container.textContent?.slice(0, 600));
    await act(async () => {
      await sleep(25);
    });
  }
}
const click = (el: Element) =>
  act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await sleep(10);
  });
const $$ = (sel: string) => [...container.querySelectorAll<HTMLElement>(sel)];
const byText = (sel: string, text: string) => $$(sel).find((e) => e.textContent?.includes(text));

beforeAll(async () => {
  h.repo = mkdtempSync(join(tmpdir(), "gitfusion-ui-"));
  g(["init", "-q", "-b", "main"]);
  g(["config", "user.name", "Tester"]);
  g(["config", "user.email", "t@e.com"]);
  g(["config", "commit.gpgsign", "false"]);
  w("s.txt", Array.from({ length: 30 }, (_, i) => `l${i + 1}`).join("\n") + "\n");
  g(["add", "."]);
  g(["commit", "-qm", "primeiro"]);
  g(["switch", "-qc", "feature/x"]);
  w("f.txt", "f\n");
  g(["add", "."]);
  g(["commit", "-qm", "trabalho da feature"]);
  g(["switch", "-q", "main"]);
  w("m.txt", "m\n");
  g(["add", "."]);
  g(["commit", "-qm", "trabalho da main"]);
  g(["merge", "-q", "--no-ff", "feature/x", "-m", "Merge feature/x"]);
  g(["tag", "v1.0"]);
  // stash + working tree sujo: dois hunks distantes em s.txt, staged e untracked
  w("stashed.txt", "x\n");
  g(["add", "stashed.txt"]);
  g(["stash", "push", "-q", "-m", "meu stash"]);
  const lines = Array.from({ length: 30 }, (_, i) => `l${i + 1}`);
  lines[1] = "DOIS";
  lines[26] = "VINTE E OITO";
  w("s.txt", lines.join("\n") + "\n");
  w("novo.txt", "novo\n");
  w("staged.txt", "s\n");
  g(["add", "staged.txt"]);

  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  class RO {
    observe() {}
    disconnect() {}
  }
  (globalThis as unknown as Record<string, unknown>).ResizeObserver = RO;
  Element.prototype.scrollIntoView = () => {};

  const { default: App } = await import("../src/App");
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(
      <StrictMode>
        <App />
      </StrictMode>,
    );
  });
});

afterAll(() => {
  act(() => root.unmount());
  rmSync(h.repo, { recursive: true, force: true });
});

describe("App completo sobre um repositório real", () => {
  it("abre o repo da CLI e mostra grafo, chips, WIP e sidebar", async () => {
    await waitFor(() => $$(".grow").length >= 5, "5 linhas no grafo (WIP + 4 commits)");
    const rows = $$(".grow");
    expect(rows[0].classList.contains("wip")).toBe(true);
    expect(rows[0].textContent).toContain("Alterações não commitadas");
    expect(rows[0].textContent).toContain("3"); // s.txt, novo.txt, staged.txt
    const merge = rows.find((r) => r.textContent?.includes("Merge feature/x"))!;
    expect(merge.querySelector(".chip-local.current")?.textContent).toBe("main");
    expect(merge.textContent).toContain("v1.0");
    expect(merge.querySelector("svg circle")).not.toBeNull();
    // sidebar
    expect(byText(".side-item", "feature/x")).toBeTruthy();
    expect(byText(".side-item", "meu stash")).toBeTruthy();
    expect(byText(".side-head", "Tags")).toBeTruthy();
  });

  it("seleciona um arquivo e stageia só o primeiro bloco", async () => {
    await waitFor(() => byText(".file-row", "s.txt"), "s.txt na lista não staged");
    await click(byText(".file-row", "s.txt")!);
    await waitFor(() => $$(".dhunk").length === 2, "2 hunks no diff");
    const stageHunk = byText(".dhunk-actions button", "Stage bloco")!;
    await click(stageHunk);
    await waitFor(() => g(["diff", "--cached", "--", "s.txt"]).includes("DOIS"), "hunk 1 no índice");
    const cached = g(["diff", "--cached", "--", "s.txt"]);
    expect(cached).not.toContain("VINTE E OITO");
    expect(g(["diff", "--", "s.txt"])).toContain("VINTE E OITO");
    // a UI reflete: s.txt agora aparece nas duas listas
    await waitFor(() => $$(".file-row").filter((r) => r.textContent?.includes("s.txt")).length === 2, "s.txt em staged e não staged");
  });

  it("stage por linha e commit pela UI", async () => {
    // seleciona a linha '+VINTE E OITO' e a '-l27' do hunk restante
    await waitFor(() => $$(".dhunk").length === 1, "1 hunk restante");
    const pickers = $$(".dl .dgut.pick");
    expect(pickers.length).toBe(2);
    for (const p of pickers) await click(p);
    const btn = await waitFor(() => byText(".dhunk-actions button", "Stage 2 linhas"), "botão Stage 2 linhas");
    await click(btn);
    await waitFor(() => g(["diff", "--", "s.txt"]) === "", "worktree de s.txt limpo");

    const ta = $$(".commit-box textarea")[0] as HTMLTextAreaElement;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!;
      set.call(ta, "Commit feito pela UI");
      ta.dispatchEvent(new Event("input", { bubbles: true }));
    });
    const before = g(["rev-list", "--count", "HEAD"]).trim();
    await click(byText(".commit-box button", "Commit")!);
    await waitFor(() => g(["rev-list", "--count", "HEAD"]).trim() === String(+before + 1), "novo commit");
    expect(g(["log", "-1", "--format=%s"]).trim()).toBe("Commit feito pela UI");
    expect(g(["show", "--name-only", "--format=", "HEAD"]).split("\n").filter(Boolean).sort()).toEqual(["s.txt", "staged.txt"]);
    // o grafo ganhou o commit novo no topo (abaixo do WIP, que ainda tem novo.txt)
    await waitFor(() => byText(".grow", "Commit feito pela UI"), "commit novo no grafo");
  });

  it("seleciona um commit e mostra detalhes e arquivos", async () => {
    await click(byText(".grow", "Merge feature/x")!);
    await waitFor(() => byText(".cd-subject", "Merge feature/x"), "detalhes do commit");
    await waitFor(() => byText(".file-row", "f.txt"), "arquivo f.txt do merge");
    await click(byText(".file-row", "f.txt")!);
    await waitFor(() => byText(".dl-add .dtxt", "f"), "diff do arquivo do commit");
  });

  it("console executa comandos git e o log de comandos registra as ações", async () => {
    await click(byText(".dock-tab", "Console")!);
    const input = container.querySelector<HTMLInputElement>(".console-in input")!;
    await act(async () => {
      const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
      set.call(input, "log --oneline -1");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    await waitFor(() => container.querySelector(".console-entry pre")?.textContent?.includes("Commit feito pela UI"), "saída do console");
    await click(byText(".dock-tab", "Log de comandos")!);
    await waitFor(() => byText(".cmdlog-line", "git commit -F -"), "commit no log de comandos");
  });

  it("aba Arquivos mostra a árvore e o blame da revisão selecionada", async () => {
    await click(byText(".dock-tab", "Arquivos")!);
    await waitFor(() => byText(".tree-row", "s.txt"), "s.txt na árvore");
    await click(byText(".tree-row", "s.txt")!);
    await waitFor(() => byText(".code .dtxt", "l30"), "conteúdo do arquivo (na revisão do merge selecionado)");
    await click(byText(".seg button", "Blame")!);
    await waitFor(() => $$(".blame").length > 20, "linhas de blame");
  }, 15000);

  it("barra superior personalizável: ocultar, reordenar, só ícones, persistir e restaurar", async () => {
    const labels = () => $$(".toolbar .tb-btn:not(.tb-drop)").map((b) => b.textContent?.trim().replace(/[↓↑]\d+/, "").trim());
    expect(labels().slice(0, 3)).toEqual(["Fetch", "Pull", "Push"]);

    await click(container.querySelector('[title="Personalizar barra de ferramentas"]')!);
    await waitFor(() => byText(".dialog h3", "Personalizar barra"), "janela de personalização");

    // oculta Fetch
    const fetchRow = byText(".cust-row", "Fetch")!;
    await click(fetchRow.querySelector("input[type=checkbox]")!);
    await waitFor(() => !labels().includes("Fetch"), "Fetch oculto");

    // move Stash uma posição para cima (antes de Branch)
    await click(byText(".cust-row", "Stash")!.querySelector('[title="Mover para cima"]')!);
    await waitFor(() => labels().indexOf("Stash") < labels().indexOf("Branch"), "Stash antes de Branch");

    // só ícones
    const select = container.querySelector<HTMLSelectElement>(".dialog select")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")!.set!.call(select, "icons");
      select.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await waitFor(() => container.querySelector(".toolbar.icons-only"), "modo só ícones");

    // persistiu
    const saved = JSON.parse(localStorage.getItem("gitfusion.toolbar")!);
    expect(saved.hidden).toContain("fetch");
    expect(saved.labels).toBe(false);
    expect(saved.order.indexOf("stash")).toBeLessThan(saved.order.indexOf("branch"));

    // restaurar padrão
    await click(byText(".dialog-actions button", "Restaurar padrão")!);
    await waitFor(() => container.querySelector(".toolbar:not(.icons-only)") && labels().includes("Fetch"), "padrão restaurado");
    await click(byText(".dialog-actions button", "Concluído")!);
    await waitFor(() => !container.querySelector(".dialog"), "janela fechada");
  });

  it("botão direito numa branch abre o menu com Checkout (sidebar e chip do grafo)", async () => {
    const rightClick = (el: Element) =>
      act(async () => {
        el.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
        await sleep(10);
      });
    const current = () => g(["branch", "--show-current"]).trim();
    expect(current()).toBe("main");

    // sidebar: o direito só abre o menu (nada muda até clicar em Checkout)
    await rightClick(byText(".side-item", "feature/x")!);
    const item = await waitFor(() => byText(".menu-item", "Checkout de"), "item Checkout no menu");
    expect(item.textContent).toContain("feature/x");
    expect((item as HTMLButtonElement).disabled).toBe(false);
    expect(current()).toBe("main");
    await click(item);
    await waitFor(() => current() === "feature/x", "checkout pelo menu da sidebar");
    expect(container.querySelector(".menu")).toBeNull();

    // chip do grafo: menu da branch (e não o do commit), com Checkout
    const chip = await waitFor(() => $$(".gmsg .chip-local").find((c) => c.textContent === "main"), "chip main no grafo");
    await rightClick(chip);
    const item2 = await waitFor(() => byText(".menu-item", "Checkout de"), "Checkout no menu do chip");
    expect(byText(".menu-item", "Cherry-pick")).toBeUndefined();
    await click(item2);
    await waitFor(() => current() === "main", "checkout pelo menu do chip");
  });

  it("arquivos alterados: alterna para árvore, agrupa por pasta, recolhe e faz stage da pasta", async () => {
    mkdirSync(join(h.repo, "pkg/core/deep"), { recursive: true });
    w("pkg/core/deep/one.txt", "1\n");
    w("pkg/core/deep/two.txt", "2\n");
    w("pkg/top.txt", "t\n");
    await click(byText(".grow.wip", "Alterações")!);
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
      await sleep(50);
    });
    await waitFor(() => byText(".file-row", "one.txt"), "arquivos novos no modo lista");
    expect(container.querySelector(".dir-row")).toBeNull();

    await click(byText(".view-bar .seg button", "Árvore")!);
    expect(JSON.parse(localStorage.getItem("gitfusion.filesView")!)).toBe("tree");
    // pastas com filho único são compactadas: pkg > core/deep
    const dir = await waitFor(() => byText(".dir-row", "core/deep"), "pasta compactada core/deep");
    expect(dir.querySelector(".side-count")?.textContent).toBe("2");
    expect(byText(".dir-row", "pkg")).toBeTruthy();
    // no modo árvore a linha do arquivo mostra só o nome, sem o diretório
    expect(byText(".file-row", "one.txt")!.querySelector(".path-dir")).toBeNull();

    // recolher a pasta esconde os arquivos
    await click(dir);
    await waitFor(() => !byText(".file-row", "one.txt"), "arquivos escondidos");
    await click(byText(".dir-row", "core/deep")!);
    await waitFor(() => byText(".file-row", "one.txt"), "arquivos de volta");

    // stage da pasta inteira pelo botão da linha da pasta
    await click(byText(".dir-row", "core/deep")!.querySelector('[title="Stage pkg/core/deep/"]')!);
    await waitFor(() => g(["diff", "--cached", "--name-only"]).includes("pkg/core/deep/two.txt"), "pasta no índice");
    expect(g(["diff", "--cached", "--name-only"])).not.toContain("pkg/top.txt");

    // volta para lista e persiste
    await click(byText(".view-bar .seg button", "Lista")!);
    await waitFor(() => !container.querySelector(".dir-row"), "modo lista de volta");
    expect(JSON.parse(localStorage.getItem("gitfusion.filesView")!)).toBe("list");
  });
});

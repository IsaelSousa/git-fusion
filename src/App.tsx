import { useEffect } from "react";
import { browseAndOpen, openRepo, refresh } from "./actions";
import { ContextMenu } from "./components/ContextMenu";
import { CommitGraph } from "./components/CommitGraph";
import { Dashboard } from "./components/Dashboard";
import { Dialog } from "./components/Dialog";
import { Dock } from "./components/Dock";
import { OperationBanner } from "./components/OperationBanner";
import { RightPanel } from "./components/RightPanel";
import { Sidebar } from "./components/Sidebar";
import { Splitter, usePersistedSize } from "./components/Splitter";
import { TabBar } from "./components/TabBar";
import { Toasts } from "./components/Toasts";
import { Toolbar } from "./components/Toolbar";
import { ToolbarCustomizer } from "./components/ToolbarCustomizer";
import { ExtensionManager } from "./components/ExtensionManager";
import { BUILTIN_EXTENSIONS } from "./extensions";
import { startExtensions } from "./extensions/registry";
import { load, useStore } from "./store";
import { startupPath } from "./lib/tauri";
import { basename } from "./lib/util";

export default function App() {
  const active = useStore((s) => s.active);
  const theme = useStore((s) => s.theme);
  const busy = useStore((s) => s.busy);
  const loading = useStore((s) => s.loading);
  const head = useStore((s) => s.head);

  const [sideW, dragSide] = usePersistedSize("sideW", 250, 170, 480);
  const [rightW, dragRight] = usePersistedSize("rightW", 380, 280, 720);
  const [dockH, dragDock] = usePersistedSize("dockH", 300, 120, 700);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  // Abre o repositório passado na linha de comando ou reabre a última sessão.
  useEffect(() => {
    void startExtensions(BUILTIN_EXTENSIONS);
  }, []);

  useEffect(() => {
    (async () => {
      const fromCli = await startupPath().catch(() => null);
      if (fromCli) return openRepo(fromCli);
      const tabs = useStore.getState().tabs;
      const last = load<string | null>("active", null);
      const target = last && tabs.includes(last) ? last : tabs[tabs.length - 1];
      if (target) await openRepo(target);
    })();
  }, []);

  useEffect(() => {
    document.title = active ? `${basename(active)} — GitFusion` : "GitFusion";
  }, [active]);

  // Atualiza ao voltar para a janela (o usuário pode ter mexido no repo por fora).
  useEffect(() => {
    const onFocus = () => void refresh();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F5") {
        e.preventDefault();
        void refresh();
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "o") {
        e.preventDefault();
        void browseAndOpen();
      }
    };
    window.addEventListener("focus", onFocus);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("focus", onFocus);
      window.removeEventListener("keydown", onKey);
    };
  }, []);

  return (
    <div className="app">
      <TabBar />
      {active ? (
        <>
          <Toolbar />
          <div className="main">
            <div style={{ width: sideW }} className="col">
              <Sidebar />
            </div>
            <Splitter dir="h" onDrag={dragSide} />
            <div className="center">
              <OperationBanner />
              <div className="center-top">
                <CommitGraph />
              </div>
              <Splitter dir="v" onDrag={(d) => dragDock(-d)} />
              <div style={{ height: dockH }} className="center-bottom">
                <Dock />
              </div>
            </div>
            <Splitter dir="h" onDrag={(d) => dragRight(-d)} />
            <div style={{ width: rightW }} className="col right">
              <RightPanel />
            </div>
          </div>
          <div className="statusbar">
            <span className="mono">{active}</span>
            <span>
              {head.detached ? "HEAD destacado" : head.branch ?? "(sem commits)"}
              {head.upstream && ` → ${head.upstream}`}
            </span>
            <span className="grow-fill" />
            {(busy || loading) && <span className="spinner-text"><span className="spinner" /> {busy ?? "Atualizando…"}</span>}
          </div>
        </>
      ) : (
        <Dashboard />
      )}
      <ContextMenu />
      <Dialog />
      <ToolbarCustomizer />
      <ExtensionManager />
      <Toasts />
      {!active && busy && (
        <div className="statusbar floating"><span className="spinner" /> {busy}</div>
      )}
    </div>
  );
}

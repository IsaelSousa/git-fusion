import type { ComponentType } from "react";
import { useStore, type DockTab } from "../store";
import { useExtensions } from "../extensions/registry";
import { CommandLog } from "./CommandLog";
import { Console } from "./Console";
import { DiffView } from "./DiffView";
import { FileTree } from "./FileTree";

const TABS: { id: DockTab; label: string }[] = [
  { id: "diff", label: "Diff" },
  { id: "tree", label: "Arquivos" },
  { id: "console", label: "Console" },
  { id: "log", label: "Log de comandos" },
];

export function Dock() {
  const dock = useStore((s) => s.dock);
  const fileSel = useStore((s) => s.fileSel);
  const logCount = useStore((s) => s.commandLog.length);
  const extTabs = useExtensions((s) => s.dockTabs);
  const tabs: { id: DockTab; label: string; badge?: ComponentType }[] = [...TABS, ...extTabs];
  const ExtBody = extTabs.find((t) => t.id === dock)?.component;

  return (
    <div className="dock">
      <div className="dock-tabs">
        {tabs.map((t) => (
          <button key={t.id} className={`dock-tab${dock === t.id ? " active" : ""}`} onClick={() => useStore.setState({ dock: t.id })}>
            {t.label}
            {t.id === "log" && logCount > 0 && <span className="side-count">{logCount}</span>}
            {t.badge && <t.badge />}
          </button>
        ))}
      </div>
      <div className="dock-body">
        {dock === "diff" &&
          (fileSel ? <DiffView sel={fileSel} /> : <div className="empty">Selecione um arquivo alterado para ver o diff.</div>)}
        {dock === "tree" && <FileTree />}
        {dock === "console" && <Console />}
        {dock === "log" && <CommandLog />}
        {ExtBody && <ExtBody />}
      </div>
    </div>
  );
}

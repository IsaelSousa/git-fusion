import { browseAndOpen, closeTab, cloneRepo, switchTab, toggleTheme } from "../actions";
import { showMenuAt, useStore } from "../store";
import { basename } from "../lib/util";
import { IconClose, IconMoon, IconPlus, IconSliders, IconSun } from "./Icons";

export function TabBar() {
  const tabs = useStore((s) => s.tabs);
  const active = useStore((s) => s.active);
  const theme = useStore((s) => s.theme);
  const hasRepo = active !== null;

  return (
    <div className="tabbar">
      <div className="tabs">
        {tabs.map((t) => (
          <div
            key={t}
            className={`tab${t === active ? " active" : ""}`}
            title={t}
            onClick={() => switchTab(t)}
            onAuxClick={(e) => e.button === 1 && closeTab(t)}
          >
            <span className="tab-name">{basename(t)}</span>
            <button
              className="icon-btn tab-close"
              title="Fechar"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(t);
              }}
            >
              <IconClose />
            </button>
          </div>
        ))}
        <button
          className="icon-btn tab-add"
          title="Abrir / clonar repositório"
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect();
            showMenuAt(r.left, r.bottom + 2, [
              { label: "Abrir repositório…", action: browseAndOpen },
              { label: "Clonar repositório…", action: cloneRepo },
            ]);
          }}
        >
          <IconPlus />
        </button>
      </div>
      {hasRepo && (
        <button
          className="icon-btn"
          title="Personalizar barra de ferramentas"
          onClick={() => useStore.setState({ customizingToolbar: true })}
        >
          <IconSliders />
        </button>
      )}
      <button className="icon-btn" title="Alternar tema" onClick={toggleTheme}>
        {theme === "dark" ? <IconSun /> : <IconMoon />}
      </button>
    </div>
  );
}

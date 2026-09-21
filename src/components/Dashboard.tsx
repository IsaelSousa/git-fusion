import { browseAndOpen, cloneRepo, openRepo } from "../actions";
import { save, useStore } from "../store";
import { basename, dirname } from "../lib/util";
import { IconClone, IconClose, IconFolderOpen } from "./Icons";

export function Dashboard() {
  const recent = useStore((s) => s.recent);

  const forget = (p: string) => {
    const next = recent.filter((r) => r !== p);
    save("recent", next);
    useStore.setState({ recent: next });
  };

  return (
    <div className="dashboard">
      <div className="dash-card">
        <div className="dash-logo">
          <svg viewBox="0 0 64 64" width="56" height="56" aria-hidden>
            <rect width="64" height="64" rx="14" fill="#151c33" />
            <path d="M21 16v32" stroke="#4dd0e1" strokeWidth="3.5" strokeLinecap="round" />
            <path d="M21 39c0-9 22-3 22-14" stroke="#ff8a65" strokeWidth="3.5" strokeLinecap="round" fill="none" />
            <circle cx="21" cy="16" r="4.5" fill="#4dd0e1" />
            <circle cx="21" cy="48" r="4.5" fill="#4dd0e1" />
            <circle cx="43" cy="25" r="4.5" fill="#ff8a65" />
          </svg>
          <div>
            <h1>GitFusion</h1>
            <p className="muted">O grafo visual do GitKraken com o poder do GitExtensions.</p>
          </div>
        </div>

        <div className="dash-actions">
          <button className="btn btn-primary lg" onClick={browseAndOpen}>
            <IconFolderOpen /> Abrir repositório
          </button>
          <button className="btn lg" onClick={cloneRepo}>
            <IconClone /> Clonar
          </button>
        </div>

        <h2>Repositórios recentes</h2>
        {!recent.length && <div className="muted">Nenhum ainda. Abra ou clone um repositório para começar.</div>}
        <div className="recent-list">
          {recent.map((p) => (
            <div key={p} className="recent-row" onClick={() => openRepo(p)}>
              <div>
                <div className="recent-name">{basename(p)}</div>
                <div className="muted small">{dirname(p)}</div>
              </div>
              <button
                className="icon-btn"
                title="Remover da lista"
                onClick={(e) => {
                  e.stopPropagation();
                  forget(p);
                }}
              >
                <IconClose />
              </button>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}


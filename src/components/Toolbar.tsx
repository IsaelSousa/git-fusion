import { Fragment, type ReactNode, useEffect, useState } from "react";
import {
  clearFilter,
  createBranch,
  fetchAll,
  openRepoFolder,
  pull,
  push,
  refresh,
  setFilter,
  stashPop,
  stashPush,
} from "../actions";
import { ask, mergedToolbarOrder, showMenu, showMenuAt, useStore } from "../store";
import { useExtensions } from "../extensions/registry";
import { IconBranch, IconFetch, IconFilter, IconFolderOpen, IconPop, IconPull, IconPush, IconRefresh, IconSearch, IconStash } from "./Icons";

export function Toolbar() {
  const head = useStore((s) => s.head);
  const stashes = useStore((s) => s.stashes);
  const busy = useStore((s) => s.busy);
  const filter = useStore((s) => s.filter);
  const cfg = useStore((s) => s.toolbar);
  const extItems = useExtensions((s) => s.toolbarItems);
  const [text, setText] = useState(filter.text);

  useEffect(() => setText(filter.text), [filter.text]);
  useEffect(() => {
    if (text === filter.text) return;
    const t = setTimeout(() => setFilter({ text }), 350);
    return () => clearTimeout(t);
  }, [text, filter.text]);

  const dropdown = (e: React.MouseEvent<HTMLButtonElement>, items: Parameters<typeof showMenuAt>[2]) => {
    const r = e.currentTarget.getBoundingClientRect();
    showMenuAt(r.left, r.bottom + 2, items);
  };

  const openFilter = async () => {
    const r = await ask({
      title: "Filtrar histórico",
      okLabel: "Aplicar",
      fields: [
        { name: "author", label: "Autor contém", type: "text", value: filter.author },
        { name: "path", label: "Somente commits que tocam o caminho", type: "text", value: filter.path, placeholder: "src/app.ts" },
        { name: "currentOnly", label: "Apenas o histórico da branch atual", type: "checkbox", value: filter.currentOnly },
      ],
    });
    if (r) await setFilter({ author: String(r.author).trim(), path: String(r.path).trim(), currentOnly: !!r.currentOnly });
  };

  const filtering = !!(filter.text || filter.author || filter.path || filter.currentOnly);
  const label = (t: string) => <span className="tb-label">{t}</span>;

  const items: Record<string, () => ReactNode> = {
    fetch: () => (
      <button className="tb-btn" onClick={fetchAll} disabled={!!busy} title="git fetch --all --prune">
        <IconFetch /> {label("Fetch")}
      </button>
    ),
    pull: () => (
      <span className="tb-group">
        <button className="tb-btn" onClick={() => pull()} disabled={!!busy} title="git pull">
          <IconPull /> {label("Pull")}
          {head.behind > 0 && <span className="pill pill-behind">↓{head.behind}</span>}
        </button>
        <button
          className="tb-btn tb-drop"
          disabled={!!busy}
          title="Opções de pull"
          onClick={(e) =>
            dropdown(e, [
              { label: "Pull (padrão da configuração)", action: () => pull() },
              { label: "Pull --ff-only", action: () => pull("ff-only") },
              { label: "Pull --rebase", action: () => pull("rebase") },
            ])
          }
        >
          ▾
        </button>
      </span>
    ),
    push: () => (
      <span className="tb-group">
        <button className="tb-btn" onClick={() => push()} disabled={!!busy} title="git push">
          <IconPush /> {label("Push")}
          {head.ahead > 0 && <span className="pill pill-ahead">↑{head.ahead}</span>}
        </button>
        <button
          className="tb-btn tb-drop"
          disabled={!!busy}
          title="Opções de push"
          onClick={(e) =>
            dropdown(e, [
              { label: "Push", action: () => push() },
              { label: "Force push (--force-with-lease)", action: () => push({ force: true }), danger: true },
              { separator: true },
              { label: "Push --tags", action: () => push({ tags: true }) },
            ])
          }
        >
          ▾
        </button>
      </span>
    ),
    branch: () => (
      <button className="tb-btn" onClick={() => createBranch()} disabled={!!busy} title="Nova branch">
        <IconBranch /> {label("Branch")}
      </button>
    ),
    stash: () => (
      <button className="tb-btn" onClick={stashPush} disabled={!!busy} title="Guardar alterações (stash)">
        <IconStash /> {label("Stash")}
      </button>
    ),
    pop: () => (
      <button className="tb-btn" onClick={() => stashPop()} disabled={!!busy || !stashes.length} title="Aplicar e remover o último stash">
        <IconPop /> {label("Pop")}
      </button>
    ),
    search: () => (
      <div className="search">
        <IconSearch />
        <input
          value={text}
          placeholder="Buscar mensagens de commit…"
          spellCheck={false}
          onChange={(e) => setText(e.target.value)}
        />
      </div>
    ),
    filter: () => (
      <>
        <button className={`icon-btn${filtering ? " on" : ""}`} title="Filtros do histórico" onClick={openFilter}>
          <IconFilter />
        </button>
        {filtering && (
          <button className="chip-clear" onClick={clearFilter} title="Limpar filtros">
            Limpar filtros ✕
          </button>
        )}
      </>
    ),
    folder: () => (
      <button className="icon-btn" title="Abrir pasta do projeto" onClick={openRepoFolder}>
        <IconFolderOpen />
      </button>
    ),
    refresh: () => (
      <button className="icon-btn" title="Atualizar (F5)" onClick={refresh}>
        <IconRefresh />
      </button>
    ),
    sep1: () => <div className="tb-sep" />,
    sep2: () => <div className="tb-sep" />,
    spacer: () => <div className="tb-spacer" />,
  };
  for (const x of extItems) items[x.id] = () => <x.component />;

  return (
    <div
      className={`toolbar${cfg.labels ? "" : " icons-only"}`}
      onContextMenu={(e) =>
        showMenu(e, [{ label: "Personalizar barra de ferramentas…", action: () => useStore.setState({ customizingToolbar: true }) }])
      }
    >
      {mergedToolbarOrder(
        cfg.order,
        extItems.map((x) => x.id),
      )
        .filter((id) => !cfg.hidden.includes(id) && items[id])
        .map((id) => (
          <Fragment key={id}>{items[id]()}</Fragment>
        ))}
    </div>
  );
}

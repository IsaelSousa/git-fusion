import { Fragment, type ReactNode, useMemo, useState } from "react";
import { save, useStore } from "../store";
import { IconChevronDown, IconChevronRight, IconFolder } from "./Icons";

interface Dir<T> {
  name: string;
  path: string;
  dirs: Dir<T>[];
  files: T[];
  count: number;
}

const byName = (a: string, b: string) => a.localeCompare(b);

function buildDirs<T extends { path: string }>(items: T[]): Dir<T> {
  const root: Dir<T> = { name: "", path: "", dirs: [], files: [], count: 0 };
  for (const it of items) {
    const parts = it.path.split("/");
    let node = root;
    node.count++;
    for (let i = 0; i < parts.length - 1; i++) {
      const path = parts.slice(0, i + 1).join("/");
      let next = node.dirs.find((d) => d.path === path);
      if (!next) node.dirs.push((next = { name: parts[i], path, dirs: [], files: [], count: 0 }));
      next.count++;
      node = next;
    }
    node.files.push(it);
  }
  const finish = (d: Dir<T>) => {
    d.dirs.sort((a, b) => byName(a.name, b.name));
    d.files.sort((a, b) => byName(a.path, b.path));
    d.dirs.forEach((c) => {
      // pastas com um único filho-pasta viram "a/b/c", como nos clientes git visuais
      while (c.files.length === 0 && c.dirs.length === 1) {
        const only = c.dirs[0];
        c.name += "/" + only.name;
        c.path = only.path;
        c.dirs = only.dirs;
        c.files = only.files;
      }
      finish(c);
    });
  };
  finish(root);
  return root;
}

export interface TreeCtx {
  /** nível de indentação da linha (0 = raiz); ausente no modo lista */
  depth: number;
}

interface Props<T> {
  items: T[];
  renderRow: (item: T, tree: TreeCtx | null) => ReactNode;
  folderActions?: (items: T[], dir: string) => ReactNode;
}

function DirNode<T extends { path: string }>({ d, depth, closed, toggle, renderRow, folderActions }: {
  d: Dir<T>;
  depth: number;
  closed: Set<string>;
  toggle: (p: string) => void;
} & Omit<Props<T>, "items">) {
  const isOpen = !closed.has(d.path);
  const all = () => collect(d);
  return (
    <>
      <div className="dir-row" style={{ paddingLeft: 12 + depth * 14 }} onClick={() => toggle(d.path)} title={d.path}>
        {isOpen ? <IconChevronDown className="ico" /> : <IconChevronRight className="ico" />}
        <IconFolder className="ico folder" />
        <span className="dir-name">{d.name}</span>
        <span className="side-count">{d.count}</span>
        {folderActions && <span className="row-actions">{folderActions(all(), d.path)}</span>}
      </div>
      {isOpen && (
        <>
          {d.dirs.map((c) => (
            <DirNode key={c.path} d={c} depth={depth + 1} closed={closed} toggle={toggle} renderRow={renderRow} folderActions={folderActions} />
          ))}
          {d.files.map((f) => (
            <Fragment key={f.path}>{renderRow(f, { depth: depth + 1 })}</Fragment>
          ))}
        </>
      )}
    </>
  );
}

function collect<T>(d: Dir<T>): T[] {
  return [...d.files, ...d.dirs.flatMap(collect)];
}

/** Lista de arquivos alterados no modo escolhido (lista plana ou árvore de pastas). */
export function ChangedFiles<T extends { path: string }>({ items, renderRow, folderActions }: Props<T>) {
  const view = useStore((s) => s.filesView);
  const [closed, setClosed] = useState<Set<string>>(new Set());
  const root = useMemo(() => (view === "tree" ? buildDirs(items) : null), [view, items]);

  const toggle = (p: string) =>
    setClosed((s) => {
      const n = new Set(s);
      n.has(p) ? n.delete(p) : n.add(p);
      return n;
    });

  if (!root) return <div className="file-list">{items.map((f) => <Fragment key={f.path}>{renderRow(f, null)}</Fragment>)}</div>;
  return (
    <div className="file-list">
      {root.dirs.map((d) => (
        <DirNode key={d.path} d={d} depth={0} closed={closed} toggle={toggle} renderRow={renderRow} folderActions={folderActions} />
      ))}
      {root.files.map((f) => <Fragment key={f.path}>{renderRow(f, { depth: 0 })}</Fragment>)}
    </div>
  );
}

/** Alternador Lista/Árvore, compartilhado por todas as listas de arquivos e salvo entre sessões. */
export function FilesViewToggle() {
  const view = useStore((s) => s.filesView);
  const set = (v: "list" | "tree") => {
    save("filesView", v);
    useStore.setState({ filesView: v });
  };
  return (
    <div className="seg" title="Modo de exibição dos arquivos">
      <button className={view === "list" ? "on" : ""} onClick={() => set("list")}>Lista</button>
      <button className={view === "tree" ? "on" : ""} onClick={() => set("tree")}>Árvore</button>
    </div>
  );
}

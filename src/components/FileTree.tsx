import { useEffect, useMemo, useState } from "react";
import { copy, fetchBlame, fetchFileContent, fetchTreePaths, revealCommit, showFileHistory } from "../actions";
import { type TreeNode, buildTree } from "../lib/git/parse";
import { short, shortDate } from "../lib/util";
import { useStore } from "../store";
import type { BlameLine } from "../types";
import { IconChevronDown, IconChevronRight, IconFile, IconFolder } from "./Icons";

const MAX_RENDER = 5000;

function Node({ n, depth, open, toggle, sel, pick }: {
  n: TreeNode;
  depth: number;
  open: Set<string>;
  toggle: (p: string) => void;
  sel: string | null;
  pick: (p: string) => void;
}) {
  const isOpen = open.has(n.path);
  return (
    <>
      <div
        className={`tree-row${sel === n.path ? " selected" : ""}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        onClick={() => (n.dir ? toggle(n.path) : pick(n.path))}
      >
        {n.dir ? isOpen ? <IconChevronDown className="ico" /> : <IconChevronRight className="ico" /> : <span className="ico" />}
        {n.dir ? <IconFolder className="ico folder" /> : <IconFile className="ico" />}
        <span className="ellipsis">{n.name}</span>
      </div>
      {n.dir && isOpen && n.children.map((c) => <Node key={c.path} n={c} depth={depth + 1} open={open} toggle={toggle} sel={sel} pick={pick} />)}
    </>
  );
}

export function FileTree() {
  const active = useStore((s) => s.active)!;
  const selection = useStore((s) => s.selection);
  const head = useStore((s) => s.head);
  const rev = selection?.type === "commit" ? selection.hash : head.hash;

  const [paths, setPaths] = useState<string[] | null>(null);
  const [q, setQ] = useState("");
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [file, setFile] = useState<string | null>(null);
  const [content, setContent] = useState<{ text: string; truncated: boolean } | null>(null);
  const [blame, setBlame] = useState<BlameLine[] | null>(null);
  const [showBlame, setShowBlame] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setPaths(null);
    setFile(null);
    setContent(null);
    setBlame(null);
    if (!rev) return;
    let live = true;
    fetchTreePaths(active, rev).then((p) => live && setPaths(p), (e) => live && setError(String(e.message ?? e)));
    return () => {
      live = false;
    };
  }, [active, rev]);

  useEffect(() => {
    if (!file || !rev) return;
    let live = true;
    setContent(null);
    setBlame(null);
    setError(null);
    fetchFileContent(active, rev, file).then((c) => live && setContent(c), (e) => live && setError(String(e.message ?? e)));
    return () => {
      live = false;
    };
  }, [active, rev, file]);

  useEffect(() => {
    if (!showBlame || !file || !rev || blame) return;
    let live = true;
    fetchBlame(active, rev, file).then((b) => live && setBlame(b), (e) => live && setError(String(e.message ?? e)));
    return () => {
      live = false;
    };
  }, [showBlame, file, rev, active, blame]);

  const filtered = useMemo(() => {
    if (!paths) return null;
    return q ? paths.filter((p) => p.toLowerCase().includes(q.toLowerCase())) : paths;
  }, [paths, q]);
  const tree = useMemo(() => (filtered ? buildTree(filtered) : null), [filtered]);
  const openSet = useMemo(() => {
    if (!q || !filtered) return open;
    // ao filtrar, expande todas as pastas dos resultados
    const s = new Set(open);
    for (const p of filtered.slice(0, 500)) {
      const parts = p.split("/");
      for (let i = 1; i < parts.length; i++) s.add(parts.slice(0, i).join("/"));
    }
    return s;
  }, [q, filtered, open]);

  if (!rev) return <div className="empty">Este repositório ainda não tem commits.</div>;

  const toggle = (p: string) =>
    setOpen((s) => {
      const n = new Set(s);
      n.has(p) ? n.delete(p) : n.add(p);
      return n;
    });

  const lines = content?.text.split("\n") ?? [];

  return (
    <div className="ftree">
      <div className="ftree-left">
        <div className="ftree-search">
          <input placeholder="Filtrar arquivos…" value={q} spellCheck={false} onChange={(e) => setQ(e.target.value)} />
          <span className="muted small">@ {short(rev)}</span>
        </div>
        <div className="ftree-list">
          {!paths && !error && <div className="muted pad">Carregando…</div>}
          {tree?.children.map((c) => <Node key={c.path} n={c} depth={0} open={openSet} toggle={toggle} sel={file} pick={setFile} />)}
        </div>
      </div>
      <div className="ftree-right">
        {!file ? (
          <div className="empty">Selecione um arquivo para visualizar.</div>
        ) : (
          <>
            <div className="diff-bar">
              <span className="diff-title"><b>{file}</b></span>
              <span className="grow-fill" />
              <button className="btn xs" onClick={() => showFileHistory(file)}>Histórico</button>
              <button className="btn xs" onClick={() => copy(file, "Caminho copiado")}>Copiar caminho</button>
              <div className="seg">
                <button className={!showBlame ? "on" : ""} onClick={() => setShowBlame(false)}>Conteúdo</button>
                <button className={showBlame ? "on" : ""} onClick={() => setShowBlame(true)}>Blame</button>
              </div>
            </div>
            <div className="code-scroll">
              {error && <div className="error-text pad">{error}</div>}
              {!content && !error && <div className="muted pad">Carregando…</div>}
              {content && !showBlame && (
                <div className="code">
                  {lines.slice(0, MAX_RENDER).map((l, i) => (
                    <div key={i} className="dl dl-ctx">
                      <span className="dno">{i + 1}</span>
                      <span className="dtxt">{l || " "}</span>
                    </div>
                  ))}
                  {lines.length > MAX_RENDER && <div className="muted pad">… {lines.length - MAX_RENDER} linhas ocultas</div>}
                </div>
              )}
              {content && showBlame && !blame && !error && <div className="muted pad">Calculando blame…</div>}
              {content && showBlame && blame && (
                <div className="code">
                  {blame.slice(0, MAX_RENDER).map((b, i) => {
                    const first = i === 0 || blame[i - 1].hash !== b.hash;
                    return (
                      <div key={i} className={`dl dl-ctx blame${first ? " first" : ""}`}>
                        <span className="bl-meta" title={first ? b.summary : ""}>
                          {first && (
                            <>
                              <button className="link-btn mono" onClick={() => revealCommit(b.hash)}>{short(b.hash)}</button>
                              <span className="ellipsis">{b.author}</span>
                              <span className="muted">{shortDate(b.time)}</span>
                            </>
                          )}
                        </span>
                        <span className="dno">{b.lineNo}</span>
                        <span className="dtxt">{b.text || " "}</span>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

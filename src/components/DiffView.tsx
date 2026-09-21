import { Fragment, useEffect, useMemo, useState } from "react";
import { applyPatch, copy, fetchDiff, showFileHistory } from "../actions";
import { type PatchMode, buildPatch } from "../lib/git/patch";
import { basename, short } from "../lib/util";
import { confirmDialog, load, save, useStore } from "../store";
import type { DiffLine, FileDiff, FileSelection, Hunk } from "../types";

type ViewMode = "inline" | "split";
const MAX_LINES = 4000;

function editableMode(sel: FileSelection): PatchMode | null {
  if (sel.source === "staged") return "unstage";
  if (sel.source === "unstaged" && !sel.untracked && !sel.conflicted) return "stage";
  return null;
}

/** Alinha remoções/adições consecutivas lado a lado. */
function pairLines(lines: DiffLine[]): { l?: [DiffLine, number]; r?: [DiffLine, number] }[] {
  const out: { l?: [DiffLine, number]; r?: [DiffLine, number] }[] = [];
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (ln.type === " ") {
      out.push({ l: [ln, i], r: [ln, i] });
      i++;
    } else if (ln.type === "\\") {
      i++;
    } else {
      const dels: [DiffLine, number][] = [];
      const adds: [DiffLine, number][] = [];
      while (i < lines.length && (lines[i].type === "-" || lines[i].type === "+")) {
        (lines[i].type === "-" ? dels : adds).push([lines[i], i]);
        i++;
      }
      const n = Math.max(dels.length, adds.length);
      for (let k = 0; k < n; k++) out.push({ l: dels[k], r: adds[k] });
    }
  }
  return out;
}

export function DiffView({ sel }: { sel: FileSelection }) {
  const active = useStore((s) => s.active)!;
  const tick = useStore((s) => s.tick);
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [mode, setMode] = useState<ViewMode>(() => load<ViewMode>("diffMode", "inline"));
  const [picked, setPicked] = useState<Record<number, Set<number>>>({});
  const [expanded, setExpanded] = useState(false);

  const key = JSON.stringify(sel);
  useEffect(() => {
    let live = true;
    setError(null);
    fetchDiff(active, sel).then(
      (d) => {
        if (!live) return;
        setDiff(d);
        setPicked({});
      },
      (e) => live && (setError(String(e.message ?? e)), setDiff(null)),
    );
    return () => {
      live = false;
    };
    // `tick` recarrega após stage/commit/refresh
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, key, tick]);

  useEffect(() => setExpanded(false), [key]);

  const patchMode = editableMode(sel);
  const totalLines = useMemo(() => diff?.hunks.reduce((n, h) => n + h.lines.length, 0) ?? 0, [diff]);
  const truncated = !expanded && totalLines > MAX_LINES;

  const setViewMode = (m: ViewMode) => {
    save("diffMode", m);
    setMode(m);
  };

  const toggleLine = (h: number, i: number) =>
    setPicked((p) => {
      const cur = new Set(p[h] ?? []);
      cur.has(i) ? cur.delete(i) : cur.add(i);
      return { ...p, [h]: cur };
    });

  const apply = async (h: number, lines: Set<number> | null, kind: PatchMode) => {
    if (!diff) return;
    const patch = buildPatch(diff, h, lines, kind);
    if (!patch) return;
    if (kind === "discard") {
      const what = lines ? `${lines.size} linha(s) selecionada(s)` : "este bloco";
      if (!(await confirmDialog("Descartar alterações", `Descartar ${what}? Isso não pode ser desfeito.`, { okLabel: "Descartar", danger: true })))
        return;
    }
    await applyPatch(patch, kind);
  };

  const title = sel.path;
  const sourceLabel =
    sel.source === "commit" ? `commit ${short(sel.hash)}` : sel.source === "staged" ? "staged" : sel.untracked ? "novo arquivo" : sel.conflicted ? "conflito" : "working tree";

  const renderHunk = (h: Hunk, hi: number, budget: { left: number }) => {
    const chosen = picked[hi];
    const nChosen = chosen?.size ?? 0;
    const verb = patchMode === "unstage" ? "Unstage" : "Stage";

    const lineCell = (ln: DiffLine, idx: number) => {
      const changeable = !!patchMode && (ln.type === "+" || ln.type === "-");
      const on = chosen?.has(idx);
      return (
        <span
          className={`dgut${changeable ? " pick" : ""}${on ? " on" : ""}`}
          onClick={changeable ? () => toggleLine(hi, idx) : undefined}
          title={changeable ? "Selecionar linha" : undefined}
        >
          {changeable ? (on ? "☑" : "☐") : ""}
        </span>
      );
    };

    let body: React.ReactNode;
    if (mode === "inline") {
      body = h.lines.map((ln, idx) => {
        if (budget.left-- <= 0) return null;
        if (ln.type === "\\") return <div key={idx} className="dl dl-meta"><span className="dgut" /><span className="dno" /><span className="dno" /><span className="dtxt">\{ln.text}</span></div>;
        return (
          <div key={idx} className={`dl dl-${ln.type === "+" ? "add" : ln.type === "-" ? "del" : "ctx"}${chosen?.has(idx) ? " picked" : ""}`}>
            {lineCell(ln, idx)}
            <span className="dno">{ln.oldNo ?? ""}</span>
            <span className="dno">{ln.newNo ?? ""}</span>
            <span className="dsign">{ln.type}</span>
            <span className="dtxt">{ln.text || " "}</span>
          </div>
        );
      });
    } else {
      body = pairLines(h.lines).map((p, k) => {
        if (budget.left-- <= 0) return null;
        const cell = (side: "l" | "r") => {
          const e = p[side];
          if (!e) return <div className="dsplit-cell empty" />;
          const [ln, idx] = e;
          return (
            <div className={`dsplit-cell dl-${ln.type === "+" ? "add" : ln.type === "-" ? "del" : "ctx"}${chosen?.has(idx) ? " picked" : ""}`}>
              {lineCell(ln, idx)}
              <span className="dno">{side === "l" ? ln.oldNo : ln.newNo}</span>
              <span className="dtxt">{ln.text || " "}</span>
            </div>
          );
        };
        return (
          <div key={k} className="dsplit">
            {cell("l")}
            {cell("r")}
          </div>
        );
      });
    }

    return (
      <Fragment key={hi}>
        <div className="dhunk">
          <span className="mono ellipsis">{h.header}</span>
          {patchMode && (
            <span className="dhunk-actions">
              {nChosen > 0 ? (
                <>
                  <button className="btn xs" onClick={() => apply(hi, chosen!, patchMode)}>
                    {verb} {nChosen} linha{nChosen > 1 ? "s" : ""}
                  </button>
                  {patchMode === "stage" && (
                    <button className="btn xs danger" onClick={() => apply(hi, chosen!, "discard")}>
                      Descartar linhas
                    </button>
                  )}
                  <button className="btn xs" onClick={() => setPicked((p) => ({ ...p, [hi]: new Set() }))}>
                    Limpar
                  </button>
                </>
              ) : (
                <>
                  <button className="btn xs" onClick={() => apply(hi, null, patchMode)}>
                    {verb} bloco
                  </button>
                  {patchMode === "stage" && (
                    <button className="btn xs danger" onClick={() => apply(hi, null, "discard")}>
                      Descartar bloco
                    </button>
                  )}
                </>
              )}
            </span>
          )}
        </div>
        <div className={mode === "split" ? "dbody split" : "dbody"}>{body}</div>
      </Fragment>
    );
  };

  const budget = { left: truncated ? MAX_LINES : Infinity };

  return (
    <div className="diff">
      <div className="diff-bar">
        <span className="diff-title" title={title}>
          <b>{basename(title)}</b> <span className="muted">{title.includes("/") ? title : ""}</span>
        </span>
        <span className="pill">{sourceLabel}</span>
        <span className="grow-fill" />
        <button className="btn xs" onClick={() => showFileHistory(sel.path)}>Histórico</button>
        <button className="btn xs" onClick={() => copy(sel.path, "Caminho copiado")}>Copiar caminho</button>
        <div className="seg">
          <button className={mode === "inline" ? "on" : ""} onClick={() => setViewMode("inline")}>Unificado</button>
          <button className={mode === "split" ? "on" : ""} onClick={() => setViewMode("split")}>Lado a lado</button>
        </div>
      </div>
      <div className="diff-scroll">
        {error && <div className="error-text pad">{error}</div>}
        {!error && !diff && <div className="muted pad">Carregando diff…</div>}
        {diff && diff.binary && <div className="muted pad">Arquivo binário — sem pré-visualização.</div>}
        {diff && !diff.binary && diff.combined && <pre className="raw">{diff.raw}</pre>}
        {diff && !diff.binary && !diff.combined && diff.hunks.length === 0 && (
          <div className="muted pad">
            {diff.header.some((l) => l.startsWith("rename") || l.startsWith("new mode") || l.startsWith("old mode"))
              ? diff.header.join("\n")
              : "Sem diferenças de conteúdo."}
          </div>
        )}
        {diff && !diff.binary && !diff.combined && sel.source === "unstaged" && sel.untracked && (
          <div className="note">Arquivo novo — use Stage para adicioná-lo por inteiro.</div>
        )}
        {diff && !diff.binary && !diff.combined && diff.hunks.map((h, i) => renderHunk(h, i, budget))}
        {truncated && (
          <div className="pad">
            <button className="btn" onClick={() => setExpanded(true)}>
              Mostrar tudo ({totalLines} linhas)
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

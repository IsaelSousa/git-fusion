import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import {
  checkoutBranch,
  checkoutCommit,
  cherryPick,
  copy,
  createBranch,
  createTag,
  loadMore,
  mergeInto,
  rebaseOnto,
  resetTo,
  revertCommit,
  selectCommit,
  selectWip,
  stageAll,
  stashPush,
} from "../actions";
import { WIP_HASH, showMenu, useStore } from "../store";
import { branchMenuItems } from "./branchMenu";
import type { Commit, RefLabel } from "../types";
import type { GraphRow, Segment } from "../lib/git/graph";
import { hueOf, initials, short, shortDate, timeAgo, fullDate } from "../lib/util";

export const ROW_H = 30;
const LANE_W = 16;
const PAD = 14;

const xOf = (i: number) => PAD + i * LANE_W;

function segPath(s: Segment): string {
  const x1 = xOf(s.x1);
  const x2 = xOf(s.x2);
  const y1 = s.y1 * ROW_H;
  const y2 = s.y2 * ROW_H;
  if (x1 === x2) return `M${x1} ${y1}L${x2} ${y2}`;
  const ym = (y1 + y2) / 2;
  return `M${x1} ${y1}C${x1} ${ym} ${x2} ${ym} ${x2} ${y2}`;
}

const GraphCell = memo(function GraphCell(p: { row: GraphRow; width: number; wip: boolean; head: boolean }) {
  const { row } = p;
  const cx = xOf(row.col);
  const cy = ROW_H / 2;
  const color = `var(--lane-${row.color})`;
  return (
    <svg className="gcell" width={p.width} height={ROW_H}>
      {row.segments.map((s, i) => (
        <path
          key={i}
          d={segPath(s)}
          fill="none"
          stroke={`var(--lane-${s.color})`}
          strokeWidth={2}
          strokeDasharray={p.wip && s.y1 === 0.5 ? "3 3" : undefined}
        />
      ))}
      {p.head && !p.wip && <circle cx={cx} cy={cy} r={8} fill="none" stroke={color} strokeWidth={1.5} opacity={0.55} />}
      {p.wip ? (
        <circle cx={cx} cy={cy} r={5} fill="var(--bg)" stroke={color} strokeWidth={2} strokeDasharray="2.5 2" />
      ) : row.merge ? (
        <circle cx={cx} cy={cy} r={4.5} fill="var(--bg)" stroke={color} strokeWidth={2.5} />
      ) : (
        <circle cx={cx} cy={cy} r={5} fill={color} stroke="var(--bg)" strokeWidth={1.5} />
      )}
    </svg>
  );
});

/** Botão direito num chip de branch abre o menu da branch (Checkout, Merge, …). */
function Chip({ r }: { r: RefLabel }) {
  const onContext = (e: React.MouseEvent) => {
    if (r.kind !== "local" && r.kind !== "remote") return; // tags/HEAD: menu do commit
    const st = useStore.getState();
    const b = r.kind === "local" ? st.local.find((x) => x.name === r.name) : st.remote.find((x) => x.display === r.name);
    if (!b) return;
    e.stopPropagation(); // não abre também o menu do commit
    showMenu(e, branchMenuItems(b));
  };
  return (
    <span className={`chip chip-${r.kind}${r.current ? " current" : ""}`} onContextMenu={onContext}>
      {r.kind === "tag" ? `🏷 ${r.name}` : r.name}
    </span>
  );
}

interface RowProps {
  c: Commit;
  row: GraphRow;
  index: number;
  gw: number;
  selected: boolean;
  isHead: boolean;
  wipCount: number;
}

const Row = memo(function Row({ c, row, index, gw, selected, isHead, wipCount }: RowProps) {
  const wip = c.hash === WIP_HASH;

  const onContext = (e: React.MouseEvent) => {
    if (wip) {
      selectWip();
      return showMenu(e, [
        { label: "Stage de tudo", action: stageAll },
        { label: "Guardar em stash…", action: stashPush },
      ]);
    }
    selectCommit(c.hash);
    const state = useStore.getState();
    const head = state.head.branch ?? "HEAD";
    const branchItems = c.refs
      .filter((r) => r.kind === "local" && !r.current)
      .map((r) => ({
        label: `Checkout ${r.name}`,
        action: () => {
          const b = state.local.find((b) => b.name === r.name);
          if (b) checkoutBranch(b);
        },
      }));
    showMenu(e, [
      ...branchItems,
      { label: "Checkout deste commit (HEAD destacado)", action: () => checkoutCommit(c.hash), disabled: isHead && !state.head.branch },
      { separator: true },
      { label: "Nova branch aqui…", action: () => createBranch(c.hash) },
      { label: "Nova tag aqui…", action: () => createTag(c.hash) },
      { separator: true },
      { label: "Cherry-pick", action: () => cherryPick(c), disabled: isHead },
      { label: "Reverter commit", action: () => revertCommit(c) },
      { label: `Reset de ${head} para aqui…`, action: () => resetTo(c.hash), disabled: isHead },
      { label: `Merge deste commit em ${head}`, action: () => mergeInto(c.hash, short(c.hash)), disabled: isHead },
      { label: `Rebase de ${head} sobre este commit`, action: () => rebaseOnto(c.hash, short(c.hash)), disabled: isHead },
      { separator: true },
      { label: "Copiar SHA", action: () => copy(c.hash, "SHA copiado") },
      { label: "Copiar mensagem", action: () => copy(c.subject, "Mensagem copiada") },
    ]);
  };

  return (
    <div
      className={`grow${selected ? " selected" : ""}${wip ? " wip" : ""}`}
      style={{ top: index * ROW_H, gridTemplateColumns: `${gw}px 1fr var(--col-author) var(--col-date) var(--col-sha)` }}
      onClick={() => selectCommit(c.hash)}
      onContextMenu={onContext}
    >
      <GraphCell row={row} width={gw} wip={wip} head={isHead} />
      <div className="gmsg">
        {c.refs.map((r) => (
          <Chip key={r.kind + r.name} r={r} />
        ))}
        {wip ? (
          <span className="wip-text">
            Alterações não commitadas <span className="pill pill-mod">{wipCount}</span>
          </span>
        ) : (
          <span className="subject" title={c.subject}>
            {c.subject}
          </span>
        )}
      </div>
      <div className="gauthor" title={c.email ? `${c.author} <${c.email}>` : ""}>
        {!wip && (
          <>
            <span className="avatar" style={{ background: `hsl(${hueOf(c.email || c.author)} 45% 38%)` }}>
              {initials(c.author)}
            </span>
            <span className="ellipsis">{c.author}</span>
          </>
        )}
      </div>
      <div className="gdate" title={wip ? "" : fullDate(c.date)}>
        {wip ? "" : Date.now() / 1000 - c.date < 86400 * 14 ? timeAgo(c.date) : shortDate(c.date)}
      </div>
      <div className="gsha mono">{wip ? "" : short(c.hash)}</div>
    </div>
  );
});

export function CommitGraph() {
  const commits = useStore((s) => s.commits);
  const graph = useStore((s) => s.graph);
  const selection = useStore((s) => s.selection);
  const head = useStore((s) => s.head);
  const hasMore = useStore((s) => s.hasMore);
  const files = useStore((s) => s.files);
  const reveal = useStore((s) => s.reveal);
  const filter = useStore((s) => s.filter);
  const loading = useStore((s) => s.loading);

  const scroller = useRef<HTMLDivElement>(null);
  const [view, setView] = useState({ top: 0, h: 600 });

  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const update = () => setView({ top: el.scrollTop, h: el.clientHeight });
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const selectedHash = selection?.type === "wip" ? WIP_HASH : selection?.type === "commit" ? selection.hash : null;
  const selectedIndex = selectedHash ? commits.findIndex((c) => c.hash === selectedHash) : -1;

  useEffect(() => {
    if (!reveal) return;
    const idx = commits.findIndex((c) => c.hash === reveal.hash);
    const el = scroller.current;
    if (idx >= 0 && el) el.scrollTop = Math.max(0, idx * ROW_H - el.clientHeight / 2 + ROW_H);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reveal]);

  const scrollIntoView = (idx: number) => {
    const el = scroller.current;
    if (!el) return;
    const top = idx * ROW_H;
    if (top < el.scrollTop) el.scrollTop = top;
    else if (top + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = top + ROW_H - el.clientHeight;
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
    e.preventDefault();
    const next = Math.min(commits.length - 1, Math.max(0, (selectedIndex < 0 ? 0 : selectedIndex) + (e.key === "ArrowDown" ? 1 : -1)));
    if (commits[next]) {
      selectCommit(commits[next].hash);
      scrollIntoView(next);
    }
  };

  const noGraph = !!(filter.text || filter.author || filter.path);
  const gw = noGraph ? 14 : Math.min(280, Math.max(56, graph.lanes * LANE_W + PAD * 2));
  const start = Math.max(0, Math.floor(view.top / ROW_H) - 6);
  const end = Math.min(commits.length, Math.ceil((view.top + view.h) / ROW_H) + 6);

  const rows = [];
  for (let i = start; i < end; i++) {
    const c = commits[i];
    rows.push(
      <Row
        key={c.hash}
        c={c}
        row={graph.rows[i]}
        index={i}
        gw={gw}
        selected={c.hash === selectedHash}
        isHead={c.hash === head.hash}
        wipCount={files.length}
      />,
    );
  }

  return (
    <div className="graph" tabIndex={0} onKeyDown={onKeyDown}>
      <div
        className="ghead"
        style={{ gridTemplateColumns: `${gw}px 1fr var(--col-author) var(--col-date) var(--col-sha)` }}
      >
        <div>{noGraph ? "" : "Grafo"}</div>
        <div>Descrição</div>
        <div>Autor</div>
        <div>Data</div>
        <div>SHA</div>
      </div>
      <div
        className="gscroll"
        ref={scroller}
        onScroll={(e) => {
          const t = e.currentTarget.scrollTop;
          requestAnimationFrame(() => setView((v) => (v.top === t ? v : { ...v, top: t })));
        }}
      >
        <div className="gspacer" style={{ height: commits.length * ROW_H }}>
          {rows}
        </div>
        {hasMore && (
          <div className="gmore">
            <button className="btn" onClick={loadMore} disabled={loading}>
              Carregar mais commits
            </button>
          </div>
        )}
        {!commits.length && !loading && (
          <div className="empty">
            {noGraph ? "Nenhum commit corresponde aos filtros." : "Este repositório ainda não tem commits."}
          </div>
        )}
      </div>
    </div>
  );
}

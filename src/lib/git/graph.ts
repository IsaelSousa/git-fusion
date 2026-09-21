import type { Commit } from "../../types";

/** Segmento vertical dentro de uma linha do grafo; y ∈ {0 (topo), .5 (nó), 1 (base)}. */
export interface Segment {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  color: number;
}

export interface GraphRow {
  col: number;
  color: number;
  segments: Segment[];
  merge: boolean;
}

export interface GraphLayout {
  rows: GraphRow[];
  /** Quantidade máxima de colunas (lanes) usadas. */
  lanes: number;
}

export const PALETTE_SIZE = 8;

/**
 * Atribui colunas ("lanes") aos commits. A entrada deve estar em ordem
 * topológica (filhos antes dos pais), como em `git log --topo-order`.
 */
export function layoutGraph(commits: Pick<Commit, "hash" | "parents">[]): GraphLayout {
  const lanes: (string | null)[] = [];
  const colors: number[] = [];
  let nextColor = 0;
  let maxLanes = 1;
  const rows: GraphRow[] = [];

  const freeLane = (): number => {
    const i = lanes.indexOf(null);
    if (i >= 0) return i;
    lanes.push(null);
    colors.push(0);
    return lanes.length - 1;
  };

  for (const c of commits) {
    const incoming: number[] = [];
    lanes.forEach((h, i) => {
      if (h === c.hash) incoming.push(i);
    });

    let col: number;
    let color: number;
    if (incoming.length) {
      col = incoming[0];
      color = colors[col];
    } else {
      col = freeLane();
      color = nextColor++ % PALETTE_SIZE;
      colors[col] = color;
    }

    const segments: Segment[] = [];
    lanes.forEach((h, i) => {
      if (h !== null && h !== c.hash) segments.push({ x1: i, y1: 0, x2: i, y2: 1, color: colors[i] });
    });
    for (const i of incoming) segments.push({ x1: i, y1: 0, x2: col, y2: 0.5, color: colors[i] });
    for (const i of incoming) lanes[i] = null;

    c.parents.forEach((p, idx) => {
      let target = lanes.indexOf(p);
      if (idx === 0 && (target === -1 || target > col)) {
        // A linha do 1º pai continua na coluna do próprio commit. Se outra lane
        // à direita já espera esse pai, as duas ficam e convergem quando ele
        // chegar — assim a linha principal não migra para a direita.
        target = col;
        lanes[col] = p;
        colors[col] = color;
      } else if (target === -1) {
        target = freeLane();
        lanes[target] = p;
        colors[target] = nextColor++ % PALETTE_SIZE;
      }
      segments.push({ x1: col, y1: 0.5, x2: target, y2: 1, color: colors[target] });
    });

    while (lanes.length && lanes[lanes.length - 1] === null) {
      lanes.pop();
      colors.pop();
    }

    let used = Math.max(col + 1, lanes.length);
    for (const s of segments) used = Math.max(used, s.x1 + 1, s.x2 + 1);
    maxLanes = Math.max(maxLanes, used);
    rows.push({ col, color, segments, merge: c.parents.length > 1 });
  }

  return { rows, lanes: maxLanes };
}

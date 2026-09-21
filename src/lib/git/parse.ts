import type {
  BlameLine,
  Branch,
  Commit,
  CommitFile,
  DiffLine,
  FileDiff,
  FileEntry,
  HeadInfo,
  Hunk,
  RefLabel,
  Stash,
  Submodule,
  TagRef,
} from "../../types";

/* ------------------------------------------------------------------ log */

export const LOG_FORMAT = "%H%x00%P%x00%an%x00%ae%x00%at%x00%D%x00%s%x1e";

export function parseDecorations(raw: string): RefLabel[] {
  const out: RefLabel[] = [];
  if (!raw.trim()) return out;
  for (const part of raw.split(", ")) {
    const p = part.trim();
    if (!p) continue;
    if (p === "refs/stash" || p === "stash") continue;
    if (p.startsWith("HEAD -> ")) {
      out.push({ kind: "local", name: stripRef(p.slice(8)), current: true });
    } else if (p === "HEAD") {
      out.push({ kind: "head", name: "HEAD", current: true });
    } else if (p.startsWith("tag: ")) {
      out.push({ kind: "tag", name: stripRef(p.slice(5)) });
    } else if (p.startsWith("refs/remotes/")) {
      const name = p.slice("refs/remotes/".length);
      if (name.endsWith("/HEAD")) continue;
      out.push({ kind: "remote", name });
    } else if (p.startsWith("refs/heads/")) {
      out.push({ kind: "local", name: p.slice("refs/heads/".length) });
    } else if (p.startsWith("refs/tags/")) {
      out.push({ kind: "tag", name: p.slice("refs/tags/".length) });
    }
    // Qualquer outro (ex.: refs/pull/…, refs/notes/…) é ignorado de propósito.
  }
  // HEAD/branch atual primeiro, depois locais, remotos, tags.
  const rank = (r: RefLabel) => (r.current ? 0 : r.kind === "local" ? 1 : r.kind === "remote" ? 2 : 3);
  return out.sort((a, b) => rank(a) - rank(b));
}

function stripRef(s: string): string {
  return s.replace(/^refs\/(heads|tags)\//, "");
}

export function parseLog(out: string): Commit[] {
  const commits: Commit[] = [];
  for (const rec of out.split("\x1e")) {
    const r = rec.replace(/^\n+/, "");
    if (!r) continue;
    const f = r.split("\x00");
    if (f.length < 7) continue;
    commits.push({
      hash: f[0],
      parents: f[1] ? f[1].split(" ") : [],
      author: f[2],
      email: f[3],
      date: Number(f[4]),
      refs: parseDecorations(f[5]),
      subject: f.slice(6).join("\x00"),
    });
  }
  return commits;
}

/* ----------------------------------------------------------------- refs */

export const REFS_FORMAT =
  "%(refname)%00%(objectname)%00%(*objectname)%00%(upstream:short)%00%(upstream:track)%00%(HEAD)";

export function parseTrack(track: string): { ahead: number; behind: number; gone: boolean } {
  const ahead = /ahead (\d+)/.exec(track);
  const behind = /behind (\d+)/.exec(track);
  return { ahead: ahead ? +ahead[1] : 0, behind: behind ? +behind[1] : 0, gone: track.includes("gone") };
}

export function parseRefs(out: string): { local: Branch[]; remote: Branch[]; tags: TagRef[] } {
  const local: Branch[] = [];
  const remote: Branch[] = [];
  const tags: TagRef[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [refname, oid, deref, upstream, track, head] = line.split("\x00");
    if (refname.startsWith("refs/heads/")) {
      const name = refname.slice(11);
      local.push({
        name,
        display: name,
        hash: oid,
        upstream: upstream || undefined,
        ...parseTrack(track ?? ""),
        current: head === "*",
      });
    } else if (refname.startsWith("refs/remotes/")) {
      const rest = refname.slice(13);
      if (rest.endsWith("/HEAD")) continue;
      const slash = rest.indexOf("/");
      remote.push({
        name: rest.slice(slash + 1),
        display: rest,
        remote: rest.slice(0, slash),
        hash: oid,
        ahead: 0,
        behind: 0,
        gone: false,
        current: false,
      });
    } else if (refname.startsWith("refs/tags/")) {
      tags.push({ name: refname.slice(10), hash: deref || oid, annotated: !!deref });
    }
  }
  return { local, remote, tags };
}

/* --------------------------------------------------------------- status */

export function parseStatus(out: string): { head: HeadInfo; files: FileEntry[] } {
  const head: HeadInfo = { hash: null, branch: null, detached: false, ahead: 0, behind: 0 };
  const files: FileEntry[] = [];
  const tokens = out.split("\0");
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (!t) continue;
    if (t.startsWith("# ")) {
      const [, key, ...rest] = t.split(" ");
      const val = rest.join(" ");
      if (key === "branch.oid") head.hash = val === "(initial)" ? null : val;
      else if (key === "branch.head") {
        head.detached = val === "(detached)";
        head.branch = head.detached ? null : val;
      } else if (key === "branch.upstream") head.upstream = val;
      else if (key === "branch.ab") {
        const m = /\+(\d+) -(\d+)/.exec(val);
        if (m) {
          head.ahead = +m[1];
          head.behind = +m[2];
        }
      }
    } else if (t.startsWith("1 ")) {
      const p = t.split(" ");
      files.push({
        path: p.slice(8).join(" "),
        index: p[1][0],
        worktree: p[1][1],
        conflicted: false,
        untracked: false,
      });
    } else if (t.startsWith("2 ")) {
      const p = t.split(" ");
      files.push({
        path: p.slice(9).join(" "),
        origPath: tokens[++i],
        index: p[1][0],
        worktree: p[1][1],
        conflicted: false,
        untracked: false,
      });
    } else if (t.startsWith("u ")) {
      const p = t.split(" ");
      files.push({
        path: p.slice(10).join(" "),
        index: p[1][0],
        worktree: p[1][1],
        conflicted: true,
        untracked: false,
      });
    } else if (t.startsWith("? ")) {
      files.push({ path: t.slice(2), index: ".", worktree: "?", conflicted: false, untracked: true });
    }
  }
  return { head, files };
}

export const isStaged = (f: FileEntry) => !f.conflicted && !f.untracked && f.index !== ".";
export const isUnstaged = (f: FileEntry) => !f.conflicted && (f.untracked || f.worktree !== ".");

/* ---------------------------------------------------- stash / submodule */

export const STASH_FORMAT = "%gd%x00%H%x00%at%x00%s";

export function parseStashes(out: string): Stash[] {
  const res: Stash[] = [];
  for (const line of out.split("\n")) {
    if (!line) continue;
    const [ref, hash, at, ...msg] = line.split("\x00");
    const m = /\{(\d+)\}/.exec(ref);
    res.push({ index: m ? +m[1] : res.length, ref, hash, date: Number(at), message: msg.join("\x00") });
  }
  return res;
}

export function parseSubmodules(out: string): Submodule[] {
  const res: Submodule[] = [];
  for (const line of out.split("\n")) {
    const m = /^([ +\-U])([0-9a-f]+) (.+?)(?: \((.*)\))?$/.exec(line);
    if (!m) continue;
    const state = m[1] === "-" ? "uninitialized" : m[1] === "+" ? "modified" : m[1] === "U" ? "conflict" : "ok";
    res.push({ state, hash: m[2], path: m[3], describe: m[4] });
  }
  return res;
}

/* --------------------------------------------------- lista de arquivos */

/** Parseia `--name-status -z` (com `-M`): `M\0path\0` ou `R100\0old\0new\0`. */
export function parseNameStatus(out: string): CommitFile[] {
  const t = out.split("\0");
  const files: CommitFile[] = [];
  for (let i = 0; i < t.length; i++) {
    const st = t[i];
    if (!st) continue;
    const code = st[0];
    if (code === "R" || code === "C") {
      files.push({ status: code, oldPath: t[i + 1], path: t[i + 2] });
      i += 2;
    } else {
      files.push({ status: code, path: t[i + 1] });
      i += 1;
    }
  }
  return files;
}

/* ----------------------------------------------------------------- diff */

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

export function parseDiff(text: string): FileDiff {
  const lines = text.split("\n");
  if (lines.length && lines[lines.length - 1] === "") lines.pop();

  const diff: FileDiff = { header: [], hunks: [], binary: false, combined: false, raw: text };
  let cur: Hunk | null = null;
  let oldNo = 0;
  let newNo = 0;

  for (const line of lines) {
    if (line.startsWith("@@@")) {
      diff.combined = true;
      break;
    }
    const m = HUNK_RE.exec(line);
    if (m) {
      cur = {
        header: line,
        context: m[5] ?? "",
        oldStart: +m[1],
        oldLines: m[2] === undefined ? 1 : +m[2],
        newStart: +m[3],
        newLines: m[4] === undefined ? 1 : +m[4],
        lines: [],
      };
      oldNo = cur.oldStart;
      newNo = cur.newStart;
      diff.hunks.push(cur);
      continue;
    }
    if (!cur) {
      if (line.startsWith("Binary files ") || line.startsWith("GIT binary patch")) diff.binary = true;
      // `diff --cc` / `diff --combined` indicam conflito
      if (line.startsWith("diff --cc") || line.startsWith("diff --combined")) diff.combined = true;
      diff.header.push(line);
      continue;
    }
    const type = line[0] as DiffLine["type"] | undefined;
    if (type === "+") cur.lines.push({ type, text: line.slice(1), newNo: newNo++ });
    else if (type === "-") cur.lines.push({ type, text: line.slice(1), oldNo: oldNo++ });
    else if (type === "\\") cur.lines.push({ type, text: line.slice(1) });
    else if (type === " " || type === undefined)
      cur.lines.push({ type: " ", text: line.slice(1), oldNo: oldNo++, newNo: newNo++ });
    // outras linhas (ex.: início do próximo `diff --git`) são ignoradas
  }
  return diff;
}

/* ---------------------------------------------------------------- blame */

export function parseBlame(out: string): BlameLine[] {
  const meta = new Map<string, { author: string; time: number; summary: string }>();
  const res: BlameLine[] = [];
  const lines = out.split("\n");
  let i = 0;
  while (i < lines.length) {
    const head = /^([0-9a-f]{40,64}) \d+ (\d+)(?: \d+)?$/.exec(lines[i]);
    if (!head) {
      i++;
      continue;
    }
    const hash = head[1];
    const lineNo = +head[2];
    i++;
    let m = meta.get(hash);
    if (!m) {
      m = { author: "", time: 0, summary: "" };
      meta.set(hash, m);
    }
    while (i < lines.length && !lines[i].startsWith("\t")) {
      const l = lines[i];
      if (l.startsWith("author ")) m.author = l.slice(7);
      else if (l.startsWith("author-time ")) m.time = +l.slice(12);
      else if (l.startsWith("summary ")) m.summary = l.slice(8);
      i++;
    }
    const text = i < lines.length ? lines[i].slice(1) : "";
    i++;
    res.push({ lineNo, hash, author: m.author, time: m.time, summary: m.summary, text });
  }
  return res;
}

/* ------------------------------------------------------------ file tree */

export interface TreeNode {
  name: string;
  path: string;
  dir: boolean;
  children: TreeNode[];
}

export function buildTree(paths: string[]): TreeNode {
  const root: TreeNode = { name: "", path: "", dir: true, children: [] };
  for (const p of paths) {
    const parts = p.split("/");
    let node = root;
    for (let i = 0; i < parts.length; i++) {
      const isDir = i < parts.length - 1;
      let child = node.children.find((c) => c.name === parts[i] && c.dir === isDir);
      if (!child) {
        child = { name: parts[i], path: parts.slice(0, i + 1).join("/"), dir: isDir, children: [] };
        node.children.push(child);
      }
      node = child;
    }
  }
  const sort = (n: TreeNode) => {
    n.children.sort((a, b) => (a.dir === b.dir ? a.name.localeCompare(b.name) : a.dir ? -1 : 1));
    n.children.forEach(sort);
  };
  sort(root);
  return root;
}

import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { layoutGraph } from "../src/lib/git/graph";
import { buildPatch, patchArgs } from "../src/lib/git/patch";
import {
  buildTree,
  parseBlame,
  parseDiff,
  parseLog,
  parseNameStatus,
  parseRefs,
  parseStashes,
  parseStatus,
  parseSubmodules,
  parseTrack,
} from "../src/lib/git/parse";
import {
  DEFAULT_FILTER,
  REFS_ARGS,
  STASH_ARGS,
  STATUS_ARGS,
  commitDiffArgs,
  commitFilesArgs,
  logArgs,
  untrackedDiffArgs,
  worktreeDiffArgs,
} from "../src/lib/git/queries";
import { tokenize } from "../src/lib/git/runner";

let dir: string;

const g = (args: string[], input?: string, cwd = dir): string =>
  execFileSync("git", ["--literal-pathspecs", ...args], {
    cwd,
    input,
    encoding: "utf8",
    env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true", GIT_MERGE_AUTOEDIT: "no" },
  });
const write = (name: string, content: string) => writeFileSync(join(dir, name), content);
const commit = (msg: string) => g(["commit", "-q", "-m", msg]);

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), "gitfusion-"));
  g(["init", "-q", "-b", "main"]);
  g(["config", "user.name", "Tester"]);
  g(["config", "user.email", "t@example.com"]);
  g(["config", "commit.gpgsign", "false"]);
  write("a.txt", "one\ntwo\nthree\n");
  g(["add", "."]);
  commit("first commit");
  g(["switch", "-q", "-c", "feature/x"]);
  write("b.txt", "feature\n");
  g(["add", "."]);
  commit("feature work");
  g(["switch", "-q", "main"]);
  write("a.txt", "one\ntwo\nthree\nfour\n");
  g(["add", "."]);
  commit("main work");
  g(["merge", "-q", "--no-ff", "feature/x", "-m", "Merge feature/x"]);
  g(["tag", "v1.0"]);
  g(["tag", "-a", "v1.1", "-m", "annotated"]);
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe("log + decorations + grafo", () => {
  it("parseia commits e decorações completas", () => {
    const commits = parseLog(g(logArgs(DEFAULT_FILTER, 100)));
    // Os commits do teste saem no mesmo segundo: a ordem entre os dois ramos não é fixa.
    expect(commits.map((c) => c.subject).sort()).toEqual(["Merge feature/x", "feature work", "first commit", "main work"]);
    expect(commits[0].subject).toBe("Merge feature/x");
    expect(commits[3].subject).toBe("first commit");
    const merge = commits[0];
    expect(merge.parents).toHaveLength(2);
    expect(merge.author).toBe("Tester");
    const names = merge.refs.map((r) => `${r.kind}:${r.name}`);
    expect(names).toContain("local:main");
    expect(names).toContain("tag:v1.0");
    expect(names).toContain("tag:v1.1");
    expect(merge.refs[0]).toMatchObject({ name: "main", current: true });
    expect(commits.find((c) => c.subject === "feature work")!.refs.map((r) => r.name)).toContain("feature/x");
  });

  it("layoutGraph produz 2 lanes para o merge e volta a 1", () => {
    const commits = parseLog(g(logArgs(DEFAULT_FILTER, 100)));
    const { rows, lanes } = layoutGraph(commits);
    expect(lanes).toBe(2);
    expect(rows).toHaveLength(4);
    expect(rows[0].merge).toBe(true);
    // A linha principal fica na coluna 0 e o commit raiz não deixa lanes penduradas
    expect(rows[3].col).toBe(0);
    expect(rows[3].segments.filter((s) => s.y2 === 1)).toHaveLength(0);
  });

  it("filtro de texto e de caminho", () => {
    const byText = parseLog(g(logArgs({ ...DEFAULT_FILTER, text: "FEATURE" }, 100)));
    expect(byText.map((c) => c.subject)).toContain("feature work");
    const byPath = parseLog(g(logArgs({ ...DEFAULT_FILTER, path: "b.txt" }, 100)));
    expect(byPath.map((c) => c.subject)).toEqual(["feature work"]);
  });
});

describe("layoutGraph (sintético)", () => {
  it("histórico linear fica em uma coluna", () => {
    const { rows, lanes } = layoutGraph([
      { hash: "c", parents: ["b"] },
      { hash: "b", parents: ["a"] },
      { hash: "a", parents: [] },
    ]);
    expect(lanes).toBe(1);
    expect(rows.every((r) => r.col === 0)).toBe(true);
  });

  it("tip de branch cujo pai já está numa lane à esquerda converge direto", () => {
    const { rows, lanes } = layoutGraph([
      { hash: "x", parents: ["base"] },
      { hash: "y", parents: ["base"] },
      { hash: "base", parents: [] },
    ]);
    expect(lanes).toBe(2);
    expect(rows[0].col).toBe(0);
    expect(rows[1].col).toBe(1);
    expect(rows[1].segments).toContainEqual(expect.objectContaining({ x1: 1, y1: 0.5, x2: 0, y2: 1 }));
    expect(rows[2].col).toBe(0);
  });

  it("linha principal não migra para a direita quando a branch lateral vem primeiro", () => {
    const { rows } = layoutGraph([
      { hash: "M", parents: ["main", "feat"] },
      { hash: "feat", parents: ["base"] },
      { hash: "main", parents: ["base"] },
      { hash: "base", parents: [] },
    ]);
    expect(rows.map((r) => r.col)).toEqual([0, 1, 0, 0]);
    // `base` recebe as duas lanes (0 e 1) convergindo
    const incoming = rows[3].segments.filter((s) => s.y1 === 0 && s.y2 === 0.5);
    expect(incoming.map((s) => s.x1).sort()).toEqual([0, 1]);
  });

  it("pai fora da janela mantém a lane até o fim", () => {
    const { rows } = layoutGraph([{ hash: "c", parents: ["missing"] }]);
    expect(rows[0].segments.some((s) => s.y2 === 1 && s.x2 === 0)).toBe(true);
  });
});

describe("refs, stash e submódulos", () => {
  it("parseRefs separa locais, remotos e tags (anotada deferenciada)", () => {
    const { local, tags, remote } = parseRefs(g(REFS_ARGS));
    expect(local.map((b) => b.name).sort()).toEqual(["feature/x", "main"]);
    expect(local.find((b) => b.current)?.name).toBe("main");
    expect(remote).toHaveLength(0);
    const head = g(["rev-parse", "HEAD"]).trim();
    expect(tags.find((t) => t.name === "v1.1")).toMatchObject({ annotated: true, hash: head });
    expect(tags.find((t) => t.name === "v1.0")).toMatchObject({ annotated: false, hash: head });
  });

  it("parseTrack", () => {
    expect(parseTrack("[ahead 2, behind 1]")).toEqual({ ahead: 2, behind: 1, gone: false });
    expect(parseTrack("[gone]")).toMatchObject({ gone: true });
    expect(parseTrack("")).toEqual({ ahead: 0, behind: 0, gone: false });
  });

  it("parseSubmodules", () => {
    const out = " 1234abcd libs/foo (heads/main)\n-99999999 libs/bar\n+aaaaaaaa libs/baz (v1-2-gaaaa)\n";
    expect(parseSubmodules(out).map((s) => [s.path, s.state])).toEqual([
      ["libs/foo", "ok"],
      ["libs/bar", "uninitialized"],
      ["libs/baz", "modified"],
    ]);
  });
});

describe("status, diff e staging parcial", () => {
  it("parseStatus cobre modificado, não rastreado, renomeado e nomes com espaço", () => {
    write("a.txt", "one\nTWO\nthree\nfour\n");
    write("new file.txt", "hi\n");
    g(["mv", "b.txt", "renamed b.txt"]);
    const { head, files } = parseStatus(g(STATUS_ARGS));
    expect(head).toMatchObject({ branch: "main", detached: false });
    expect(head.hash).toMatch(/^[0-9a-f]{40}/);
    const by = Object.fromEntries(files.map((f) => [f.path, f]));
    expect(by["a.txt"]).toMatchObject({ index: ".", worktree: "M" });
    expect(by["new file.txt"]).toMatchObject({ untracked: true });
    expect(by["renamed b.txt"]).toMatchObject({ index: "R", origPath: "b.txt" });
    g(["mv", "renamed b.txt", "b.txt"]);
    rmSync(join(dir, "new file.txt"));
    g(["checkout", "--", "a.txt"]);
  });

  it("diff de commit (merge e raiz) e lista de arquivos", () => {
    const hashOf = (subject: string) => g(["log", "--all", "--format=%H", `--grep=^${subject}$`]).trim();
    const mergeHash = hashOf("Merge feature/x");
    const featureHash = hashOf("feature work");
    const rootHash = hashOf("first commit");
    const mergeFiles = parseNameStatus(g(commitFilesArgs(mergeHash, true)));
    expect(mergeFiles).toEqual([{ status: "A", path: "b.txt" }]);
    expect(parseNameStatus(g(commitFilesArgs(rootHash, false)))).toEqual([{ status: "A", path: "a.txt" }]);
    const d = parseDiff(g(commitDiffArgs(rootHash, false, "a.txt")));
    expect(d.hunks[0].lines.filter((l) => l.type === "+")).toHaveLength(3);
    const d2 = parseDiff(g(commitDiffArgs(featureHash, true, "b.txt")));
    expect(d2.hunks[0].lines[0]).toMatchObject({ type: "+", text: "feature", newNo: 1 });
  });

  it("diff de não rastreado usa --no-index (exit 1 é normal)", () => {
    write("u.txt", "x\ny\n");
    let out = "";
    try {
      g(untrackedDiffArgs("u.txt"));
    } catch (e) {
      out = (e as { stdout: string }).stdout;
    }
    const d = parseDiff(out);
    expect(d.hunks[0].lines.map((l) => l.text)).toEqual(["x", "y"]);
    rmSync(join(dir, "u.txt"));
  });

  it("staging por linhas: só as linhas escolhidas vão para o índice", () => {
    write("s.txt", "1\n2\n3\n4\n5\n6\n7\n8\n");
    g(["add", "s.txt"]);
    commit("add s");
    write("s.txt", "1\nTWO\n3\n4\n5\n6\nSEVEN\n8\nNINE\n");
    const diff = parseDiff(g(worktreeDiffArgs("s.txt", false)));
    expect(diff.hunks).toHaveLength(1);
    const lines = diff.hunks[0].lines;
    // escolhe apenas a troca 2→TWO
    const pick = new Set<number>();
    lines.forEach((l, i) => {
      if ((l.type === "-" && l.text === "2") || (l.type === "+" && l.text === "TWO")) pick.add(i);
    });
    const patch = buildPatch(diff, 0, pick, "stage");
    expect(patch).not.toBeNull();
    g(patchArgs("stage"), patch!);
    const staged = g(["diff", "--cached", "--", "s.txt"]);
    expect(staged).toContain("+TWO");
    expect(staged).toContain("-2");
    expect(staged).not.toContain("SEVEN");
    expect(staged).not.toContain("NINE");
    // o worktree continua com tudo
    const rest = g(["diff", "--", "s.txt"]);
    expect(rest).toContain("+SEVEN");
    expect(rest).toContain("+NINE");
    expect(rest).not.toContain("+TWO");

    // unstage só da linha TWO (via diff --cached)
    const cached = parseDiff(g(worktreeDiffArgs("s.txt", true)));
    const un = buildPatch(cached, 0, null, "unstage");
    g(patchArgs("unstage"), un!);
    expect(g(["diff", "--cached", "--", "s.txt"])).toBe("");

    // stage do hunk inteiro e descarte parcial no worktree
    const all = parseDiff(g(worktreeDiffArgs("s.txt", false)));
    const discardNine = new Set<number>();
    all.hunks[0].lines.forEach((l, i) => {
      if (l.type === "+" && l.text === "NINE") discardNine.add(i);
    });
    g(patchArgs("discard"), buildPatch(all, 0, discardNine, "discard")!);
    const after = g(["diff", "--", "s.txt"]);
    expect(after).not.toContain("NINE");
    expect(after).toContain("+SEVEN");
    expect(after).toContain("+TWO");
    g(["checkout", "--", "s.txt"]);
  });

  it("buildPatch retorna null sem seleção", () => {
    write("s.txt", "1\n2\nX\n4\n5\n6\n7\n8\n");
    const diff = parseDiff(g(worktreeDiffArgs("s.txt", false)));
    expect(buildPatch(diff, 0, new Set(), "stage")).toBeNull();
    g(["checkout", "--", "s.txt"]);
  });
});

describe("stash, blame, tree, tokenize", () => {
  it("stash list e blame", () => {
    write("a.txt", "changed\n");
    g(["stash", "push", "-q", "-m", "meu stash"]);
    const stashes = parseStashes(g(STASH_ARGS));
    expect(stashes).toHaveLength(1);
    expect(stashes[0]).toMatchObject({ index: 0, ref: "stash@{0}" });
    expect(stashes[0].message).toContain("meu stash");
    // refs/stash não aparece no grafo
    const commits = parseLog(g(logArgs(DEFAULT_FILTER, 100)));
    expect(commits.some((c) => c.subject.includes("meu stash"))).toBe(false);
    g(["stash", "drop", "-q"]);

    const blame = parseBlame(g(["blame", "--porcelain", "HEAD", "--", "a.txt"]));
    expect(blame.map((b) => b.text)).toEqual(["one", "two", "three", "four"]);
    expect(blame[0].author).toBe("Tester");
    expect(blame[3].summary).toBe("main work");
  });

  it("buildTree ordena pastas primeiro", () => {
    const t = buildTree(["z.txt", "src/b.ts", "src/a.ts", "docs/x.md"]);
    expect(t.children.map((c) => c.name)).toEqual(["docs", "src", "z.txt"]);
    expect(t.children[1].children.map((c) => c.name)).toEqual(["a.ts", "b.ts"]);
  });

  it("tokenize", () => {
    expect(tokenize(`commit -m "hello world" --amend 'a b'`)).toEqual(["commit", "-m", "hello world", "--amend", "a b"]);
    expect(tokenize(`log --format=%H\\ %s`)).toEqual(["log", "--format=%H %s"]);
    expect(tokenize(`tag ""`)).toEqual(["tag", ""]);
  });
});

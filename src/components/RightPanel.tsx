import { useEffect, useState } from "react";
import {
  checkoutCommit,
  cherryPick,
  commit,
  copy,
  createBranch,
  createTag,
  discardAllUnstaged,
  discardFiles,
  fetchCommitDetail,
  fetchCommitFiles,
  markResolved,
  resolveConflict,
  revealCommit,
  revertCommit,
  selectFile,
  showFileHistory,
  stageAll,
  stagePaths,
  toggleAmend,
  unstageAll,
  unstagePaths,
  type CommitDetail,
} from "../actions";
import { isStaged, isUnstaged } from "../lib/git/parse";
import { STATUS_LABEL, fullDate, hueOf, initials, short, statusClass } from "../lib/util";
import { WIP_HASH, showMenu, useStore } from "../store";
import type { CommitFile, FileEntry, RefLabel } from "../types";
import { ChangedFiles, FilesViewToggle, type TreeCtx } from "./ChangedFiles";
import { IconMinus, IconPlus, IconUndo } from "./Icons";

const splitPath = (p: string) => {
  const i = p.lastIndexOf("/");
  return i < 0 ? { dir: "", name: p } : { dir: p.slice(0, i + 1), name: p.slice(i + 1) };
};

function StatusBadge({ code }: { code: string }) {
  const c = code === "." ? "M" : code;
  return (
    <span className={`badge ${statusClass(c)}`} title={STATUS_LABEL[c] ?? c}>
      {c}
    </span>
  );
}

/** recuo das linhas de arquivo na árvore: nível da pasta + espaço do chevron */
const treeIndent = (tree: TreeCtx | null | undefined) => (tree ? { paddingLeft: 12 + tree.depth * 14 + 20 } : undefined);

function PathLabel({ path, old, tree }: { path: string; old?: string; tree?: boolean }) {
  const { dir, name } = splitPath(path);
  return (
    <span className="path" title={old ? `${old} → ${path}` : path}>
      <span className="path-name">{name}</span>
      {dir && !tree && <span className="path-dir">{dir}</span>}
      {old && <span className="path-dir"> ← {old}</span>}
    </span>
  );
}

/* ================================================================ commit */

function CommitDetails({ hash }: { hash: string }) {
  const active = useStore((s) => s.active)!;
  const commits = useStore((s) => s.commits);
  const fileSel = useStore((s) => s.fileSel);
  const c = commits.find((x) => x.hash === hash);
  const [detail, setDetail] = useState<CommitDetail | null>(null);
  const [files, setFiles] = useState<CommitFile[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAll, setShowAll] = useState(false);
  const isRoot = !!c && c.parents.length === 0;

  useEffect(() => {
    let live = true;
    setDetail(null);
    setFiles(null);
    setError(null);
    setShowAll(false);
    fetchCommitDetail(active, hash).then((d) => live && setDetail(d), (e) => live && setError(String(e.message ?? e)));
    fetchCommitFiles(active, hash, isRoot).then((f) => live && setFiles(f), (e) => live && setError(String(e.message ?? e)));
    return () => {
      live = false;
    };
  }, [active, hash, isRoot]);

  if (!c) return <div className="empty">Commit fora do histórico carregado.</div>;
  const [subject, ...rest] = (detail?.body ?? c.subject).split("\n");
  const body = rest.join("\n").trim();
  const shown = files && !showAll ? files.slice(0, 400) : files;

  return (
    <div className="panel-scroll">
      <div className="cd-head">
        <div className="cd-subject">{subject}</div>
        {body && <pre className="cd-body">{body}</pre>}
        {c.refs.length > 0 && (
          <div className="cd-refs">
            {c.refs.map((r: RefLabel) => (
              <span key={r.kind + r.name} className={`chip chip-${r.kind}${r.current ? " current" : ""}`}>
                {r.name}
              </span>
            ))}
          </div>
        )}
      </div>

      <div className="cd-meta">
        <div className="cd-author">
          <span className="avatar lg" style={{ background: `hsl(${hueOf(c.email || c.author)} 45% 38%)` }}>
            {initials(c.author)}
          </span>
          <div>
            <div className="cd-name">{c.author}</div>
            <div className="muted small">
              {c.email} · {fullDate(c.date)}
            </div>
            {detail && detail.committer !== c.author && (
              <div className="muted small">
                commit por {detail.committer} · {fullDate(detail.committerDate)}
              </div>
            )}
          </div>
        </div>
        <div className="cd-kv">
          <span className="muted">SHA</span>
          <button className="link-btn mono" title="Copiar SHA completo" onClick={() => copy(c.hash, "SHA copiado")}>
            {c.hash}
          </button>
          {c.parents.length > 0 && (
            <>
              <span className="muted">{c.parents.length > 1 ? "Pais" : "Pai"}</span>
              <span>
                {c.parents.map((p) => (
                  <button key={p} className="link-btn mono" onClick={() => revealCommit(p)}>
                    {short(p)}
                  </button>
                ))}
              </span>
            </>
          )}
        </div>
        <div className="cd-actions">
          <button className="btn" onClick={() => checkoutCommit(c.hash)}>Checkout</button>
          <button className="btn" onClick={() => createBranch(c.hash)}>Branch</button>
          <button className="btn" onClick={() => createTag(c.hash)}>Tag</button>
          <button className="btn" onClick={() => cherryPick(c)}>Cherry-pick</button>
          <button className="btn" onClick={() => revertCommit(c)}>Revert</button>
        </div>
      </div>

      <div className="section-title">
        Arquivos alterados {files && <span className="side-count">{files.length}</span>}
        {c.parents.length > 1 && <span className="muted small"> (em relação ao 1º pai)</span>}
        <span className="grow-fill" />
        <FilesViewToggle />
      </div>
      {error && <div className="error-text">{error}</div>}
      {!files && !error && <div className="muted pad">Carregando…</div>}
      {shown && !shown.length && <div className="muted pad">Nenhum arquivo alterado.</div>}
      {shown && (
        <ChangedFiles
          items={shown}
          renderRow={(f, tree) => {
            const selected = fileSel?.source === "commit" && fileSel.hash === hash && fileSel.path === f.path;
            return (
              <div
                className={`file-row${selected ? " selected" : ""}`}
                style={treeIndent(tree)}
                onClick={() => selectFile({ source: "commit", hash, path: f.path, oldPath: f.oldPath, root: isRoot })}
                onContextMenu={(e) =>
                  showMenu(e, [
                    { label: "Histórico do arquivo", action: () => showFileHistory(f.path) },
                    { label: "Copiar caminho", action: () => copy(f.path, "Caminho copiado") },
                  ])
                }
              >
                <StatusBadge code={f.status} />
                <PathLabel path={f.path} old={f.oldPath} tree={!!tree} />
              </div>
            );
          }}
        />
      )}
      {files && shown && shown.length < files.length && (
        <button className="btn wide" onClick={() => setShowAll(true)}>
          Mostrar todos os {files.length} arquivos
        </button>
      )}
    </div>
  );
}

/* ================================================================== WIP */

function WipRow({ f, staged, tree }: { f: FileEntry; staged: boolean; tree: TreeCtx | null }) {
  const fileSel = useStore((s) => s.fileSel);
  const code = staged ? f.index : f.untracked ? "?" : f.conflicted ? "U" : f.worktree;
  const selected = !!fileSel && fileSel.source !== "commit" && fileSel.path === f.path && (fileSel.source === "staged") === staged;

  const select = () =>
    selectFile(
      staged
        ? { source: "staged", path: f.path }
        : { source: "unstaged", path: f.path, untracked: f.untracked, conflicted: f.conflicted },
    );

  return (
    <div
      className={`file-row${selected ? " selected" : ""}`}
      style={treeIndent(tree)}
      onClick={select}
      onDoubleClick={() => (staged ? unstagePaths([f]) : stagePaths([f.path]))}
      onContextMenu={(e) =>
        showMenu(e, [
          staged
            ? { label: "Unstage", action: () => unstagePaths([f]) }
            : { label: "Stage", action: () => stagePaths([f.path]) },
          ...(!staged ? [{ label: "Descartar alterações…", action: () => discardFiles([f]), danger: true }] : []),
          { separator: true },
          { label: "Histórico do arquivo", action: () => showFileHistory(f.path) },
          { label: "Copiar caminho", action: () => copy(f.path, "Caminho copiado") },
        ])
      }
    >
      <StatusBadge code={code} />
      <PathLabel path={f.path} old={staged ? f.origPath : undefined} tree={!!tree} />
      <span className="row-actions">
        {!staged && (
          <button
            className="icon-btn danger"
            title="Descartar alterações"
            onClick={(e) => {
              e.stopPropagation();
              discardFiles([f]);
            }}
          >
            <IconUndo />
          </button>
        )}
        <button
          className="icon-btn"
          title={staged ? "Unstage" : "Stage"}
          onClick={(e) => {
            e.stopPropagation();
            staged ? unstagePaths([f]) : stagePaths([f.path]);
          }}
        >
          {staged ? <IconMinus /> : <IconPlus />}
        </button>
      </span>
    </div>
  );
}

function ConflictRow({ f, tree }: { f: FileEntry; tree: TreeCtx | null }) {
  const fileSel = useStore((s) => s.fileSel);
  const selected = fileSel?.source === "unstaged" && fileSel.path === f.path;
  return (
    <div
      className={`file-row conflict${selected ? " selected" : ""}`}
      style={treeIndent(tree)}
      onClick={() => selectFile({ source: "unstaged", path: f.path, untracked: false, conflicted: true })}
    >
      <StatusBadge code="U" />
      <PathLabel path={f.path} tree={!!tree} />
      <span className="row-actions always">
        <button className="btn xs" title="Manter a versão da branch atual" onClick={(e) => (e.stopPropagation(), resolveConflict(f.path, "ours"))}>
          Minha
        </button>
        <button className="btn xs" title="Usar a versão que está sendo mesclada" onClick={(e) => (e.stopPropagation(), resolveConflict(f.path, "theirs"))}>
          Deles
        </button>
        <button className="btn xs" title="Marcar como resolvido (git add)" onClick={(e) => (e.stopPropagation(), markResolved(f.path))}>
          Resolvido
        </button>
      </span>
    </div>
  );
}

function StagingPanel() {
  const files = useStore((s) => s.files);
  const head = useStore((s) => s.head);
  const msg = useStore((s) => s.commitMsg);
  const amend = useStore((s) => s.amend);
  const busy = useStore((s) => s.busy);
  const operation = useStore((s) => s.operation);

  const conflicts = files.filter((f) => f.conflicted);
  const unstaged = files.filter(isUnstaged);
  const staged = files.filter(isStaged);
  const canCommit = !!msg.trim() && (staged.length > 0 || amend || operation === "merge") && !busy;

  const [subject] = msg.split("\n");

  return (
    <div className="staging">
      <div className="staging-lists">
        {!files.length && <div className="empty">Working tree limpo ✓</div>}
        {files.length > 0 && (
          <div className="view-bar">
            <FilesViewToggle />
          </div>
        )}

        {conflicts.length > 0 && (
          <>
            <div className="section-title warn">
              Conflitos <span className="side-count">{conflicts.length}</span>
            </div>
            <ChangedFiles items={conflicts} renderRow={(f, tree) => <ConflictRow f={f} tree={tree} />} />
          </>
        )}

        {unstaged.length > 0 && (
          <>
            <div className="section-title">
              Não staged <span className="side-count">{unstaged.length}</span>
              <span className="grow-fill" />
              <button className="btn xs" onClick={discardAllUnstaged}>Descartar tudo</button>
              <button className="btn xs" onClick={stageAll}>Stage tudo</button>
            </div>
            <ChangedFiles
              items={unstaged}
              renderRow={(f, tree) => <WipRow f={f} staged={false} tree={tree} />}
              folderActions={(fs, dir) => (
                <>
                  <button className="icon-btn danger" title={`Descartar alterações em ${dir}/`} onClick={(e) => (e.stopPropagation(), discardFiles(fs))}>
                    <IconUndo />
                  </button>
                  <button className="icon-btn" title={`Stage ${dir}/`} onClick={(e) => (e.stopPropagation(), stagePaths(fs.map((f) => f.path)))}>
                    <IconPlus />
                  </button>
                </>
              )}
            />
          </>
        )}

        {staged.length > 0 && (
          <>
            <div className="section-title">
              Staged <span className="side-count">{staged.length}</span>
              <span className="grow-fill" />
              <button className="btn xs" onClick={unstageAll}>Unstage tudo</button>
            </div>
            <ChangedFiles
              items={staged}
              renderRow={(f, tree) => <WipRow f={f} staged tree={tree} />}
              folderActions={(fs, dir) => (
                <button className="icon-btn" title={`Unstage ${dir}/`} onClick={(e) => (e.stopPropagation(), unstagePaths(fs))}>
                  <IconMinus />
                </button>
              )}
            />
          </>
        )}
      </div>

      <div className="commit-box">
        <div className="commit-target muted small">
          {amend ? "Alterar o último commit" : "Commit"} em <b>{head.branch ?? "HEAD destacado"}</b>
        </div>
        <textarea
          value={msg}
          placeholder="Mensagem do commit (Ctrl+Enter para commitar)"
          spellCheck
          onChange={(e) => useStore.setState({ commitMsg: e.target.value })}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && canCommit) {
              e.preventDefault();
              commit();
            }
          }}
        />
        <div className={`muted small counter${subject.length > 72 ? " over" : ""}`}>{subject.length}/72</div>
        <div className="commit-row">
          <label className="check-inline">
            <input type="checkbox" checked={amend} onChange={(e) => toggleAmend(e.target.checked)} /> Amend
          </label>
          <button className="btn btn-primary grow-fill" disabled={!canCommit} onClick={commit}>
            {amend ? "Alterar commit" : `Commit${staged.length ? ` (${staged.length})` : ""}`}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ================================================================ painel */

export function RightPanel() {
  const selection = useStore((s) => s.selection);
  if (!selection) return <div className="empty">Selecione um commit.</div>;
  if (selection.type === "wip") return <StagingPanel />;
  return <CommitDetails hash={selection.hash} />;
}

export { WIP_HASH };

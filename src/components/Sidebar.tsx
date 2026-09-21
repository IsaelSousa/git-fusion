import { type ReactNode, useState } from "react";
import {
  checkoutBranch,
  checkoutTag,
  copy,
  createBranch,
  deleteTag,
  pushTag,
  revealCommit,
  stashApply,
  stashDrop,
  stashPop,
  updateSubmodules,
} from "../actions";
import { load, save, showMenu, useStore } from "../store";
import { branchMenuItems } from "./branchMenu";
import type { Branch, TagRef } from "../types";
import { short } from "../lib/util";
import { IconBranch, IconChevronDown, IconChevronRight, IconCheck, IconCloud, IconLayers, IconSearch, IconStash, IconTag } from "./Icons";

function Section(props: { id: string; title: string; count: number; children: ReactNode; action?: ReactNode }) {
  const [open, setOpen] = useState(() => load<boolean>("sec." + props.id, true));
  const toggle = () => {
    save("sec." + props.id, !open);
    setOpen(!open);
  };
  return (
    <section className="side-sec">
      <header className="side-head" onClick={toggle}>
        {open ? <IconChevronDown /> : <IconChevronRight />}
        <span className="side-title">{props.title}</span>
        <span className="side-count">{props.count}</span>
        {props.action}
      </header>
      {open && <div className="side-body">{props.children}</div>}
    </section>
  );
}

export function Sidebar() {
  const local = useStore((s) => s.local);
  const remote = useStore((s) => s.remote);
  const tags = useStore((s) => s.tags);
  const stashes = useStore((s) => s.stashes);
  const submodules = useStore((s) => s.submodules);
  const [q, setQ] = useState("");
  const [closedRemotes, setClosedRemotes] = useState<Set<string>>(new Set());

  const match = (s: string) => !q || s.toLowerCase().includes(q.toLowerCase());

  const branchMenu = (b: Branch) => (e: React.MouseEvent) => showMenu(e, branchMenuItems(b));

  const tagMenu = (t: TagRef) => (e: React.MouseEvent) =>
    showMenu(e, [
      { label: "Checkout (HEAD destacado)", action: () => checkoutTag(t) },
      { label: "Nova branch a partir daqui…", action: () => createBranch(`refs/tags/${t.name}`) },
      { separator: true },
      { label: "Enviar para origin", action: () => pushTag(t) },
      { label: "Copiar nome", action: () => copy(t.name, "Nome copiado") },
      { label: "Excluir…", action: () => deleteTag(t), danger: true },
    ]);

  const remoteGroups = new Map<string, Branch[]>();
  for (const b of remote.filter((b) => match(b.display))) {
    const list = remoteGroups.get(b.remote!) ?? [];
    list.push(b);
    remoteGroups.set(b.remote!, list);
  }

  const localShown = local.filter((b) => match(b.name));
  const tagsShown = tags.filter((t) => match(t.name));

  return (
    <aside className="sidebar">
      <div className="side-search">
        <IconSearch />
        <input placeholder="Filtrar branches e tags" value={q} spellCheck={false} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="side-scroll">
        <Section id="local" title="Local" count={local.length}>
          {localShown.map((b) => (
            <div
              key={b.name}
              className={`side-item${b.current ? " current" : ""}`}
              title={b.upstream ? `${b.name} → ${b.upstream}${b.gone ? " (removida no remote)" : ""}` : b.name}
              onClick={() => revealCommit(b.hash)}
              onDoubleClick={() => checkoutBranch(b)}
              onContextMenu={branchMenu(b)}
            >
              {b.current ? <IconCheck className="ico ok" /> : <IconBranch className="ico" />}
              <span className="side-label">{b.name}</span>
              {b.gone && <span className="pill pill-gone">removida</span>}
              {b.ahead > 0 && <span className="pill pill-ahead">↑{b.ahead}</span>}
              {b.behind > 0 && <span className="pill pill-behind">↓{b.behind}</span>}
            </div>
          ))}
        </Section>

        <Section id="remote" title="Remoto" count={remote.length}>
          {[...remoteGroups.entries()].map(([name, list]) => {
            const closed = closedRemotes.has(name) && !q;
            return (
              <div key={name}>
                <div
                  className="side-item group"
                  onClick={() =>
                    setClosedRemotes((s) => {
                      const n = new Set(s);
                      n.has(name) ? n.delete(name) : n.add(name);
                      return n;
                    })
                  }
                >
                  {closed ? <IconChevronRight className="ico" /> : <IconChevronDown className="ico" />}
                  <IconCloud className="ico" />
                  <span className="side-label">{name}</span>
                  <span className="side-count">{list.length}</span>
                </div>
                {!closed &&
                  list.map((b) => (
                    <div
                      key={b.display}
                      className="side-item nested"
                      title={b.display}
                      onClick={() => revealCommit(b.hash)}
                      onDoubleClick={() => checkoutBranch(b)}
                      onContextMenu={branchMenu(b)}
                    >
                      <IconBranch className="ico" />
                      <span className="side-label">{b.name}</span>
                    </div>
                  ))}
              </div>
            );
          })}
        </Section>

        <Section id="tags" title="Tags" count={tags.length}>
          {tagsShown.map((t) => (
            <div
              key={t.name}
              className="side-item"
              title={t.annotated ? `${t.name} (anotada)` : t.name}
              onClick={() => revealCommit(t.hash)}
              onDoubleClick={() => checkoutTag(t)}
              onContextMenu={tagMenu(t)}
            >
              <IconTag className="ico tag" />
              <span className="side-label">{t.name}</span>
            </div>
          ))}
        </Section>

        <Section id="stashes" title="Stashes" count={stashes.length}>
          {stashes.map((s) => (
            <div
              key={s.ref}
              className="side-item"
              title={`${s.ref}: ${s.message}`}
              onDoubleClick={() => stashApply(s.ref)}
              onContextMenu={(e) =>
                showMenu(e, [
                  { label: "Aplicar", action: () => stashApply(s.ref) },
                  { label: "Aplicar e remover (pop)", action: () => stashPop(s.ref) },
                  { separator: true },
                  { label: "Excluir…", action: () => stashDrop(s.ref), danger: true },
                ])
              }
            >
              <IconStash className="ico" />
              <span className="side-label">{s.message.replace(/^(WIP on|On) [^:]+: /, "") || s.ref}</span>
              <span className="side-count">{s.ref.replace("stash@", "")}</span>
            </div>
          ))}
        </Section>

        <Section
          id="subs"
          title="Submódulos"
          count={submodules.length}
          action={
            submodules.length ? (
              <button
                className="link-btn"
                onClick={(e) => {
                  e.stopPropagation();
                  updateSubmodules();
                }}
              >
                atualizar
              </button>
            ) : null
          }
        >
          {submodules.map((s) => (
            <div key={s.path} className="side-item" title={`${s.path} @ ${short(s.hash)}`}>
              <IconLayers className="ico" />
              <span className="side-label">{s.path}</span>
              {s.state !== "ok" && <span className={`pill pill-${s.state === "modified" ? "ahead" : "gone"}`}>{s.state === "uninitialized" ? "não iniciado" : s.state === "modified" ? "modificado" : "conflito"}</span>}
            </div>
          ))}
        </Section>
      </div>
    </aside>
  );
}

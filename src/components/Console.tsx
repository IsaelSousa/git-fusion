import { useEffect, useRef, useState } from "react";
import { refresh } from "../actions";
import { git, tokenize } from "../lib/git/runner";
import { useStore } from "../store";

interface Entry {
  cmd: string;
  out: string;
  err: string;
  code: number;
}

/** Console Git no estilo do GitExtensions: digite qualquer comando `git`. */
export function Console() {
  const active = useStore((s) => s.active)!;
  const [entries, setEntries] = useState<Entry[]>([]);
  const [line, setLine] = useState("");
  const [history, setHistory] = useState<string[]>([]);
  const [hIdx, setHIdx] = useState(-1);
  const [running, setRunning] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [entries]);
  useEffect(() => input.current?.focus(), []);

  const exec = async () => {
    const cmd = line.trim();
    if (!cmd || running) return;
    setLine("");
    setHistory((h) => [...h, cmd]);
    setHIdx(-1);
    if (cmd === "clear" || cmd === "cls") return setEntries([]);
    let args = tokenize(cmd);
    if (args[0] === "git") args = args.slice(1);
    if (!args.length) return;
    setRunning(true);
    try {
      const r = await git(active, args, { allowFail: true, raw: true });
      setEntries((e) => [...e, { cmd, out: r.stdout, err: r.stderr, code: r.code }]);
    } catch (e) {
      setEntries((x) => [...x, { cmd, out: "", err: String((e as Error).message), code: -1 }]);
    } finally {
      setRunning(false);
      void refresh();
      input.current?.focus();
    }
  };

  return (
    <div className="console" onClick={() => input.current?.focus()}>
      <div className="console-out">
        {!entries.length && (
          <div className="muted">Execute qualquer comando git neste repositório, ex.: <code>status -sb</code> ou <code>log --oneline -5</code>. Digite <code>clear</code> para limpar.</div>
        )}
        {entries.map((e, i) => (
          <div key={i} className="console-entry">
            <div className="console-cmd">$ git {e.cmd}</div>
            {e.out && <pre>{e.out}</pre>}
            {e.err && <pre className={e.code === 0 ? "" : "err"}>{e.err}</pre>}
            {e.code !== 0 && <div className="err small">saiu com código {e.code}</div>}
          </div>
        ))}
        <div ref={end} />
      </div>
      <div className="console-in">
        <span className="mono">git</span>
        <input
          ref={input}
          value={line}
          disabled={running}
          spellCheck={false}
          autoCapitalize="off"
          placeholder={running ? "executando…" : "comando"}
          onChange={(e) => setLine(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") exec();
            else if (e.key === "ArrowUp" && history.length) {
              e.preventDefault();
              const i = hIdx < 0 ? history.length - 1 : Math.max(0, hIdx - 1);
              setHIdx(i);
              setLine(history[i]);
            } else if (e.key === "ArrowDown" && hIdx >= 0) {
              e.preventDefault();
              const i = hIdx + 1;
              if (i >= history.length) {
                setHIdx(-1);
                setLine("");
              } else {
                setHIdx(i);
                setLine(history[i]);
              }
            }
          }}
        />
      </div>
    </div>
  );
}

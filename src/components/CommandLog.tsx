import { useEffect, useRef, useState } from "react";
import { useStore } from "../store";

const quote = (a: string) => (/[\s"'\\]/.test(a) || a === "" ? JSON.stringify(a) : a);

/** Registro de todos os comandos git disparados pela interface (como o "Command log" do GitExtensions). */
export function CommandLog() {
  const log = useStore((s) => s.commandLog);
  const [open, setOpen] = useState<number | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => end.current?.scrollIntoView({ block: "end" }), [log.length]);

  return (
    <div className="cmdlog">
      <div className="diff-bar">
        <span className="diff-title muted">{log.length} comando(s) executado(s) por ações da interface</span>
        <span className="grow-fill" />
        <button className="btn xs" onClick={() => useStore.setState({ commandLog: [] })}>Limpar</button>
      </div>
      <div className="cmdlog-list">
        {!log.length && <div className="muted pad">Nada executado ainda. Consultas de fundo (status, log) não são registradas.</div>}
        {log.map((e) => (
          <div key={e.id} className="cmdlog-entry">
            <div className="cmdlog-line" onClick={() => setOpen(open === e.id ? null : e.id)}>
              <span className="muted mono">{new Date(e.time).toLocaleTimeString("pt-BR")}</span>
              <span className={`badge ${e.code === 0 ? "st-add" : "st-del"}`}>{e.code}</span>
              <span className="mono ellipsis">git {e.args.map(quote).join(" ")}</span>
              <span className="muted small">{e.ms} ms</span>
            </div>
            {open === e.id && (
              <div className="cmdlog-detail">
                <div className="muted small">{e.cwd}</div>
                {e.stdout && <pre>{e.stdout}</pre>}
                {e.stderr && <pre className={e.code === 0 ? "" : "err"}>{e.stderr}</pre>}
                {!e.stdout && !e.stderr && <div className="muted small">(sem saída)</div>}
              </div>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>
    </div>
  );
}

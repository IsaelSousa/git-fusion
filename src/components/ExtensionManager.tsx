import { useEffect } from "react";
import { isEnabled, setExtensionEnabled, useExtensions } from "../extensions/registry";

/** Janela para ligar/desligar e configurar extensões. */
export function ExtensionManager() {
  const open = useExtensions((s) => s.managing);
  const available = useExtensions((s) => s.available);
  const enabled = useExtensions((s) => s.enabled);

  const close = () => useExtensions.setState({ managing: false });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  return (
    <div className="overlay" onMouseDown={close}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Extensões</h3>
        <div className="cust-list">
          {available.length === 0 && <div className="empty">Nenhuma extensão disponível.</div>}
          {available.map((x) => {
            const on = isEnabled(x, enabled);
            return (
              <div key={x.id} className="ext-row">
                <label className="cust-check">
                  <input type="checkbox" checked={on} onChange={() => setExtensionEnabled(x.id, !on)} />
                  <span className="ext-name">{x.name}</span>
                </label>
                <p className="ext-desc muted">{x.description}</p>
                {!!x.hosts?.length && <p className="ext-hosts muted">Acessa: {x.hosts.join(", ")}</p>}
                {x.configure && (
                  <button
                    className="btn xs"
                    disabled={!on}
                    onClick={() => {
                      close();
                      void x.configure!();
                    }}
                  >
                    Configurar…
                  </button>
                )}
              </div>
            );
          })}
        </div>
        <div className="dialog-actions">
          <button className="btn btn-primary" onClick={close}>
            Concluído
          </button>
        </div>
      </div>
    </div>
  );
}

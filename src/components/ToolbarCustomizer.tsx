import { useEffect, useState } from "react";
import { DEFAULT_TOOLBAR, TOOLBAR_LABELS, setToolbar, useStore } from "../store";
import { IconGrip } from "./Icons";

/** Janela para mostrar/ocultar e reordenar os itens da barra superior. */
export function ToolbarCustomizer() {
  const open = useStore((s) => s.customizingToolbar);
  const cfg = useStore((s) => s.toolbar);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);

  const close = () => useStore.setState({ customizingToolbar: false });

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  if (!open) return null;

  const move = (id: string, to: number) => {
    const order = cfg.order.filter((x) => x !== id);
    order.splice(Math.max(0, Math.min(order.length, to)), 0, id);
    setToolbar({ order });
  };
  const toggle = (id: string) =>
    setToolbar({ hidden: cfg.hidden.includes(id) ? cfg.hidden.filter((x) => x !== id) : [...cfg.hidden, id] });

  return (
    <div className="overlay" onMouseDown={close}>
      <div className="dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h3>Personalizar barra de ferramentas</h3>
        <p className="dialog-msg">Marque o que deve aparecer e arraste (ou use ▲▼) para reordenar. As mudanças valem na hora.</p>

        <div className="cust-list">
          {cfg.order.map((id, i) => (
            <div
              key={id}
              className={`cust-row${dragging === id ? " dragging" : ""}${over === id && dragging !== id ? " over" : ""}`}
              draggable
              onDragStart={(e) => {
                setDragging(id);
                e.dataTransfer.effectAllowed = "move";
                e.dataTransfer.setData("text/plain", id);
              }}
              onDragOver={(e) => {
                e.preventDefault();
                setOver(id);
              }}
              onDrop={(e) => {
                e.preventDefault();
                if (dragging && dragging !== id) move(dragging, i);
                setDragging(null);
                setOver(null);
              }}
              onDragEnd={() => {
                setDragging(null);
                setOver(null);
              }}
            >
              <IconGrip className="ico" />
              <label className="cust-check">
                <input type="checkbox" checked={!cfg.hidden.includes(id)} onChange={() => toggle(id)} />
                <span className={cfg.hidden.includes(id) ? "muted" : ""}>{TOOLBAR_LABELS[id] ?? id}</span>
              </label>
              <span className="grow-fill" />
              <button className="icon-btn" title="Mover para cima" disabled={i === 0} onClick={() => move(id, i - 1)}>
                ▲
              </button>
              <button className="icon-btn" title="Mover para baixo" disabled={i === cfg.order.length - 1} onClick={() => move(id, i + 1)}>
                ▼
              </button>
            </div>
          ))}
        </div>

        <label className="field">
          <span>Aparência dos botões</span>
          <select value={cfg.labels ? "full" : "icons"} onChange={(e) => setToolbar({ labels: e.target.value === "full" })}>
            <option value="full">Ícones e texto</option>
            <option value="icons">Somente ícones</option>
          </select>
        </label>

        <div className="dialog-actions">
          <button className="btn" onClick={() => setToolbar({ ...DEFAULT_TOOLBAR })}>
            Restaurar padrão
          </button>
          <button className="btn btn-primary" onClick={close}>
            Concluído
          </button>
        </div>
      </div>
    </div>
  );
}

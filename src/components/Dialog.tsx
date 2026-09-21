import { useEffect, useRef, useState } from "react";
import { type FieldValue, useStore } from "../store";
import { pickFolder } from "../lib/tauri";

export function Dialog() {
  const dialog = useStore((s) => s.dialog);
  return dialog ? <DialogBody key={dialog.title + dialog.fields.map((f) => f.name).join()} /> : null;
}

function DialogBody() {
  const dialog = useStore((s) => s.dialog)!;
  const [values, setValues] = useState<Record<string, FieldValue>>(() =>
    Object.fromEntries(dialog.fields.map((f) => [f.name, f.value ?? (f.type === "checkbox" ? false : f.options?.[0]?.value ?? "")])),
  );
  const first = useRef<HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement>(null);

  const close = (result: Record<string, FieldValue> | null) => {
    useStore.setState({ dialog: null });
    dialog.resolve(result);
  };

  const visible = dialog.fields.filter((f) => !f.showIf || values[f.showIf]);
  const valid = visible.every((f) => !f.required || String(values[f.name] ?? "").trim() !== "");
  const submit = () => valid && close(values);

  useEffect(() => {
    first.current?.focus();
    first.current?.select?.();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const set = (name: string, v: FieldValue) => setValues((s) => ({ ...s, [name]: v }));

  return (
    <div className="overlay" onMouseDown={() => close(null)}>
      <form
        className="dialog"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
      >
        <h3>{dialog.title}</h3>
        {dialog.message && <p className="dialog-msg">{dialog.message}</p>}
        {visible.map((f, i) => (
          <label key={f.name} className={f.type === "checkbox" ? "field check" : "field"}>
            {f.type === "checkbox" ? (
              <>
                <input type="checkbox" checked={!!values[f.name]} onChange={(e) => set(f.name, e.target.checked)} />
                <span>{f.label}</span>
              </>
            ) : (
              <>
                <span>{f.label}</span>
                {f.type === "textarea" ? (
                  <textarea
                    ref={i === 0 ? first : undefined}
                    rows={3}
                    value={String(values[f.name])}
                    placeholder={f.placeholder}
                    onChange={(e) => set(f.name, e.target.value)}
                  />
                ) : f.type === "select" ? (
                  <select
                    ref={i === 0 ? first : undefined}
                    value={String(values[f.name])}
                    onChange={(e) => set(f.name, e.target.value)}
                  >
                    {f.options?.map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="field-row">
                    <input
                      ref={i === 0 ? first : undefined}
                      type="text"
                      value={String(values[f.name])}
                      placeholder={f.placeholder}
                      spellCheck={false}
                      onChange={(e) => set(f.name, e.target.value)}
                    />
                    {f.type === "folder" && (
                      <button
                        type="button"
                        className="btn"
                        onClick={async () => {
                          const p = await pickFolder(f.label);
                          if (p) set(f.name, p);
                        }}
                      >
                        Procurar…
                      </button>
                    )}
                  </span>
                )}
              </>
            )}
          </label>
        ))}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={() => close(null)}>
            Cancelar
          </button>
          <button type="submit" className={`btn ${dialog.danger ? "btn-danger" : "btn-primary"}`} disabled={!valid}>
            {dialog.okLabel}
          </button>
        </div>
      </form>
    </div>
  );
}

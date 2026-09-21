import { dismissToast, useStore } from "../store";

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  return (
    <div className="toasts">
      {toasts.map((t) => (
        <div key={t.id} className={`toast toast-${t.kind}`} onClick={() => dismissToast(t.id)}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

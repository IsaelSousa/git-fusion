import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useStore } from "../store";

export function ContextMenu() {
  const menu = useStore((s) => s.menu);
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: 0, y: 0 });

  useLayoutEffect(() => {
    if (!menu) return;
    const el = ref.current;
    const w = el?.offsetWidth ?? 0;
    const h = el?.offsetHeight ?? 0;
    setPos({
      x: Math.max(4, Math.min(menu.x, window.innerWidth - w - 8)),
      y: Math.max(4, Math.min(menu.y, window.innerHeight - h - 8)),
    });
  }, [menu]);

  useEffect(() => {
    if (!menu) return;
    const close = () => useStore.setState({ menu: null });
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && close();
    window.addEventListener("mousedown", close);
    window.addEventListener("blur", close);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", close);
      window.removeEventListener("blur", close);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
    };
  }, [menu]);

  if (!menu) return null;
  return (
    <div
      ref={ref}
      className="menu"
      style={{ left: pos.x, top: pos.y }}
      onMouseDown={(e) => e.stopPropagation()}
      onContextMenu={(e) => e.preventDefault()}
    >
      {menu.items.map((it, i) =>
        it.separator ? (
          <div key={i} className="menu-sep" />
        ) : (
          <button
            key={i}
            className={`menu-item${it.danger ? " danger" : ""}`}
            disabled={it.disabled}
            onClick={() => {
              useStore.setState({ menu: null });
              it.action?.();
            }}
          >
            {it.label}
          </button>
        ),
      )}
    </div>
  );
}

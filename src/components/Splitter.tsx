import { useCallback, useEffect, useState } from "react";
import { load, save } from "../store";

interface Props {
  dir: "h" | "v";
  onDrag: (delta: number) => void;
}

/** Divisor arrastável. `h` = separa colunas (arrasta em X); `v` = separa linhas (arrasta em Y). */
export function Splitter({ dir, onDrag }: Props) {
  return (
    <div
      className={`splitter splitter-${dir}`}
      onPointerDown={(e) => {
        e.preventDefault();
        const el = e.currentTarget;
        el.setPointerCapture(e.pointerId);
        let last = dir === "h" ? e.clientX : e.clientY;
        const move = (ev: PointerEvent) => {
          const cur = dir === "h" ? ev.clientX : ev.clientY;
          onDrag(cur - last);
          last = cur;
        };
        const up = () => {
          el.removeEventListener("pointermove", move);
          el.removeEventListener("pointerup", up);
        };
        el.addEventListener("pointermove", move);
        el.addEventListener("pointerup", up);
      }}
    />
  );
}

/** Tamanho persistido em localStorage, com limites. */
export function usePersistedSize(key: string, initial: number, min: number, max: number) {
  const [size, setSize] = useState(() => Math.min(max, Math.max(min, load(key, initial))));
  const drag = useCallback(
    (delta: number) => setSize((s) => Math.min(max, Math.max(min, s + delta))),
    [min, max],
  );
  useEffect(() => save(key, size), [key, size]);
  return [size, drag] as const;
}

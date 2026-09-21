export const basename = (p: string) => p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || p;

export const dirname = (p: string) => {
  const parts = p.replace(/[\\/]+$/, "").split(/[\\/]/);
  parts.pop();
  return parts.join("/") || "/";
};

export const short = (hash: string) => hash.slice(0, 7);

const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });

export function timeAgo(unixSeconds: number): string {
  const diff = unixSeconds - Date.now() / 1000;
  const abs = Math.abs(diff);
  const units: [Intl.RelativeTimeFormatUnit, number][] = [
    ["year", 31536000],
    ["month", 2592000],
    ["week", 604800],
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ];
  for (const [unit, secs] of units) {
    if (abs >= secs) return rtf.format(Math.round(diff / secs), unit);
  }
  return "agora";
}

export function fullDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleString("pt-BR", { dateStyle: "medium", timeStyle: "short" });
}

export function shortDate(unixSeconds: number): string {
  return new Date(unixSeconds * 1000).toLocaleDateString("pt-BR", { day: "2-digit", month: "short", year: "numeric" });
}

export function copyText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(text);
  const ta = document.createElement("textarea");
  ta.value = text;
  document.body.appendChild(ta);
  ta.select();
  document.execCommand("copy");
  ta.remove();
  return Promise.resolve();
}

export const initials = (name: string) =>
  name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((s) => s[0]?.toUpperCase())
    .join("") || "?";

/** Cor estável derivada de uma string (para avatares). */
export function hueOf(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return h % 360;
}

export const STATUS_LABEL: Record<string, string> = {
  M: "Modificado",
  A: "Adicionado",
  D: "Removido",
  R: "Renomeado",
  C: "Copiado",
  T: "Tipo alterado",
  U: "Conflito",
  "?": "Novo",
};

export const statusClass = (c: string) =>
  c === "A" || c === "?" ? "st-add" : c === "D" ? "st-del" : c === "U" ? "st-conflict" : c === "R" || c === "C" ? "st-ren" : "st-mod";

import type { FileDiff } from "../../types";

/**
 * - `stage`:   aplica no índice o diff índice→worktree.
 * - `unstage`: reverte no índice o diff HEAD→índice.
 * - `discard`: reverte no worktree o diff índice→worktree.
 */
export type PatchMode = "stage" | "unstage" | "discard";

export const patchArgs = (mode: PatchMode): string[] =>
  mode === "stage"
    ? ["apply", "--cached", "--recount", "--whitespace=nowarn"]
    : mode === "unstage"
      ? ["apply", "--cached", "--reverse", "--recount", "--whitespace=nowarn"]
      : ["apply", "--reverse", "--recount", "--whitespace=nowarn"];

/**
 * Monta um patch para um hunk (ou apenas algumas linhas dele, `selected`).
 * `selected` contém índices em `hunk.lines`; `null` = hunk inteiro.
 * Retorna `null` se nada aplicável foi selecionado.
 */
export function buildPatch(
  diff: FileDiff,
  hunkIndex: number,
  selected: ReadonlySet<number> | null,
  mode: PatchMode,
): string | null {
  const hunk = diff.hunks[hunkIndex];
  if (!hunk) return null;
  const reverse = mode !== "stage";

  const out: string[] = [];
  let changes = 0;
  let prevEmitted = false;

  hunk.lines.forEach((l, i) => {
    if (l.type === "\\") {
      // "\ No newline at end of file" só faz sentido colado à linha anterior.
      if (prevEmitted) out.push("\\" + l.text);
      return;
    }
    if (l.type === " ") {
      out.push(" " + l.text);
      prevEmitted = true;
      return;
    }
    const isSelected = selected === null || selected.has(i);
    if (isSelected) {
      out.push(l.type + l.text);
      changes++;
      prevEmitted = true;
    } else if ((l.type === "+" && reverse) || (l.type === "-" && !reverse)) {
      // Linha não escolhida que existe no lado "de origem": vira contexto.
      out.push(" " + l.text);
      prevEmitted = true;
    } else {
      prevEmitted = false; // descartada do patch
    }
  });

  if (changes === 0) return null;

  let oldCount = 0;
  let newCount = 0;
  for (const l of out) {
    const t = l[0];
    if (t === " ") {
      oldCount++;
      newCount++;
    } else if (t === "-") oldCount++;
    else if (t === "+") newCount++;
  }

  const header = `@@ -${hunk.oldStart},${oldCount} +${hunk.newStart},${newCount} @@${hunk.context ? " " + hunk.context : ""}`;
  return [...diff.header, header, ...out].join("\n") + "\n";
}

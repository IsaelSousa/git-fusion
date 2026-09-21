import {
  checkoutBranch,
  copy,
  createBranch,
  deleteBranch,
  mergeInto,
  rebaseOnto,
  renameBranch,
  setUpstream,
} from "../actions";
import { type MenuItem, useStore } from "../store";
import type { Branch } from "../types";

/** Menu de contexto de uma branch (local ou remota); o primeiro item é o Checkout. */
export function branchMenuItems(b: Branch): MenuItem[] {
  const current = useStore.getState().head.branch ?? "HEAD";
  const ref = b.display;
  return [
    { label: `Checkout de "${ref}"`, action: () => checkoutBranch(b), disabled: b.current },
    { separator: true },
    { label: `Merge "${ref}" em ${current}`, action: () => mergeInto(ref), disabled: b.current },
    { label: `Rebase ${current} sobre "${ref}"`, action: () => rebaseOnto(ref), disabled: b.current },
    { separator: true },
    { label: "Nova branch a partir daqui…", action: () => createBranch(ref) },
    ...(!b.remote
      ? [
          { label: "Renomear…", action: () => renameBranch(b) },
          { label: "Definir upstream…", action: () => setUpstream(b) },
        ]
      : []),
    { separator: true },
    { label: "Copiar nome", action: () => copy(ref, "Nome copiado") },
    { label: b.remote ? "Excluir do remote…" : "Excluir…", action: () => deleteBranch(b), danger: true, disabled: b.current },
  ];
}

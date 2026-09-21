import { operationStep } from "../actions";
import { useStore } from "../store";

const LABEL = {
  merge: "Merge",
  rebase: "Rebase",
  "cherry-pick": "Cherry-pick",
  revert: "Revert",
} as const;

export function OperationBanner() {
  const op = useStore((s) => s.operation);
  const conflicts = useStore((s) => s.files.filter((f) => f.conflicted).length);
  const busy = useStore((s) => s.busy);
  if (!op) return null;
  return (
    <div className="op-banner">
      <b>{LABEL[op]} em andamento</b>
      <span>
        {conflicts > 0
          ? `${conflicts} arquivo(s) em conflito — resolva, faça stage e continue.`
          : "Sem conflitos pendentes — você pode continuar."}
      </span>
      <span className="grow-fill" />
      {op === "rebase" && (
        <button className="btn xs" disabled={!!busy} onClick={() => operationStep("skip")}>
          Pular
        </button>
      )}
      <button className="btn xs" disabled={!!busy} onClick={() => operationStep("abort")}>
        Abortar
      </button>
      <button className="btn btn-primary xs" disabled={!!busy || conflicts > 0} onClick={() => operationStep("cont")}>
        Continuar
      </button>
    </div>
  );
}

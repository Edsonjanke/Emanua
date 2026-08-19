import type { ReactNode } from "react";

/** Estado vazio padrão: ícone opcional, título, descrição e uma ação. */
export function EmptyState({
  icone,
  titulo,
  descricao,
  acao,
  className = "",
}: {
  icone?: ReactNode;
  titulo: string;
  descricao?: string;
  acao?: ReactNode;
  className?: string;
}): JSX.Element {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-[var(--border)] bg-[var(--bg-elevated)] px-6 py-10 text-center ${className}`}
    >
      {icone && (
        <div
          className="mb-1 grid size-10 place-items-center rounded-full text-[var(--accent-text)]"
          style={{ backgroundColor: "color-mix(in srgb, var(--accent) 10%, transparent)" }}
          aria-hidden
        >
          {icone}
        </div>
      )}
      <p className="text-sm font-medium text-[var(--text)]">{titulo}</p>
      {descricao && (
        <p className="max-w-sm text-xs text-[var(--text-muted)]">{descricao}</p>
      )}
      {acao && <div className="mt-2">{acao}</div>}
    </div>
  );
}

export default EmptyState;

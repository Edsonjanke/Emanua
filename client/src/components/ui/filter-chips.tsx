export interface FiltroOpcao {
  id: string;
  label: string;
  count?: number;
}

/**
 * Linha horizontal de chips clicáveis (filtros). O ativo recebe fundo
 * --accent com texto --on-accent. Rola na horizontal no mobile.
 */
export function FilterChips({
  opcoes,
  valor,
  onChange,
  className = "",
  ariaLabel = "Filtros",
  contagemSoNoDesktop = false,
  legivel = false,
}: {
  opcoes: FiltroOpcao[];
  valor: string;
  onChange: (id: string) => void;
  className?: string;
  ariaLabel?: string;
  /**
   * Esconde o contador dentro do chip no celular. Use quando a mesma contagem
   * já aparece perto dali (ex.: faixa-veredito) — evita repetir o número e
   * deixa a fileira caber em uma linha só.
   */
  contagemSoNoDesktop?: boolean;
  /**
   * Piso de 12px no celular (o desktop já é 12px). Para telas onde o filtro é
   * parte da decisão sobre dinheiro e não um enfeite de barra.
   */
  legivel?: boolean;
}): JSX.Element {
  const tamanho = legivel ? "text-xs" : "text-[11px]";
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`flex items-center gap-1.5 overflow-x-auto pb-1 sm:gap-2 ${className}`}
    >
      {opcoes.map((o) => {
        const ativo = o.id === valor;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={ativo}
            className={
              // min-h-11 = 44px de alvo no toque (WCAG 2.5.5); no desktop volta ao compacto.
              `inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1.5 ${tamanho} whitespace-nowrap sm:min-h-0 sm:px-3 sm:text-xs ` +
              (ativo
                ? "border-[var(--accent)] bg-[var(--accent)] text-[var(--on-accent)]"
                : "border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:text-[var(--text)] hover:border-[var(--accent)]")
            }
          >
            <span>{o.label}</span>
            {o.count != null && (
              <span
                className={
                  `tabular-nums rounded-full px-1.5 ${tamanho} leading-4 ` +
                  (contagemSoNoDesktop ? "hidden sm:inline " : "") +
                  (ativo ? "bg-[var(--on-accent)]/25 text-[var(--on-accent)]" : "bg-[var(--bg)] text-[var(--text-muted)]")
                }
              >
                {o.count}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default FilterChips;

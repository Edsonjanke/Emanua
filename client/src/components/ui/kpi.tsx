export type KpiTone = "neutro" | "verde" | "vermelho" | "ambar" | "accent";

const CORES: Record<KpiTone, string> = {
  neutro: "var(--text)",
  verde: "var(--green)",
  vermelho: "var(--red)",
  ambar: "var(--amber)",
  accent: "var(--accent)",
};

/**
 * Cor de TEXTO. O rótulo e o valor do card são pequenos, então precisam do AA:
 * --red e --accent reprovam (3,75:1 e 3,30:1 sobre o mint). Borda continua no tom vivo.
 */
const CORES_TEXTO: Record<KpiTone, string> = {
  neutro: "var(--text)",
  verde: "var(--green)",
  vermelho: "var(--red-text)",
  ambar: "var(--amber)",
  accent: "var(--accent-text)",
};

/**
 * KPI no padrão Mercury: contagem grande em cima, rótulo, depois o dinheiro.
 * Se `count` não for informado, o próprio valor vira o número grande.
 */
export function KpiCard({
  count,
  label,
  valor,
  tone = "neutro",
  hint,
  className = "",
}: {
  count?: number | string;
  label: string;
  /**
   * Dinheiro do card. Opcional: quando o número grande já é uma CONTAGEM e não
   * existe soma que signifique dinheiro de verdade para aquela categoria, é
   * melhor não mostrar valor nenhum do que mostrar um número que não é dinheiro.
   */
  valor?: string;
  tone?: KpiTone;
  hint?: string;
  className?: string;
}): JSX.Element {
  const cor = CORES[tone] ?? CORES.neutro;
  const corTexto = CORES_TEXTO[tone] ?? CORES_TEXTO.neutro;
  const temCount = count !== undefined && count !== null && count !== "";
  const temValor = valor !== undefined && valor !== null && valor !== "";

  return (
    <div
      className={`rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 ${className}`}
      style={
        tone !== "neutro"
          ? { borderColor: `color-mix(in srgb, ${cor} 35%, var(--border))` }
          : undefined
      }
    >
      <p
        className="tabular-nums text-3xl leading-none font-medium"
        style={{ color: temCount ? corTexto : CORES_TEXTO.neutro }}
      >
        {temCount ? count : valor}
      </p>
      <p className="mt-2 text-xs text-[var(--text-muted)]">{label}</p>
      {temCount && temValor && (
        <p className="tabular-nums mt-1 text-sm font-medium" style={{ color: corTexto }}>
          {valor}
        </p>
      )}
      {hint && <p className="mt-1 text-xs text-[var(--text-muted)]">{hint}</p>}
    </div>
  );
}

export default KpiCard;

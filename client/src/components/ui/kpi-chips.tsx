import type { KpiTone } from "./kpi";

export interface KpiChipOpcao {
  id: string;
  label: string;
  /** Quantas contas caem neste recorte. */
  count: number;
  /**
   * Soma já formatada (R$ …). Opcional de propósito: quando a tela já mostra o
   * total do recorte ativo em destaque, repetir a soma no chip é o MESMO número
   * duas vezes a poucos pixels de distância. Aí passe só `count`.
   */
  valor?: string;
  tone?: KpiTone;
  /**
   * Texto longo para um rótulo que precisa ser curto na fileira (ex.: "Urgentes"
   * dizendo, no title, de que recortes ele é feito). Vai só no `title`: o rótulo
   * visível continua sendo o nome acessível do botão.
   */
  titulo?: string;
}

/** Preenchimento e borda — os tons calibrados para SUPERFÍCIE (DESIGN.md). */
const CORES: Record<KpiTone, string> = {
  neutro: "var(--text)",
  verde: "var(--green)",
  vermelho: "var(--red)",
  ambar: "var(--amber)",
  accent: "var(--accent)",
};

/**
 * Texto e número — os tons calibrados para TEXTO.
 *
 * O chip escreve em 12px, que é texto pequeno e pede 4,5:1. Com --red e
 * --accent (que são cores de superfície) o número saía em 4,20:1 no branco e o
 * rótulo do chip ativo em 3,24:1 sobre o próprio preenchimento — os dois abaixo
 * do mínimo da WCAG AA. --red-text/--accent-text mantêm o matiz e passam.
 * A borda e o fundo continuam vindo de CORES: lá o tom original é o certo.
 */
const CORES_TEXTO: Record<KpiTone, string> = {
  neutro: "var(--text)",
  verde: "var(--green)",
  vermelho: "var(--red-text)",
  ambar: "var(--amber)",
  accent: "var(--accent-text)",
};

/**
 * Faixa de chips que são KPI e filtro ao mesmo tempo: cada chip mostra
 * "Rótulo · contagem [· soma]" e, ao ser clicado, filtra a lista.
 *
 * Existe para não desenhar o mesmo número três vezes (cartão + chip + linha).
 * QUEBRA em várias linhas em vez de rolar na horizontal: uma faixa rolável
 * esconde recortes inteiros sem avisar que existem — e recorte que ninguém vê
 * não filtra nada. Mesma semântica de aria-pressed do FilterChips.
 */
export function KpiChips({
  opcoes,
  valor,
  onChange,
  className = "",
  ariaLabel = "Filtros",
}: {
  opcoes: KpiChipOpcao[];
  valor: string;
  onChange: (id: string) => void;
  className?: string;
  ariaLabel?: string;
}): JSX.Element {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={`-mx-1 flex flex-wrap items-center gap-2 px-1 pb-1 ${className}`}
    >
      {opcoes.map((o) => {
        const ativo = o.id === valor;
        // Cor do número: semântica do recorte (vencidas em vermelho, etc.),
        // no tom de TEXTO — o número é 12px e precisa dos 4,5:1.
        const cor = CORES_TEXTO[o.tone ?? "neutro"] ?? CORES_TEXTO.neutro;
        // Cor da seleção: verde da marca quando o recorte não tem cor própria.
        // Borda e fundo usam o tom de superfície; o texto, o tom de texto.
        const neutro = !o.tone || o.tone === "neutro";
        const corSel = neutro ? "var(--accent)" : CORES[o.tone ?? "neutro"] ?? CORES.neutro;
        const corSelTexto = neutro ? "var(--accent-text)" : cor;
        return (
          <button
            key={o.id}
            type="button"
            onClick={() => onChange(o.id)}
            aria-pressed={ativo}
            title={o.titulo}
            className={
              "inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border px-3.5 text-xs transition-colors " +
              // 44px de alvo. Encolhe só com ponteiro fino: a largura decide o
              // layout, o dedo decide o alvo (celular deitado ainda é dedo).
              "min-h-11 sm:pointer-fine:min-h-9 sm:px-4 sm:text-sm " +
              (ativo
                ? "font-medium"
                : "border-[var(--border)] bg-[var(--bg-card)] text-[var(--text-muted)] hover:border-[var(--accent)] hover:text-[var(--text)]")
            }
            style={
              ativo
                ? {
                    color: corSelTexto,
                    borderColor: corSel,
                    backgroundColor: `color-mix(in srgb, ${corSel} 12%, var(--bg-card))`,
                    boxShadow: `inset 0 0 0 1px ${corSel}`,
                  }
                : undefined
            }
          >
            <span>{o.label}</span>
            <span className="tabular-nums font-medium" style={{ color: cor }}>
              {o.count}
            </span>
            {o.valor && (
              <>
                <span aria-hidden className="opacity-40">
                  ·
                </span>
                <span
                  className="tabular-nums"
                  style={{ color: ativo ? corSelTexto : "var(--text)" }}
                >
                  {o.valor}
                </span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

export default KpiChips;

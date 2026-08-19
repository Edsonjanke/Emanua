import type { ReactNode } from "react";

export type ChipTone = "neutro" | "verde" | "vermelho" | "ambar" | "accent";

/** Cor base de cada tone — usada em BORDA e FUNDO, onde o tom vivo é o certo. */
export const CORES_TONE: Record<ChipTone, string> = {
  neutro: "var(--text-muted)",
  verde: "var(--green)",
  vermelho: "var(--red)",
  ambar: "var(--amber)",
  accent: "var(--accent)",
};

/**
 * Cor de TEXTO de cada tone. O chip escreve a 11px, então precisa dos 4,5:1 do AA.
 * --red e --accent reprovam nesse tamanho (3,75:1 e 3,30:1 sobre o mint do canvas);
 * --red-text e --accent-text mantêm o mesmo matiz e passam. Verde e âmbar já passam.
 */
export const CORES_TONE_TEXTO: Record<ChipTone, string> = {
  neutro: "var(--text-muted)",
  verde: "var(--green)",
  vermelho: "var(--red-text)",
  ambar: "var(--amber)",
  accent: "var(--accent-text)",
};

/**
 * Pill pequeno de status. Borda 1px e texto na cor do tone,
 * com um leve wash da mesma cor no fundo.
 */
export function Chip({
  tone = "neutro",
  forte = false,
  legivel = false,
  children,
  className = "",
}: {
  tone?: ChipTone;
  /** Versão sólida do mesmo tone — para o estado mais urgente (ex.: vence hoje). */
  forte?: boolean;
  /**
   * 12px em vez de 11px. Onde o chip é só um selo de estado ao lado de um dado
   * que já se lê (contas a pagar), 11px basta. Onde o chip É o dado que decide
   * — "Nova / Conflito / Não lida" na conferência do extrato — 11px é o piso
   * abaixo do qual ninguém deveria confirmar dinheiro.
   */
  legivel?: boolean;
  children: ReactNode;
  className?: string;
}): JSX.Element {
  const cor = CORES_TONE[tone] ?? CORES_TONE.neutro;
  const corTexto = CORES_TONE_TEXTO[tone] ?? CORES_TONE_TEXTO.neutro;
  return (
    <span
      className={`inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 leading-4 tracking-wide ${
        legivel ? "text-xs" : "text-[11px]"
      } ${className}`}
      style={
        forte
          ? { color: "var(--on-accent)", borderColor: corTexto, backgroundColor: corTexto }
          : {
              color: corTexto,
              borderColor: `color-mix(in srgb, ${cor} 40%, transparent)`,
              backgroundColor: `color-mix(in srgb, ${cor} 8%, transparent)`,
            }
      }
    >
      {children}
    </span>
  );
}

export default Chip;

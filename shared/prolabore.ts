/** Classificador de pró-labore — sócio é texto livre. */

export type DebitoNatureza = "pro_labore" | "empresa" | "pendente" | "excluido";

export interface RegraClassificacao {
  socio: string;
  padrao: string;
  ativo?: boolean | null;
  ordem?: number | null;
}

function norm(s: string): string {
  return (s ?? "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toUpperCase();
}

export function classifyProLabore(
  historico: string,
  regras: RegraClassificacao[],
): string | null {
  const h = norm(historico);
  const ativas = (regras ?? [])
    .filter((r) => r.ativo !== false && !!r.padrao)
    .sort((a, b) => (a.ordem ?? 0) - (b.ordem ?? 0));
  for (const r of ativas) {
    if (h.includes(norm(r.padrao))) return r.socio;
  }
  return null;
}

export function looksLikePersonalTransfer(historico: string): boolean {
  return /PIX|MERCADO\s*PAGO/.test(norm(historico));
}

export interface DebitoClassificado {
  natureza: DebitoNatureza;
  socio: string | null;
  origem: "manual" | "regra" | "nenhuma";
}

export function resolveDebitoNatureza(
  historico: string,
  override: string | null | undefined,
  regras: RegraClassificacao[],
): DebitoClassificado {
  if (override === "excluir") {
    return { natureza: "excluido", socio: null, origem: "manual" };
  }
  if (override && override !== "excluir") {
    return { natureza: "pro_labore", socio: override, origem: "manual" };
  }
  const socio = classifyProLabore(historico, regras);
  if (socio) {
    return { natureza: "pro_labore", socio, origem: "regra" };
  }
  if (looksLikePersonalTransfer(historico)) {
    return { natureza: "pendente", socio: null, origem: "nenhuma" };
  }
  return { natureza: "empresa", socio: null, origem: "nenhuma" };
}

export const REGRAS_PROLABORE_SEED: { socio: string; padrao: string; ordem: number }[] = [
  { socio: "ataize", padrao: "ATAIZE", ordem: 1 },
  { socio: "ataize", padrao: "MERCADO PAGO", ordem: 2 },
];

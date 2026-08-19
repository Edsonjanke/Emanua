/**
 * Estados de vencimento compartilhados entre A Pagar e A Receber.
 * Funções puras sobre datas ISO (YYYY-MM-DD) — sem dependência de fuso.
 */

export type EstadoVencimento = "quitado" | "vencido" | "hoje" | "breve" | "aberto";

/** Dias inteiros de `de` até `ate` (positivo quando `ate` é depois). */
export function diffDias(de: string, ate: string): number {
  const a = Date.parse(`${de}T00:00:00Z`);
  const b = Date.parse(`${ate}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86400000);
}

/**
 * Em que estado está um vencimento.
 * "hoje" é estado próprio: vence/recebe HOJE não é a mesma urgência de daqui a 7 dias.
 */
export function estadoVencimento(
  dataVencimento: string,
  hoje: string,
  opts: { quitado?: boolean; diasBreve?: number } = {},
): EstadoVencimento {
  if (opts.quitado) return "quitado";
  const diasBreve = opts.diasBreve ?? 7;
  if (dataVencimento < hoje) return "vencido";
  if (dataVencimento === hoje) return "hoje";
  if (diffDias(hoje, dataVencimento) <= diasBreve) return "breve";
  return "aberto";
}

/** Quantos dias já se passaram do vencimento (0 quando ainda não venceu). */
export function diasVencido(dataVencimento: string, hoje: string): number {
  const d = diffDias(dataVencimento, hoje);
  return d > 0 ? d : 0;
}

/** "vencido há 3 dias" — null quando não está vencido. */
export function rotuloAtraso(dataVencimento: string, hoje: string): string | null {
  const dias = diasVencido(dataVencimento, hoje);
  if (dias <= 0) return null;
  return `vencido há ${dias} ${dias === 1 ? "dia" : "dias"}`;
}

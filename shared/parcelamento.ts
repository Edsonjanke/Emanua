/**
 * Geração de parcelas mensais — compartilhada por contas a pagar e a receber.
 * Datas ISO (YYYY-MM-DD), funções puras.
 */

export const MAX_PARCELAS = 60;

/** Normaliza o nº de parcelas vindo do body. 0 = não é parcelado. */
export function normalizaTotalParcelas(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 2) return 0;
  return Math.min(MAX_PARCELAS, Math.floor(n));
}

/**
 * Soma meses a uma data ISO grudando no último dia do mês quando ele não existe
 * (31/01 + 1 mês = 28/02, e não 03/03 como o overflow nativo do Date faria).
 */
export function addMeses(iso: string, meses: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  if (!y || !m || !d) return iso;
  const total = (m - 1) + meses;
  const ano = y + Math.floor(total / 12);
  const mes = ((total % 12) + 12) % 12; // 0-based
  const ultimoDia = new Date(Date.UTC(ano, mes + 1, 0)).getUTCDate();
  const dia = Math.min(d, ultimoDia);
  return `${String(ano).padStart(4, "0")}-${String(mes + 1).padStart(2, "0")}-${String(dia).padStart(2, "0")}`;
}

/** Próximo vencimento mensal (usado ao baixar um lançamento recorrente). */
export function proximoVencimentoMensal(iso: string): string {
  return addMeses(iso, 1);
}

/** As N datas de vencimento de um parcelamento mensal a partir da data base. */
export function datasParcelasMensais(dataBase: string, n: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < n; i++) out.push(addMeses(dataBase, i));
  return out;
}

/**
 * Monta as N parcelas a partir de um "molde" do lançamento.
 * O chamador decide os campos próprios de cada tabela.
 */
export function gerarParcelas<T extends Record<string, unknown>>(
  molde: T,
  dataBase: string,
  totalParcelas: number,
): (T & { dataVencimento: string; parcelaAtual: number; totalParcelas: number })[] {
  return datasParcelasMensais(dataBase, totalParcelas).map((dataVencimento, i) => ({
    ...molde,
    dataVencimento,
    parcelaAtual: i + 1,
    totalParcelas,
  }));
}

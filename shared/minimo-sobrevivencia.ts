export function roundMoney2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function calcMinimoSobrevivencia(input: {
  contasPagarMes: number;
  custosFixos: number;
  custosVariaveis: number;
}): number {
  return roundMoney2(
    (Number(input.contasPagarMes) || 0) +
      (Number(input.custosFixos) || 0) +
      (Number(input.custosVariaveis) || 0),
  );
}

/** Ponto de equilíbrio = custos fixos / (margem % / 100). */
export function calcPontoEquilibrio(custosFixos: number, margemPct: number): number | null {
  const m = Number(margemPct) || 0;
  if (m <= 0) return null;
  return roundMoney2((Number(custosFixos) || 0) / (m / 100));
}

/** Soma faturamento do mês a partir de receitas_dia. */
export function sumReceitasMes(
  receitas: { data: string; valor: string | number }[],
  year: number,
  month: number,
): number {
  const prefix = `${year}-${String(month).padStart(2, "0")}`;
  return roundMoney2(
    receitas
      .filter((r) => r.data.startsWith(prefix))
      .reduce((s, r) => s + (Number(r.valor) || 0), 0),
  );
}

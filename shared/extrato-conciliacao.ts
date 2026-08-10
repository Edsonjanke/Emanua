/** Conciliação extrato ↔ recebíveis (match por valor + proximidade de data). */

export interface MovParaMatch {
  id: string;
  data: string;
  valor: number;
  tipo: "C" | "D";
  conciliadoTipo?: string | null;
}

export interface RecebivelParaMatch {
  id: string;
  valor: number;
  dataVencimento: string;
  status: string;
}

export interface MatchSugestao {
  movId: string;
  recebivelId: string;
  diasDiff: number;
}

function parseValor(v: string | number): number {
  return Math.round((Number(v) || 0) * 100) / 100;
}

function diasEntre(a: string, b: string): number {
  const da = new Date(a + "T00:00:00Z").getTime();
  const db = new Date(b + "T00:00:00Z").getTime();
  return Math.round(Math.abs(da - db) / 86400000);
}

/** Sugere pares crédito ↔ recebível aberto com mesmo valor (±0.01) e ≤7 dias. */
export function sugerirConciliacao(
  movs: MovParaMatch[],
  recebiveis: RecebivelParaMatch[],
  maxDias = 7,
): MatchSugestao[] {
  const creditos = movs.filter((m) => m.tipo === "C" && !m.conciliadoTipo);
  const abertos = recebiveis.filter((r) => r.status === "aberta");
  const usadosMov = new Set<string>();
  const usadosRec = new Set<string>();
  const sugestoes: MatchSugestao[] = [];

  for (const m of creditos) {
    if (usadosMov.has(m.id)) continue;
    const mv = parseValor(m.valor);
    let best: { r: RecebivelParaMatch; dias: number } | null = null;
    for (const r of abertos) {
      if (usadosRec.has(r.id)) continue;
      if (Math.abs(parseValor(r.valor) - mv) > 0.01) continue;
      const dias = diasEntre(m.data, r.dataVencimento);
      if (dias > maxDias) continue;
      if (!best || dias < best.dias) best = { r, dias };
    }
    if (best) {
      usadosMov.add(m.id);
      usadosRec.add(best.r.id);
      sugestoes.push({ movId: m.id, recebivelId: best.r.id, diasDiff: best.dias });
    }
  }
  return sugestoes;
}

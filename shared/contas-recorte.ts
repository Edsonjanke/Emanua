/**
 * Recortes e ordenação da lista de contas — regra pura, longe do JSX.
 *
 * Mora aqui porque dois defeitos viviam escondidos dentro do componente:
 *  1. "Este mês" contava sempre por dataVencimento, inclusive na aba PAGAS,
 *     onde "este mês" só pode significar pago este mês (uma conta que vence
 *     15/09 e foi paga 17/08 sumia da contagem de agosto);
 *  2. a ordenação não tinha desempate, então duas contas do mesmo dia trocavam
 *     de lugar entre duas cargas — marcar uma como paga embaralhava as vizinhas.
 */

export type RecorteId =
  | "todas"
  | "vencidas"
  | "prox7"
  | "urgentes"
  | "mes"
  | "sem-categoria";
/**
 * `pag-desc`/`pag-asc` existem porque a lista das QUITADAS não se ordena por
 * vencimento: numa aba "Pagas" a pergunta é "o que eu paguei por último?".
 * `dataDoMes()` já trocava para dataPagamento nessa aba (o recorte "Pagas este
 * mês" conta certo), mas a ordenação continuava comparando dataVencimento — e
 * a conta que acabou de ser paga caía na posição 142 de 143.
 */
export type OrdemLista =
  | "venc-asc"
  | "venc-desc"
  | "valor-desc"
  | "valor-asc"
  | "pag-desc"
  | "pag-asc";

/** O mínimo que uma linha precisa ter para ser recortada e ordenada. */
export interface LinhaRecortavel {
  id: string;
  valor: string | number;
  dataVencimento: string;
  dataPagamento?: string | null;
  categoria?: string | null;
  status?: string;
}

export interface JanelaRecorte {
  /** YYYY-MM-DD de hoje no fuso de Brasília. */
  hoje: string;
  /** YYYY-MM-DD de hoje + 7 dias. */
  limite7: string;
  /** YYYY-MM do mês corrente. */
  mesAtual: string;
  /**
   * `true` quando a lista é a das QUITADAS (aba "Pagas"/"Recebidos"). É o que
   * decide qual data conta como "este mês".
   */
  quitadas: boolean;
}

/**
 * Numa lista de quitadas, "este mês" é PAGO este mês; numa lista em aberto, é
 * VENCE este mês. A mesma pergunta ("aconteceu este mês?") sobre a data que
 * de fato aconteceu.
 */
export function dataDoMes(r: LinhaRecortavel, quitadas: boolean): string {
  return String((quitadas ? r.dataPagamento : r.dataVencimento) ?? "");
}

/** Cada recorte guarda as próprias linhas: alimenta contagem, soma e lista. */
export function agruparRecortes<T extends LinhaRecortavel>(
  base: T[],
  j: JanelaRecorte,
): Record<RecorteId, T[]> {
  return {
    todas: base,
    vencidas: base.filter((r) => r.status === "vencido" || r.dataVencimento < j.hoje),
    prox7: base.filter((r) => r.dataVencimento >= j.hoje && r.dataVencimento <= j.limite7),
    // União de "vencidas" e "prox7" — o que precisa de dinheiro nesta semana.
    // É UM filtro, não a soma de dois: uma conta marcada "vencido" com data
    // futura cai nos dois recortes e aqui aparece UMA vez.
    urgentes: base.filter(
      (r) =>
        r.status === "vencido" ||
        r.dataVencimento < j.hoje ||
        (r.dataVencimento >= j.hoje && r.dataVencimento <= j.limite7),
    ),
    mes: base.filter((r) => dataDoMes(r, j.quitadas).startsWith(j.mesAtual)),
    "sem-categoria": base.filter((r) => !r.categoria || !String(r.categoria).trim()),
  };
}

/**
 * Ordena SEM empate possível: o id entra como último critério em todas as
 * ordens, então a mesma lista sai sempre igual — inclusive quando 5 contas
 * vencem no mesmo dia ou têm o mesmo valor.
 */
export function ordenarContas<T extends LinhaRecortavel>(rows: T[], ordem: OrdemLista): T[] {
  const desempate = (a: T, b: T) => String(a.id).localeCompare(String(b.id));
  const pag = (r: T) => String(r.dataPagamento ?? "");
  /**
   * Sem data de pagamento não é "a mais antiga": é DESCONHECIDA. Se ela
   * entrasse na comparação de texto, `""` viria antes de qualquer data em
   * `pag-asc` e uma conta sem data ocuparia o topo da lista. Vai para o fim
   * nas duas direções, e só então o desempate por id decide.
   */
  const semData = (a: T, b: T) => (pag(a) ? -1 : 1);
  return [...rows].sort((a, b) => {
    switch (ordem) {
      case "pag-desc":
        if (!pag(a) !== !pag(b)) return semData(a, b);
        return pag(b).localeCompare(pag(a)) || desempate(a, b);
      case "pag-asc":
        if (!pag(a) !== !pag(b)) return semData(a, b);
        return pag(a).localeCompare(pag(b)) || desempate(a, b);
      case "venc-desc":
        return String(b.dataVencimento).localeCompare(String(a.dataVencimento)) || desempate(a, b);
      case "valor-desc":
        return Number(b.valor) - Number(a.valor) || desempate(a, b);
      case "valor-asc":
        return Number(a.valor) - Number(b.valor) || desempate(a, b);
      default:
        return String(a.dataVencimento).localeCompare(String(b.dataVencimento)) || desempate(a, b);
    }
  });
}

/**
 * Diff puro entre um extrato parseado e o que já está no banco.
 *
 * Regra de negócio do cliente: o extrato bancário tem prioridade sempre.
 * Por isso a identidade de uma transação NÃO pode depender do valor — se o banco
 * corrigiu o valor de um lançamento, ele continua sendo o MESMO lançamento
 * (conflito a resolver), e não uma linha nova.
 *
 * Identidade, em ordem:
 *   1. mesma conta + mesmo `documento` (ID do CSV Conta/Titulares, FITID do OFX);
 *   2. sem documento, cai no dedupKey legado (data|histórico|documento|valor|tipo#ocorrência).
 *
 * Sem I/O: quem chama carrega os dados do banco e passa aqui.
 */

import type { ExtratoRow, ExtratoRowIgnorada, ExtratoRowNaoLida } from "./extrato-import";
import { normalizeHistorico } from "./extrato-import";

/**
 * `ignorada` = o leitor pulou DE PROPÓSITO (SALDO ANTERIOR, Realizado=Nao).
 * `nao-lida` = o leitor NAO CONSEGUIU LER. Sao coisas diferentes e por isso tem
 * nomes diferentes: a primeira e uma decisao, a segunda e uma falha que o
 * usuario precisa ver linha a linha.
 */
export type SituacaoLinha = "nova" | "duplicada" | "conflito" | "ignorada" | "nao-lida";

export interface CampoDiff {
  campo: string;
  de: string;
  para: string;
}

/** Movimentação já gravada em banco_movimentacoes (valores já convertidos). */
export interface MovExistente {
  id: string;
  data: string;
  historico: string;
  documento: string | null;
  valor: number;
  tipo: "C" | "D";
  dedupKey: string;
  ocorrencia?: number;
}

/** Lançamento de fonte manual (contas_pagar / receitas_dia / recebiveis) candidato a vínculo. */
export interface LancamentoVinculavel {
  tipo: "conta_pagar" | "receita_dia" | "recebivel";
  id: string;
  descricao: string;
  valor: number;
  /** Data de referência para o match (vencimento/pagamento/data). */
  data: string;
  /** "D" para contas a pagar, "C" para receitas e recebíveis. */
  fluxo: "C" | "D";
  status?: string | null;
  dataPagamento?: string | null;
}

export interface VinculoLinha {
  tipo: LancamentoVinculavel["tipo"];
  id: string;
  descricao: string;
  valor: number;
  data: string;
  diffs: CampoDiff[];
}

export interface LinhaPreview {
  idx: number;
  data: string | null;
  historico: string;
  documento: string | null;
  valor: number | null;
  tipo: "C" | "D" | null;
  categoria: string | null;
  dedupKey: string;
  situacao: SituacaoLinha;
  motivo?: string;
  /** Numero da linha no arquivo. So existe quando `situacao === "nao-lida"`. */
  linhaArquivo?: number;
  /**
   * De onde veio o conflito: a própria movimentação já gravada divergindo do
   * extrato, ou o lançamento manual vinculado (conta a pagar / receita).
   * Só existe quando `situacao === "conflito"`.
   */
  origemConflito?: "movimentacao" | "vinculo";
  existente?: { id: string; data: string; historico: string; valor: number; tipo: "C" | "D" };
  diffs?: CampoDiff[];
  vinculo?: VinculoLinha;
  /** Campos que o import repassa ao banco (não fazem parte do contrato de UI). */
  descricao?: string | null;
  forma?: "dinheiro" | "pix" | "cartao";
  syncReceita?: boolean;
  syncDespesa?: boolean;
  ocorrencia?: number;
}

export interface ResumoDiff {
  novas: number;
  duplicadas: number;
  conflitos: number;
  ignoradas: number;
  naoLidas: number;
}

export interface DiffOptions {
  /** Tolerância de valor para casar com lançamento manual. */
  toleranciaValor?: number;
  /** Janela de dias para casar com lançamento manual. */
  janelaDias?: number;
}

export function money(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

export function diasEntre(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  if (!Number.isFinite(da) || !Number.isFinite(db)) return Number.POSITIVE_INFINITY;
  return Math.round(Math.abs(da - db) / 86400000);
}

function fmtMoney(n: number): string {
  return money(n).toFixed(2);
}

/**
 * Compara a linha do extrato com a movimentação já gravada.
 * Retorna [] quando são idênticas (→ duplicada).
 */
export function diffLinhaVsExistente(row: ExtratoRow, mov: MovExistente): CampoDiff[] {
  const diffs: CampoDiff[] = [];
  if (money(mov.valor) !== money(row.valor)) {
    diffs.push({ campo: "valor", de: fmtMoney(mov.valor), para: fmtMoney(row.valor) });
  }
  if (mov.data !== row.data) {
    diffs.push({ campo: "data", de: mov.data, para: row.data });
  }
  if (normalizeHistorico(mov.historico) !== normalizeHistorico(row.historico)) {
    diffs.push({ campo: "historico", de: mov.historico, para: row.historico });
  }
  if (mov.tipo !== row.tipo) {
    diffs.push({ campo: "tipo", de: mov.tipo, para: row.tipo });
  }
  return diffs;
}

/** Índice das movimentações existentes por documento e por dedupKey. */
export interface IndiceExistentes {
  porDocumento: Map<string, MovExistente[]>;
  porDedupKey: Map<string, MovExistente>;
}

export function indexarExistentes(movs: MovExistente[]): IndiceExistentes {
  const porDocumento = new Map<string, MovExistente[]>();
  const porDedupKey = new Map<string, MovExistente>();
  for (const m of movs) {
    if (!porDedupKey.has(m.dedupKey)) porDedupKey.set(m.dedupKey, m);
    const doc = (m.documento ?? "").trim();
    if (!doc || doc === "0") continue;
    const lista = porDocumento.get(doc);
    if (lista) lista.push(m);
    else porDocumento.set(doc, [m]);
  }
  // Ordem estável: por data, depois id.
  for (const lista of porDocumento.values()) {
    lista.sort((a, b) => (a.data === b.data ? a.id.localeCompare(b.id) : a.data.localeCompare(b.data)));
  }
  return { porDocumento, porDedupKey };
}

/**
 * Procura o lançamento manual (conta a pagar / receita / recebível) que corresponde
 * à linha do extrato: mesmo valor (±tolerância) e data próxima (±janela).
 * Um lançamento só é usado uma vez (`usados`).
 */
export function acharVinculo(
  row: ExtratoRow,
  candidatos: LancamentoVinculavel[],
  usados: Set<string>,
  opts: DiffOptions = {},
): VinculoLinha | undefined {
  const tol = opts.toleranciaValor ?? 0.01;
  const janela = opts.janelaDias ?? 3;
  const alvo = money(row.valor);

  let melhor: { c: LancamentoVinculavel; dias: number; delta: number } | null = null;
  for (const c of candidatos) {
    const chave = `${c.tipo}:${c.id}`;
    if (usados.has(chave)) continue;
    if (c.fluxo !== row.tipo) continue;
    const delta = Math.abs(money(c.valor) - alvo);
    if (delta > tol) continue;
    const dias = diasEntre(row.data, c.data);
    if (dias > janela) continue;
    if (!melhor || dias < melhor.dias || (dias === melhor.dias && delta < melhor.delta)) {
      melhor = { c, dias, delta };
    }
  }
  if (!melhor) return undefined;

  const c = melhor.c;
  usados.add(`${c.tipo}:${c.id}`);

  const diffs: CampoDiff[] = [];
  if (money(c.valor) !== alvo) {
    diffs.push({ campo: "valor", de: fmtMoney(c.valor), para: fmtMoney(row.valor) });
  }
  if (c.data !== row.data) {
    diffs.push({ campo: "data", de: c.data, para: row.data });
  }
  if (c.tipo === "conta_pagar") {
    if ((c.status ?? "") !== "pago") {
      diffs.push({ campo: "status", de: c.status ?? "", para: "pago" });
    }
    if ((c.dataPagamento ?? "") !== row.data) {
      diffs.push({ campo: "dataPagamento", de: c.dataPagamento ?? "", para: row.data });
    }
  }
  if (c.tipo === "recebivel" && (c.status ?? "") !== "paga") {
    diffs.push({ campo: "status", de: c.status ?? "", para: "paga" });
  }

  return { tipo: c.tipo, id: c.id, descricao: c.descricao, valor: money(c.valor), data: c.data, diffs };
}

export interface ClassificarInput {
  rows: ExtratoRow[];
  ignoradas?: ExtratoRowIgnorada[];
  naoLidas?: ExtratoRowNaoLida[];
  existentes: MovExistente[];
  vinculaveis?: LancamentoVinculavel[];
  opts?: DiffOptions;
}

export interface ClassificarResult {
  linhas: LinhaPreview[];
  resumo: ResumoDiff;
}

/**
 * Classifica cada linha do extrato em nova / duplicada / conflito / ignorada.
 * Puro: nada de I/O, nada de Express.
 */
export function classificarLinhas(input: ClassificarInput): ClassificarResult {
  const { rows, ignoradas = [], naoLidas = [], existentes, vinculaveis = [], opts = {} } = input;
  const indice = indexarExistentes(existentes);
  const usadosDoc = new Map<string, number>();
  const usadosMovId = new Set<string>();
  const usadosVinculo = new Set<string>();

  const linhas: LinhaPreview[] = [];

  for (const row of rows) {
    const doc = (row.documento ?? "").trim();
    let existente: MovExistente | undefined;

    if (doc && doc !== "0") {
      const lista = indice.porDocumento.get(doc);
      if (lista && lista.length) {
        const usados = usadosDoc.get(doc) ?? 0;
        // Mesma conta + mesmo documento = MESMA transação, mesmo que o valor tenha mudado.
        if (usados < lista.length) {
          existente = lista[usados];
          usadosDoc.set(doc, usados + 1);
        }
      }
    }
    // Sem documento (ou documento inédito): cai na chave legada.
    if (!existente) {
      const porKey = indice.porDedupKey.get(row.dedupKey);
      if (porKey && !usadosMovId.has(porKey.id)) existente = porKey;
    }

    const linha: LinhaPreview = {
      idx: linhas.length,
      data: row.data,
      historico: row.historico,
      documento: row.documento ?? null,
      valor: money(row.valor),
      tipo: row.tipo,
      categoria: row.categoria ?? null,
      dedupKey: row.dedupKey,
      situacao: "nova",
      descricao: row.descricao ?? null,
      forma: row.forma,
      syncReceita: row.syncReceita,
      syncDespesa: row.syncDespesa,
      ocorrencia: row.ocorrencia,
    };

    // O vínculo é procurado ANTES de decidir a situação: uma linha já importada
    // cujo lançamento manual (conta a pagar / receita) está divergente do banco
    // continua sendo uma decisão do usuário — logo, conflito, e não duplicada.
    const vinculo = acharVinculo(row, vinculaveis, usadosVinculo, opts);
    if (vinculo) linha.vinculo = vinculo;
    const vinculoDivergente = (vinculo?.diffs.length ?? 0) > 0;

    if (existente) {
      usadosMovId.add(existente.id);
      const diffs = diffLinhaVsExistente(row, existente);
      linha.existente = {
        id: existente.id,
        data: existente.data,
        historico: existente.historico,
        valor: money(existente.valor),
        tipo: existente.tipo,
      };
      if (diffs.length > 0) {
        linha.situacao = "conflito";
        linha.origemConflito = "movimentacao";
        linha.diffs = diffs;
        linha.motivo = doc
          ? `Mesmo documento (${doc}) com dados diferentes — o extrato manda.`
          : "Lançamento equivalente já importado com dados diferentes.";
      } else if (vinculoDivergente) {
        linha.situacao = "conflito";
        linha.origemConflito = "vinculo";
        // Sem diffs de movimentação: o que diverge está no lançamento vinculado.
        linha.motivo =
          "Já importada, mas a conta a pagar / receita vinculada está divergente do banco — o extrato manda.";
      } else {
        linha.situacao = "duplicada";
        linha.motivo = "Já importada, idêntica.";
      }
    }

    linhas.push(linha);
  }

  for (const ig of ignoradas) {
    linhas.push({
      idx: linhas.length,
      data: ig.data,
      historico: ig.historico,
      documento: ig.documento,
      valor: ig.valor,
      tipo: ig.tipo,
      categoria: null,
      dedupKey: "",
      situacao: "ignorada",
      motivo: ig.motivo,
    });
  }

  // Linha que o leitor nao conseguiu ler: entra na lista com o conteudo cru e o
  // motivo. Antes ela nao entrava em lugar nenhum e sumia do balanco.
  for (const nl of naoLidas) {
    linhas.push({
      idx: linhas.length,
      data: null,
      historico: nl.conteudo,
      documento: null,
      valor: null,
      tipo: null,
      categoria: null,
      dedupKey: "",
      situacao: "nao-lida",
      motivo: nl.motivo,
      linhaArquivo: nl.linha,
    });
  }

  // Reordena pela ordem de leitura do arquivo quando disponível.
  const seqPorDedup = new Map<string, number>();
  rows.forEach((r, i) => seqPorDedup.set(r.dedupKey, r.seq ?? i));
  const ordem = new Map<LinhaPreview, number>();
  let iIg = 0;
  let iNl = 0;
  for (const l of linhas) {
    if (l.situacao === "ignorada") {
      ordem.set(l, ignoradas[iIg]?.seq ?? Number.MAX_SAFE_INTEGER);
      iIg++;
    } else if (l.situacao === "nao-lida") {
      ordem.set(l, naoLidas[iNl]?.seq ?? Number.MAX_SAFE_INTEGER);
      iNl++;
    } else {
      ordem.set(l, seqPorDedup.get(l.dedupKey) ?? Number.MAX_SAFE_INTEGER);
    }
  }
  linhas.sort((a, b) => (ordem.get(a)! - ordem.get(b)!) || a.idx - b.idx);
  linhas.forEach((l, i) => {
    l.idx = i;
  });

  const resumo: ResumoDiff = { novas: 0, duplicadas: 0, conflitos: 0, ignoradas: 0, naoLidas: 0 };
  for (const l of linhas) {
    if (l.situacao === "nova") resumo.novas++;
    else if (l.situacao === "duplicada") resumo.duplicadas++;
    else if (l.situacao === "conflito") resumo.conflitos++;
    else if (l.situacao === "nao-lida") resumo.naoLidas++;
    else resumo.ignoradas++;
  }

  return { linhas, resumo };
}

/** Período coberto pelas linhas válidas. */
export function periodoDe(rows: ExtratoRow[]): { de: string | null; ate: string | null } {
  let de: string | null = null;
  let ate: string | null = null;
  for (const r of rows) {
    if (!de || r.data < de) de = r.data;
    if (!ate || r.data > ate) ate = r.data;
  }
  return { de, ate };
}

export function totaisDe(rows: ExtratoRow[]): {
  creditos: { n: number; soma: number };
  debitos: { n: number; soma: number };
} {
  const creditos = { n: 0, soma: 0 };
  const debitos = { n: 0, soma: 0 };
  for (const r of rows) {
    if (r.tipo === "C") {
      creditos.n++;
      creditos.soma += money(r.valor);
    } else {
      debitos.n++;
      debitos.soma += money(r.valor);
    }
  }
  creditos.soma = money(creditos.soma);
  debitos.soma = money(debitos.soma);
  return { creditos, debitos };
}

/**
 * Conferência de fechamento do extrato — o controle mais barato e mais valioso
 * que existe para arquivo bancário, e que nenhum concorrente faz no preview:
 * a soma dos créditos menos a dos débitos TEM que dar a variação do saldo do
 * próprio arquivo. Se não der, o arquivo veio truncado, foi editado à mão ou
 * tem linha que o leitor não entendeu — e o usuário precisa saber ANTES de
 * gravar, não depois de sobrescrever o que estava certo.
 */
export function conferirFechamentoExtrato(e: {
  creditos: number;
  debitos: number;
  saldoInicial: number;
  saldoFinal: number;
}): {
  movimento: number;
  variacao: number;
  diferenca: number;
  bate: boolean;
} {
  const movimento = money(e.creditos - e.debitos);
  const variacao = money(e.saldoFinal - e.saldoInicial);
  const diferenca = money(movimento - variacao);
  // Meio centavo de folga cobre arredondamento binário, não erro de verdade.
  return { movimento, variacao, diferenca, bate: Math.abs(diferenca) < 0.005 };
}

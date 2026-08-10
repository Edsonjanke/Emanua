/**
 * Parser da planilha "Entradas e Saídas" (aba Movimentações).
 * Colunas esperadas (header na 1ª linha):
 *   Data | Mês | Conta | Fonte | Tipo | Descrição | Categoria | Subcategoria |
 *   Entrada (R$) | Saída (R$) | Valor líquido (R$) | Saldo após (R$) | Observação
 */
import * as XLSX from "xlsx";

export type PlanilhaTipo = "Entrada" | "Saida";

export interface PlanilhaMovRow {
  data: string; // YYYY-MM-DD
  mes: string | null; // YYYY-MM
  conta: string;
  fonte: string | null;
  tipo: PlanilhaTipo;
  descricao: string;
  categoria: string | null;
  subcategoria: string | null;
  entrada: number;
  saida: number;
  valorLiquido: number;
  observacao: string | null;
  /** Chave de dedup estável para reimport. */
  dedupKey: string;
}

export interface PlanilhaParseResult {
  sheetName: string;
  rows: PlanilhaMovRow[];
  erros: string[];
  resumo: {
    total: number;
    entradas: number;
    saidas: number;
    receitaOperacional: number;
    porConta: Record<string, number>;
    porCategoria: Record<string, number>;
  };
}

function normHeader(s: unknown): string {
  return String(s ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function excelDateToIso(v: unknown): string | null {
  if (v == null || v === "") return null;
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const y = v.getFullYear();
    const m = String(v.getMonth() + 1).padStart(2, "0");
    const d = String(v.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  if (typeof v === "number" && Number.isFinite(v)) {
    // Excel serial (dias desde 1899-12-30)
    const epoch = Date.UTC(1899, 11, 30);
    const ms = epoch + Math.round(v) * 86400000;
    const dt = new Date(ms);
    const y = dt.getUTCFullYear();
    const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
    const d = String(dt.getUTCDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  }
  const s = String(v).trim();
  const br = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (br) return `${br[3]}-${br[2].padStart(2, "0")}-${br[1].padStart(2, "0")}`;
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

function toNumber(v: unknown): number {
  if (v == null || v === "") return 0;
  if (typeof v === "number" && Number.isFinite(v)) return v;
  const s = String(v).trim().replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

function findCol(headers: string[], ...candidates: string[]): number {
  for (const c of candidates) {
    const i = headers.findIndex((h) => h === c || h.includes(c));
    if (i >= 0) return i;
  }
  return -1;
}

export function buildPlanilhaDedupKey(row: {
  data: string;
  conta: string;
  tipo: PlanilhaTipo;
  descricao: string;
  entrada: number;
  saida: number;
  ocorrencia: number;
}): string {
  const desc = row.descricao.trim().replace(/\s+/g, " ").toUpperCase();
  const valor = row.tipo === "Entrada" ? row.entrada : row.saida;
  return `${row.data}|${row.conta}|${row.tipo}|${desc}|${valor.toFixed(2)}#${row.ocorrencia}`;
}

/** Mapeia categoria da planilha → categoria de contas a pagar do app. */
export function mapCategoriaPagar(categoria: string | null): string {
  const c = (categoria ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (c.includes("aliment") || c.includes("mercado")) return "Outros";
  if (c.includes("compra") || c.includes("fornecedor") || c.includes("insumo")) return "Insumos";
  if (c.includes("espaco") || c.includes("aluguel") || c.includes("diego")) return "Aluguel";
  if (c.includes("moradia") || c.includes("energia") || c.includes("utilidad")) return "Energia";
  if (c.includes("agua")) return "Água";
  if (c.includes("internet") || c.includes("comunic")) return "Internet";
  if (c.includes("pro-labore") || c.includes("prolabore") || c.includes("pessoal")) return "Pessoal";
  if (c.includes("das") || c.includes("imposto")) return "DAS";
  if (c.includes("marketing")) return "Marketing";
  if (c.includes("contab")) return "Contabilidade";
  if (c.includes("financeiro") || c.includes("tarifa") || c.includes("cartao")) return "Outros";
  return "Outros";
}

/** Forma de pagamento sugerida para receita operacional. */
export function inferFormaReceita(conta: string, descricao: string): "dinheiro" | "pix" | "cartao" {
  const blob = `${conta} ${descricao}`.toUpperCase();
  if (/INFINITE|CLOUDWALK|CARTAO|CARTÃO|DEBITO|CR[EÉ]DITO/.test(blob) && !/PIX/.test(blob)) {
    return "cartao";
  }
  if (/PIX|CREDITO PIX|CR[EÉ]DITO PIX/.test(blob)) return "pix";
  if (/INFINITE|CLOUDWALK/.test(blob)) return "cartao";
  return "dinheiro";
}

export function isReceitaOperacional(categoria: string | null): boolean {
  const c = (categoria ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return c.includes("receita operacional");
}

export function isTransferenciaInterna(categoria: string | null): boolean {
  const c = (categoria ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return c.includes("transferencia interna");
}

export function parsePlanilhaMovimentacoesRows(matrix: unknown[][]): PlanilhaParseResult {
  const erros: string[] = [];
  const rows: PlanilhaMovRow[] = [];
  if (!matrix.length) {
    return {
      sheetName: "",
      rows,
      erros: ["Planilha vazia."],
      resumo: emptyResumo(),
    };
  }

  const headers = matrix[0].map(normHeader);
  const iData = findCol(headers, "data");
  const iMes = findCol(headers, "mes");
  const iConta = findCol(headers, "conta");
  const iFonte = findCol(headers, "fonte");
  const iTipo = findCol(headers, "tipo");
  const iDesc = findCol(headers, "descricao", "descri");
  const iCat = findCol(headers, "categoria");
  const iSub = findCol(headers, "subcategoria", "subcateg");
  const iEnt = findCol(headers, "entrada");
  const iSai = findCol(headers, "saida");
  const iLiq = findCol(headers, "valor liquido", "liquido");
  const iObs = findCol(headers, "observacao", "observa");

  if (iData < 0 || iTipo < 0 || iDesc < 0) {
    return {
      sheetName: "",
      rows,
      erros: ["Cabeçalho inválido: precisa de Data, Tipo e Descrição."],
      resumo: emptyResumo(),
    };
  }

  const contagem = new Map<string, number>();

  for (let n = 1; n < matrix.length; n++) {
    const raw = matrix[n] ?? [];
    if (!raw.length || raw.every((c) => c == null || String(c).trim() === "")) continue;

    const data = excelDateToIso(raw[iData]);
    const tipoRaw = String(raw[iTipo] ?? "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .trim()
      .toLowerCase();
    let tipo: PlanilhaTipo | null = null;
    if (tipoRaw.startsWith("entrada")) tipo = "Entrada";
    else if (tipoRaw.startsWith("saida")) tipo = "Saida";

    const descricao = String(raw[iDesc] ?? "").trim();
    const conta = String(iConta >= 0 ? raw[iConta] ?? "Conta" : "Conta").trim() || "Conta";
    const entrada = iEnt >= 0 ? toNumber(raw[iEnt]) : 0;
    const saida = iSai >= 0 ? toNumber(raw[iSai]) : 0;

    if (!data || !tipo || !descricao) {
      erros.push(`Linha ${n + 1} ignorada (data/tipo/descrição inválidos).`);
      continue;
    }
    if (tipo === "Entrada" && entrada <= 0 && saida <= 0) {
      // tenta líquido positivo
      const liq = iLiq >= 0 ? toNumber(raw[iLiq]) : 0;
      if (liq <= 0) {
        erros.push(`Linha ${n + 1} ignorada (entrada sem valor).`);
        continue;
      }
    }

    const ent = tipo === "Entrada" ? entrada || Math.abs(iLiq >= 0 ? toNumber(raw[iLiq]) : 0) : 0;
    const sai = tipo === "Saida" ? saida || Math.abs(iLiq >= 0 ? toNumber(raw[iLiq]) : 0) : 0;
    if ((tipo === "Entrada" && ent <= 0) || (tipo === "Saida" && sai <= 0)) {
      erros.push(`Linha ${n + 1} ignorada (valor zerado).`);
      continue;
    }

    const base = `${data}|${conta}|${tipo}|${descricao.toUpperCase()}|${(tipo === "Entrada" ? ent : sai).toFixed(2)}`;
    const ocorrencia = (contagem.get(base) ?? 0) + 1;
    contagem.set(base, ocorrencia);

    const mesRaw = iMes >= 0 ? raw[iMes] : null;
    let mes: string | null = null;
    if (typeof mesRaw === "string" && /^\d{4}-\d{2}/.test(mesRaw)) mes = mesRaw.slice(0, 7);
    else if (mesRaw instanceof Date) {
      mes = `${mesRaw.getFullYear()}-${String(mesRaw.getMonth() + 1).padStart(2, "0")}`;
    } else mes = data.slice(0, 7);

    rows.push({
      data,
      mes,
      conta,
      fonte: iFonte >= 0 && raw[iFonte] != null ? String(raw[iFonte]) : null,
      tipo,
      descricao,
      categoria: iCat >= 0 && raw[iCat] != null ? String(raw[iCat]) : null,
      subcategoria: iSub >= 0 && raw[iSub] != null ? String(raw[iSub]) : null,
      entrada: ent,
      saida: sai,
      valorLiquido: iLiq >= 0 ? toNumber(raw[iLiq]) : tipo === "Entrada" ? ent : -sai,
      observacao: iObs >= 0 && raw[iObs] != null ? String(raw[iObs]) : null,
      dedupKey: buildPlanilhaDedupKey({
        data,
        conta,
        tipo,
        descricao,
        entrada: ent,
        saida: sai,
        ocorrencia,
      }),
    });
  }

  return {
    sheetName: "Movimentacoes",
    rows,
    erros,
    resumo: buildResumo(rows),
  };
}

export function parsePlanilhaMovimentacoesBuffer(buf: Buffer | ArrayBuffer | Uint8Array): PlanilhaParseResult {
  const data = Buffer.isBuffer(buf) ? buf : Buffer.from(buf as ArrayBuffer);
  const wb = XLSX.read(data, { type: "buffer", cellDates: true });
  const sheetName =
    wb.SheetNames.find((n) => /moviment/i.test(n.normalize("NFD").replace(/[\u0300-\u036f]/g, ""))) ??
    wb.SheetNames[0];
  if (!sheetName) {
    return { sheetName: "", rows: [], erros: ["Nenhuma aba encontrada."], resumo: emptyResumo() };
  }
  const matrix = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
    header: 1,
    defval: null,
    raw: true,
  }) as unknown[][];
  const parsed = parsePlanilhaMovimentacoesRows(matrix);
  parsed.sheetName = sheetName;
  return parsed;
}

function emptyResumo() {
  return {
    total: 0,
    entradas: 0,
    saidas: 0,
    receitaOperacional: 0,
    porConta: {} as Record<string, number>,
    porCategoria: {} as Record<string, number>,
  };
}

function buildResumo(rows: PlanilhaMovRow[]) {
  const r = emptyResumo();
  r.total = rows.length;
  for (const row of rows) {
    if (row.tipo === "Entrada") r.entradas++;
    else r.saidas++;
    if (row.tipo === "Entrada" && isReceitaOperacional(row.categoria)) r.receitaOperacional++;
    r.porConta[row.conta] = (r.porConta[row.conta] ?? 0) + 1;
    const cat = row.categoria || "(sem categoria)";
    r.porCategoria[cat] = (r.porCategoria[cat] ?? 0) + 1;
  }
  return r;
}

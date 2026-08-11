/**
 * Parser do CSV Gendo de contas a pagar:
 * Data;Vencimento;Comanda;Responsável;Categoria;Descrição;Realizado;Valor;Forma Pagto.
 */
import { parseBrNumber, parseBrDate } from "./parse-br";
import { splitCsvSemi } from "./extrato-import";
import { mapCategoriaPagar } from "./planilha-movimentacoes-import";

export interface ContaPagarImportRow {
  data: string;
  dataVencimento: string;
  descricao: string;
  categoria: string;
  valor: number;
  status: "pendente" | "pago" | "vencido";
  dataPagamento: string | null;
  observacoes: string | null;
  importDedupKey: string;
}

export interface ContaPagarParseResult {
  rows: ContaPagarImportRow[];
  erros: string[];
  resumo: { total: number; pagas: number; pendentes: number; vencidas: number };
}

function normHeaderCell(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['"]/g, "")
    .trim();
}

function isRealizadoSim(raw: string): boolean {
  const r = normHeaderCell(raw);
  return r === "sim" || r === "s" || r === "yes" || r === "true" || r === "1" || r === "pago";
}

export function isGendoContasPagarHeader(campos: string[]): boolean {
  const h = campos.map(normHeaderCell);
  const hasForma = h.some((x) => x.includes("forma") && x.includes("pag"));
  return (
    h.includes("data") &&
    h.includes("vencimento") &&
    h.includes("categoria") &&
    h.includes("valor") &&
    (hasForma || h.includes("realizado"))
  );
}

export function buildContaPagarDedupKey(row: {
  dataVencimento: string;
  descricao: string;
  valor: number;
  categoria: string;
  ocorrencia: number;
}): string {
  const desc = row.descricao.trim().replace(/\s+/g, " ").toUpperCase();
  return `cp:${row.dataVencimento}|${desc}|${row.valor.toFixed(2)}|${row.categoria}#${row.ocorrencia}`;
}

export function parseGendoContasPagarCsv(
  texto: string,
  hojeIso?: string,
): ContaPagarParseResult {
  const erros: string[] = [];
  const rows: ContaPagarImportRow[] = [];
  const hoje = hojeIso ?? new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
  const linhas = texto.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!linhas.length) return { rows, erros: ["CSV vazio."], resumo: emptyResumo() };

  const headerCols = splitCsvSemi(linhas[0]).map(normHeaderCell);
  if (!isGendoContasPagarHeader(splitCsvSemi(linhas[0]))) {
    return {
      rows,
      erros: ["Cabeçalho inválido: espere Data, Vencimento, Categoria, Descrição, Realizado, Valor (Gendo contas)."],
      resumo: emptyResumo(),
    };
  }

  const iData = headerCols.findIndex((h) => h === "data");
  const iVenc = headerCols.findIndex((h) => h === "vencimento");
  const iCat = headerCols.findIndex((h) => h === "categoria");
  const iDesc = headerCols.findIndex((h) => h.startsWith("descri"));
  const iReal = headerCols.findIndex((h) => h === "realizado");
  const iValor = headerCols.findIndex((h) => h === "valor");
  const iForma = headerCols.findIndex((h) => h.includes("forma"));

  const contagem = new Map<string, number>();

  for (let n = 1; n < linhas.length; n++) {
    const campos = splitCsvSemi(linhas[n]);
    const data = parseBrDate(campos[iData] ?? "") ?? parseBrDate(campos[iVenc] ?? "");
    const dataVencimento = parseBrDate(campos[iVenc] ?? "") ?? data;
    const categoriaRaw = (iCat >= 0 ? campos[iCat] : "") || "";
    const descricao = ((iDesc >= 0 ? campos[iDesc] : "") || categoriaRaw || "Despesa").trim();
    const signed = parseBrNumber(campos[iValor] ?? "");
    const realizado = iReal >= 0 ? isRealizadoSim(campos[iReal] ?? "") : false;
    const forma = iForma >= 0 && campos[iForma] ? String(campos[iForma]).trim() : "";

    if (!dataVencimento || !descricao || signed == null || signed === 0) {
      erros.push(`Linha ${n + 1} ignorada (vencimento/descrição/valor inválidos).`);
      continue;
    }

    // Contas a pagar: valor sempre positivo; CSV traz negativo.
    const valor = Math.abs(signed);
    const categoria = mapCategoriaPagar(categoriaRaw);
    const chaveBase = `${dataVencimento}|${descricao.toUpperCase()}|${valor.toFixed(2)}|${categoria}`;
    const ocorrencia = (contagem.get(chaveBase) ?? 0) + 1;
    contagem.set(chaveBase, ocorrencia);

    let status: "pendente" | "pago" | "vencido" = "pendente";
    let dataPagamento: string | null = null;
    if (realizado) {
      status = "pago";
      dataPagamento = data ?? dataVencimento;
    } else if (dataVencimento < hoje) {
      status = "vencido";
    }

    const obsParts = [categoriaRaw, forma].filter((x) => x && x !== "--");
    rows.push({
      data: data ?? dataVencimento,
      dataVencimento,
      descricao: descricao.slice(0, 200),
      categoria,
      valor,
      status,
      dataPagamento,
      observacoes: obsParts.length ? obsParts.join(" · ").slice(0, 500) : null,
      importDedupKey: buildContaPagarDedupKey({
        dataVencimento,
        descricao,
        valor,
        categoria,
        ocorrencia,
      }),
    });
  }

  return { rows, erros, resumo: buildResumo(rows) };
}

function emptyResumo() {
  return { total: 0, pagas: 0, pendentes: 0, vencidas: 0 };
}

function buildResumo(rows: ContaPagarImportRow[]) {
  const r = emptyResumo();
  r.total = rows.length;
  for (const row of rows) {
    if (row.status === "pago") r.pagas++;
    else if (row.status === "vencido") r.vencidas++;
    else r.pendentes++;
  }
  return r;
}

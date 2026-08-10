import { parseBrNumber, parseBrDate } from "./parse-br";

export interface ExtratoHeader {
  agencia: string;
  conta: string;
}

export interface ExtratoRow {
  data: string;
  historico: string;
  documento: string | null;
  valor: number;
  tipo: "C" | "D";
  ocorrencia: number;
  dedupKey: string;
  /** Metadados Gendo — sync com receitas/despesas no import. */
  categoria?: string | null;
  descricao?: string | null;
  forma?: "dinheiro" | "pix" | "cartao";
  syncReceita?: boolean;
  syncDespesa?: boolean;
}

export interface ExtratoParseResult {
  header: ExtratoHeader | null;
  rows: ExtratoRow[];
  erros: string[];
  /** Formato detectado (para UI). */
  formato?: "viacredi" | "gendo-transacoes";
  /** Linhas Realizado=Não ignoradas no extrato (só Gendo). */
  ignoradasNaoRealizadas?: number;
}

export function normalizeHistorico(s: string): string {
  return s.trim().replace(/\s+/g, " ").toUpperCase();
}

export function buildDedupKey(
  data: string,
  historicoNorm: string,
  documento: string | null,
  valor: number,
  tipo: "C" | "D",
  ocorrencia: number,
): string {
  return `${data}|${historicoNorm}|${documento ?? ""}|${valor.toFixed(2)}|${tipo}#${ocorrencia}`;
}

/** Split CSV com `;` e aspas opcionais. */
export function splitCsvSemi(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
      continue;
    }
    if (ch === ";" && !inQuotes) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  out.push(cur);
  return out.map((c) => c.trim());
}

function normHeaderCell(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['"]/g, "")
    .trim();
}

function isGendoTransacoesHeader(campos: string[]): boolean {
  const h = campos.map(normHeaderCell);
  return h.includes("data") && h.includes("categoria") && h.includes("realizado") && h.includes("valor");
}

function inferFormaGendo(descricao: string): "dinheiro" | "pix" | "cartao" {
  const d = descricao
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (d.includes("pix")) return "pix";
  if (d.includes("cartao") || d.includes("credito") || d.includes("debito")) return "cartao";
  return "dinheiro";
}

function isReceitaGendo(categoria: string): boolean {
  const c = categoria
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return c.includes("pagamento") || c.includes("receita") || c.includes("venda");
}

/**
 * CSV Gendo / agenda: Data;Vencimento;Comanda;Responsável;Categoria;Descrição;Realizado;Valor
 * Só Realizado=Sim entra no extrato. Valor negativo = débito.
 */
export function parseGendoTransacoesCsv(texto: string): ExtratoParseResult {
  const erros: string[] = [];
  const rows: ExtratoRow[] = [];
  let ignoradasNaoRealizadas = 0;
  const linhas = texto.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (!linhas.length) return { header: null, rows, erros: ["CSV vazio."], formato: "gendo-transacoes" };

  const headerCols = splitCsvSemi(linhas[0]).map(normHeaderCell);
  const iData = headerCols.findIndex((h) => h === "data");
  const iCat = headerCols.findIndex((h) => h === "categoria");
  const iDesc = headerCols.findIndex((h) => h.startsWith("descri"));
  const iReal = headerCols.findIndex((h) => h === "realizado");
  const iValor = headerCols.findIndex((h) => h === "valor");
  const iComanda = headerCols.findIndex((h) => h === "comanda");
  const iVenc = headerCols.findIndex((h) => h === "vencimento");

  if (iData < 0 || iValor < 0 || iDesc < 0) {
    return {
      header: null,
      rows,
      erros: ["Cabeçalho Gendo inválido (precisa Data, Descrição e Valor)."],
      formato: "gendo-transacoes",
    };
  }

  const contagem = new Map<string, number>();

  for (let n = 1; n < linhas.length; n++) {
    const campos = splitCsvSemi(linhas[n]);
    const realizado = iReal >= 0 ? normHeaderCell(campos[iReal] ?? "") : "sim";
    if (realizado === "nao" || realizado === "não") {
      ignoradasNaoRealizadas++;
      continue;
    }
    if (realizado && realizado !== "sim") {
      if (!["s", "yes", "true", "1", "pago"].includes(realizado)) {
        ignoradasNaoRealizadas++;
        continue;
      }
    }

    const data = parseBrDate(campos[iData] ?? "") ?? (iVenc >= 0 ? parseBrDate(campos[iVenc] ?? "") : null);
    const categoria = (iCat >= 0 ? campos[iCat] : "") || "";
    const descricao = campos[iDesc] ?? "";
    const historico = normalizeHistorico(
      [categoria, descricao].filter((x) => x && x !== "--").join(" - ") || descricao || categoria,
    );
    const comanda = iComanda >= 0 ? (campos[iComanda] ?? "").trim() : "";
    const documento = comanda && comanda !== "0" ? `comanda:${comanda}` : null;
    const signed = parseBrNumber((campos[iValor] ?? "").replace(/^"|"$/g, ""));

    if (!data || !historico || signed == null || signed === 0) {
      erros.push(`Linha ${n + 1} ignorada (data/descrição/valor inválidos).`);
      continue;
    }

    const tipo: "C" | "D" = signed > 0 ? "C" : "D";
    const valor = Math.abs(signed);

    const chaveBase = `${data}|${historico}|${documento ?? ""}|${valor.toFixed(2)}|${tipo}`;
    const ocorrencia = (contagem.get(chaveBase) ?? 0) + 1;
    contagem.set(chaveBase, ocorrencia);

    rows.push({
      data,
      historico,
      documento,
      valor,
      tipo,
      ocorrencia,
      dedupKey: buildDedupKey(data, historico, documento, valor, tipo, ocorrencia),
      categoria: categoria || null,
      descricao: descricao || null,
      forma: tipo === "C" ? inferFormaGendo(descricao) : undefined,
      syncReceita: tipo === "C" && isReceitaGendo(categoria),
      syncDespesa: tipo === "D",
    });
  }

  return {
    header: { agencia: "gendo", conta: "transacoes" },
    rows,
    erros,
    formato: "gendo-transacoes",
    ignoradasNaoRealizadas,
  };
}

export function parseExtratoCsv(texto: string): ExtratoParseResult {
  const limpo = texto.replace(/^\uFEFF/, "");
  const linhas = limpo.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (linhas.length === 0) {
    return { header: null, rows: [], erros: ["CSV vazio."] };
  }

  const first = splitCsvSemi(linhas[0]);
  if (isGendoTransacoesHeader(first)) {
    return parseGendoTransacoesCsv(limpo);
  }

  const erros: string[] = [];
  const rows: ExtratoRow[] = [];
  let header: ExtratoHeader | null = null;

  let inicio = 0;
  if (!/^\d{2}\/\d{2}\//.test(linhas[0].trim().replace(/^"/, ""))) {
    const campos = splitCsvSemi(linhas[0]);
    if (campos[0] && campos[2]) {
      header = { agencia: campos[0], conta: campos[2] };
    }
    inicio = 1;
  }

  const contagem = new Map<string, number>();

  for (let n = inicio; n < linhas.length; n++) {
    const campos = splitCsvSemi(linhas[n]);
    if (campos.length < 5) {
      erros.push(`Linha ${n + 1} ignorada (menos de 5 campos).`);
      continue;
    }

    const data = parseBrDate(campos[0]);
    const historico = normalizeHistorico(campos[1] ?? "");
    const docRaw = (campos[2] ?? "").trim();
    const documento = docRaw.length > 0 ? docRaw : null;
    const valor = parseBrNumber(campos[3]);
    const tipoRaw = (campos[4] ?? "").trim().toUpperCase();

    if (!data || !historico || valor == null || valor <= 0 || (tipoRaw !== "C" && tipoRaw !== "D")) {
      erros.push(`Linha ${n + 1} ignorada (data/histórico/valor/tipo inválidos).`);
      continue;
    }
    const tipo = tipoRaw as "C" | "D";

    const chaveBase = `${data}|${historico}|${documento ?? ""}|${valor.toFixed(2)}|${tipo}`;
    const ocorrencia = (contagem.get(chaveBase) ?? 0) + 1;
    contagem.set(chaveBase, ocorrencia);

    rows.push({
      data,
      historico,
      documento,
      valor,
      tipo,
      ocorrencia,
      dedupKey: buildDedupKey(data, historico, documento, valor, tipo, ocorrencia),
    });
  }

  return { header, rows, erros, formato: "viacredi" };
}

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

export type ExtratoFormato = "viacredi" | "gendo-transacoes" | "conta-titulares" | "ofx";

export interface ExtratoParseResult {
  header: ExtratoHeader | null;
  rows: ExtratoRow[];
  erros: string[];
  /** Formato detectado (para UI). */
  formato?: ExtratoFormato;
  /** Linhas Realizado=Não ignoradas no extrato (só Gendo). */
  ignoradasNaoRealizadas?: number;
  /** Titular / nome sugerido para a conta. */
  titular?: string | null;
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

function isContaTitularesHeaderRow(campos: string[]): boolean {
  const h = campos.map(normHeaderCell);
  return h.includes("id") && h.includes("titulo") && h.includes("valor") && h.includes("tipo");
}

function isContaTitularesCsv(texto: string): boolean {
  const linhas = texto.replace(/^\uFEFF/, "").split(/\r?\n/);
  const first = (linhas[0] ?? "").trim();
  if (/^conta;/i.test(first)) return true;
  return linhas.some((l) => isContaTitularesHeaderRow(splitCsvSemi(l)));
}

function isOfxText(texto: string): boolean {
  const t = texto.slice(0, 800).toUpperCase();
  return t.includes("OFXHEADER") || t.includes("<OFX>") || t.includes("<STMTTRN>");
}

function parseOfxDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const compact = s.trim().match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) return `${compact[1]}-${compact[2]}-${compact[3]}`;
  return parseBrDate(s);
}

function ofxTag(block: string, tag: string): string | null {
  const re = new RegExp(`<${tag}>([^<\\r\\n]*)`, "i");
  const m = block.match(re);
  return m ? m[1].trim() : null;
}

function isSaldoAnterior(titulo: string, tipo?: string): boolean {
  const t = normHeaderCell(titulo);
  const tipoN = tipo ? normHeaderCell(tipo) : "";
  if (tipoN === "todos") return true;
  return t.includes("saldo anterior") || t === "saldo";
}

function inferFormaHistorico(historico: string): "dinheiro" | "pix" | "cartao" {
  const d = historico
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  if (d.includes("pix")) return "pix";
  if (d.includes("cartao") || d.includes("credito") || d.includes("debito")) return "cartao";
  return "dinheiro";
}

function inferFormaGendo(descricao: string): "dinheiro" | "pix" | "cartao" {
  return inferFormaHistorico(descricao);
}

function isReceitaGendo(categoria: string): boolean {
  const c = categoria
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
  return c.includes("pagamento") || c.includes("receita") || c.includes("venda");
}

function pushRow(
  rows: ExtratoRow[],
  contagem: Map<string, number>,
  partial: Omit<ExtratoRow, "ocorrencia" | "dedupKey">,
) {
  const chaveBase = `${partial.data}|${partial.historico}|${partial.documento ?? ""}|${partial.valor.toFixed(2)}|${partial.tipo}`;
  const ocorrencia = (contagem.get(chaveBase) ?? 0) + 1;
  contagem.set(chaveBase, ocorrencia);
  rows.push({
    ...partial,
    ocorrencia,
    dedupKey: buildDedupKey(
      partial.data,
      partial.historico,
      partial.documento,
      partial.valor,
      partial.tipo,
      ocorrencia,
    ),
  });
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

    pushRow(rows, contagem, {
      data,
      historico,
      documento,
      valor,
      tipo,
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

/**
 * Extrato CSV "Conta;… / ID;Titulo;Valor;Tipo;Data;…" (app bancário).
 * Ignora SALDO ANTERIOR e Tipo=Todos.
 */
export function parseContaTitularesCsv(texto: string): ExtratoParseResult {
  const erros: string[] = [];
  const rows: ExtratoRow[] = [];
  const linhas = texto.replace(/^\uFEFF/, "").split(/\r?\n/);
  let contaNum = "";
  let titular: string | null = null;
  let iCols: ReturnType<typeof mapContaTitularesCols> | null = null;
  const contagem = new Map<string, number>();

  for (let n = 0; n < linhas.length; n++) {
    const raw = linhas[n];
    if (!raw || !raw.trim()) continue;
    const campos = splitCsvSemi(raw);
    const key0 = normHeaderCell(campos[0] ?? "");

    if (key0 === "conta" && campos[1]) {
      contaNum = campos[1].replace(/\D/g, "") || campos[1].trim();
      continue;
    }
    if (key0 === "titulares") continue;
    // Titular: "63 027 712 NOME (CNPJ…)" — três grupos numéricos no início
    if (/^\d+\s+\d+\s+\d+/.test((campos[0] ?? "").trim())) {
      if (!titular) titular = campos[0].trim();
      continue;
    }
    if (key0 === "saldo" || key0 === "data do extrato") continue;

    if (isContaTitularesHeaderRow(campos)) {
      iCols = mapContaTitularesCols(campos.map(normHeaderCell));
      continue;
    }
    if (!iCols) continue;

    const titulo = campos[iCols.titulo] ?? "";
    const tipoRaw = campos[iCols.tipo] ?? "";
    if (isSaldoAnterior(titulo, tipoRaw)) continue;

    const tipoN = normHeaderCell(tipoRaw);
    let tipo: "C" | "D" | null = null;
    if (tipoN.startsWith("credito") || tipoN === "c" || tipoN === "credit") tipo = "C";
    else if (tipoN.startsWith("debito") || tipoN === "d" || tipoN === "debit") tipo = "D";
    else continue;

    const data =
      parseBrDate(campos[iCols.dataTransacao] ?? "") ?? parseBrDate(campos[iCols.data] ?? "") ?? null;
    const valor = parseBrNumber(campos[iCols.valor] ?? "");
    const historico = normalizeHistorico(titulo);
    const id = (iCols.id >= 0 ? campos[iCols.id] ?? "" : "").trim();
    const doc = (iCols.documento >= 0 ? campos[iCols.documento] ?? "" : "").trim();
    // ID vazio/"0" → cai no Documento (ex.: cartão sem ID)
    const documento = (id && id !== "0" ? id : "") || doc || null;

    if (!data || !historico || valor == null || valor <= 0) {
      erros.push(`Linha ${n + 1} ignorada (data/título/valor inválidos).`);
      continue;
    }

    pushRow(rows, contagem, {
      data,
      historico,
      documento,
      valor,
      tipo,
      forma: inferFormaHistorico(historico),
    });
  }

  if (!contaNum) {
    return {
      header: null,
      rows: [],
      erros: ["CSV Conta/Titulares sem número de conta."],
      formato: "conta-titulares",
    };
  }

  return {
    header: { agencia: "banco", conta: contaNum },
    rows,
    erros,
    formato: "conta-titulares",
    titular,
  };
}

function mapContaTitularesCols(h: string[]) {
  return {
    id: h.findIndex((x) => x === "id"),
    titulo: h.findIndex((x) => x === "titulo"),
    valor: h.findIndex((x) => x === "valor"),
    tipo: h.findIndex((x) => x === "tipo"),
    data: h.findIndex((x) => x === "data"),
    documento: h.findIndex((x) => x === "documento"),
    dataTransacao: h.findIndex((x) => x.replace(/\s/g, "") === "datatransacao"),
  };
}

/**
 * OFX SGML 1.0x (ex.: app bancário BR) — STMTTRN com CREDIT/DEBIT.
 * Ignora SALDO ANTERIOR.
 */
export function parseExtratoOfx(texto: string): ExtratoParseResult {
  const erros: string[] = [];
  const rows: ExtratoRow[] = [];
  const limpo = texto.replace(/^\uFEFF/, "");
  if (!isOfxText(limpo)) {
    return { header: null, rows, erros: ["Arquivo não parece OFX."], formato: "ofx" };
  }

  const acctRaw = ofxTag(limpo, "ACCTID") || "";
  const acct = acctRaw.replace(/\D/g, "") || acctRaw.trim();
  const titular = ofxTag(limpo, "HOLDER") || null;
  const contagem = new Map<string, number>();

  const trnBlocks = limpo.split(/<STMTTRN>/i).slice(1);
  for (let i = 0; i < trnBlocks.length; i++) {
    const block = trnBlocks[i].split(/<\/STMTTRN>/i)[0] ?? trnBlocks[i];
    const name = ofxTag(block, "NAME") || ofxTag(block, "MEMO") || "";
    const trnType = (ofxTag(block, "TRNTYPE") || "").toUpperCase();
    if (isSaldoAnterior(name)) continue;

    let tipo: "C" | "D" | null = null;
    if (trnType.includes("CREDIT") || trnType === "DEP" || trnType === "DIRECTDEP") tipo = "C";
    else if (
      trnType.includes("DEBIT") ||
      trnType === "XFER" ||
      trnType === "PAYMENT" ||
      trnType === "POS" ||
      trnType === "ATM"
    )
      tipo = "D";

    const amtRaw = ofxTag(block, "TRNAMT") || "";
    let signed = parseBrNumber(amtRaw);
    if (signed == null) {
      const us = Number(amtRaw.replace(",", ""));
      signed = Number.isFinite(us) ? us : null;
    }
    if (signed != null && signed < 0) {
      tipo = "D";
      signed = Math.abs(signed);
    } else if (signed != null && signed > 0 && !tipo) {
      tipo = "C";
    }

    const data = parseOfxDate(ofxTag(block, "DTPOSTED"));
    const fitidRaw = (ofxTag(block, "FITID") || "").trim();
    // FITID vazio ou "0" (saldo) → sem documento; linha ainda entra se tiver valor/tipo
    const fitid = fitidRaw && fitidRaw !== "0" ? fitidRaw : "";
    const checknum = (ofxTag(block, "CHECKNUM") || "").trim();
    const historico = normalizeHistorico(name);
    const valor = signed != null ? Math.abs(signed) : null;
    const documento = fitid || checknum || null;

    if (!data || !historico || valor == null || valor <= 0 || !tipo) {
      erros.push(`Transação OFX ${i + 1} ignorada (data/nome/valor/tipo inválidos).`);
      continue;
    }

    pushRow(rows, contagem, {
      data,
      historico,
      documento,
      valor,
      tipo,
      forma: inferFormaHistorico(historico),
    });
  }

  if (!acct) {
    return {
      header: null,
      rows: [],
      erros: ["OFX sem ACCTID (número da conta)."],
      formato: "ofx",
      titular,
    };
  }

  return {
    header: { agencia: "banco", conta: acct },
    rows,
    erros,
    formato: "ofx",
    titular,
  };
}

/** Detecta OFX ou CSV e parseia. */
export function parseExtratoArquivo(texto: string, filenameHint?: string): ExtratoParseResult {
  const limpo = texto.replace(/^\uFEFF/, "");
  const name = (filenameHint || "").toLowerCase();
  if (name.endsWith(".ofx") || isOfxText(limpo)) {
    return parseExtratoOfx(limpo);
  }
  return parseExtratoCsv(limpo);
}

export function parseExtratoCsv(texto: string): ExtratoParseResult {
  const limpo = texto.replace(/^\uFEFF/, "");
  const linhas = limpo.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (linhas.length === 0) {
    return { header: null, rows: [], erros: ["CSV vazio."] };
  }

  if (isOfxText(limpo)) {
    return parseExtratoOfx(limpo);
  }

  const first = splitCsvSemi(linhas[0]);
  if (isGendoTransacoesHeader(first)) {
    return parseGendoTransacoesCsv(limpo);
  }
  if (isContaTitularesCsv(limpo)) {
    return parseContaTitularesCsv(limpo);
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

    pushRow(rows, contagem, {
      data,
      historico,
      documento,
      valor,
      tipo,
    });
  }

  return { header, rows, erros, formato: "viacredi" };
}

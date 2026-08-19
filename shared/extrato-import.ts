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
  /** Ordem de leitura no arquivo (para intercalar com as ignoradas no preview). */
  seq?: number;
  /** Metadados Gendo — sync com receitas/despesas no import. */
  categoria?: string | null;
  descricao?: string | null;
  forma?: "dinheiro" | "pix" | "cartao";
  syncReceita?: boolean;
  syncDespesa?: boolean;
}

export type ExtratoFormato = "viacredi" | "gendo-transacoes" | "conta-titulares" | "ofx";

/**
 * Linha reconhecida no arquivo mas deliberadamente fora do extrato
 * (SALDO ANTERIOR, Tipo=Todos, Realizado=Não). Sempre com motivo.
 */
export interface ExtratoRowIgnorada {
  data: string | null;
  historico: string;
  documento: string | null;
  valor: number | null;
  tipo: "C" | "D" | null;
  motivo: string;
  seq: number;
}

/**
 * Linha de DADOS do arquivo que o leitor não conseguiu interpretar.
 *
 * Antes essas linhas viravam só uma string em `erros` e sumiam do balanço: não
 * entravam em `rows` nem em `ignoradas`, e como `linhasLidas` era calculado como
 * `rows.length + ignoradas.length`, a conta fechava POR CONSTRUÇÃO — o balanço
 * era incapaz de detectar exatamente a coisa para a qual existe. Agora toda
 * linha descartada vira um registro com motivo e entra no balanço.
 */
export interface ExtratoRowNaoLida {
  /** Número da linha no arquivo (1-based). No OFX, o número da transação. */
  linha: number;
  /** Por que o leitor não conseguiu ler. */
  motivo: string;
  /** Trecho do conteúdo cru, para o usuário reconhecer a linha no arquivo. */
  conteudo: string;
  seq: number;
}

export interface ExtratoParseResult {
  header: ExtratoHeader | null;
  rows: ExtratoRow[];
  erros: string[];
  /**
   * Quantas linhas de DADOS o arquivo tem, contadas NA FONTE, antes de qualquer
   * filtro. Nunca derive isto de `rows`/`ignoradas`: é justamente contra a perda
   * silenciosa de linha que este número existe.
   */
  linhasArquivo: number;
  /** Linhas de dados que o leitor não conseguiu interpretar, com motivo. */
  naoLidas: ExtratoRowNaoLida[];
  /** Formato detectado (para UI). */
  formato?: ExtratoFormato;
  /** Linhas Realizado=Não ignoradas no extrato (só Gendo). */
  ignoradasNaoRealizadas?: number;
  /** Linhas ignoradas com motivo (SALDO ANTERIOR, Tipo=Todos, Realizado=Não). */
  ignoradas?: ExtratoRowIgnorada[];
  /** Titular / nome sugerido para a conta. */
  titular?: string | null;
  /**
   * Saldo do arquivo (fechamento / BALAMT) para âncora automática.
   * Usar data = último dia do extrato e valor = saldo final (movimentos na data da âncora não somam de novo).
   */
  saldoExtrato?: { data: string | null; valor: number } | null;
}

export function normalizeHistorico(s: string): string {
  return s.trim().replace(/\s+/g, " ").toUpperCase();
}

/**
 * Sobra do parse: linha de dados que não virou `row`, nem `ignorada`, nem
 * `naoLida`. TEM que ser zero em todo arquivo que o app aceita importar — é a
 * mesma invariante do balanço, medida uma etapa antes, dentro do leitor.
 */
export function linhasSemCategoria(p: ExtratoParseResult): number {
  return p.linhasArquivo - (p.rows.length + (p.ignoradas?.length ?? 0) + p.naoLidas.length);
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

/**
 * Data OFX compacta (YYYYMMDD...). O ramo compacto montava a string sem conferir
 * o calendário — só parseBrDate tinha essa guarda. Resultado: <DTPOSTED>20269999
 * entrava como "2026-99-99" e derrubava /api/extrato/preview em fluxo-utils.ts,
 * e 20260229 passava num ano que não é bissexto.
 */
function parseOfxDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const compact = s.trim().match(/^(\d{4})(\d{2})(\d{2})/);
  if (compact) return parseBrDate(`${compact[1]}-${compact[2]}-${compact[3]}`);
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

/**
 * Saldo de abertura do arquivo: o valor da linha SALDO ANTERIOR que o parser
 * separou em `ignoradas`. É o outro extremo do fechamento — com ele dá para
 * conferir se creditos - debitos bate com saldoFinal - saldoInicial.
 */
export function saldoInicialDe(
  ignoradas: ExtratoRowIgnorada[] | undefined,
): { data: string | null; valor: number } | null {
  for (const ig of ignoradas ?? []) {
    if (ig.valor == null) continue;
    if (isSaldoAnterior(ig.historico)) return { data: ig.data, valor: ig.valor };
  }
  return null;
}

/**
 * Manchete de erro quando o arquivo não é um extrato reconhecível.
 * Erro de arquivo é erro do usuário: precisa dizer QUAL arquivo, o que houve e
 * o que fazer agora — não devolver o resmungo do leitor ("menos de 5 campos").
 * O detalhe técnico vai junto, embaixo, como nota de rodapé.
 */
export function mensagemArquivoInvalido(
  nomeArquivo: string,
  texto: string,
  erros: string[],
  /**
   * O que o leitor conseguiu tirar do arquivo. Sem isto a mensagem dizia
   * "o arquivo não tem as colunas de um extrato" até para arquivos em que ele
   * leu as transações direitinho e só faltou o cabeçalho da conta — e aí o
   * usuário ia procurar um problema que não existe.
   */
  parsed?: Pick<ExtratoParseResult, "rows" | "linhasArquivo">,
): string {
  const nome = nomeArquivo?.trim() || "o arquivo";
  const lidas = parsed?.rows?.length ?? 0;
  const manchete =
    texto.trim().length === 0
      ? `“${nome}” está vazio — o download não trouxe nenhuma linha. Baixe o extrato de novo pelo aplicativo do banco.`
      : lidas > 0
        ? `“${nome}” tem ${lidas} ${lidas === 1 ? "transação" : "transações"}, mas não diz DE QUAL CONTA é: falta a linha de cabeçalho com a agência e o número da conta, no topo do arquivo. Sem ela eu não tenho como saber onde gravar — e não vou adivinhar a conta a partir de uma linha de movimento. Baixe o extrato de novo pelo aplicativo do banco, sem abrir nem salvar por cima no Excel.`
        : `Não reconheci “${nome}” como extrato. O arquivo não tem as colunas de um extrato (data, histórico, valor, tipo). Baixe o extrato em CSV ou OFX pelo aplicativo do banco, sem abrir nem salvar por cima no Excel — ou confira se não escolheu outro arquivo por engano.`;
  const detalhe = (erros ?? []).find((e) => e && e.trim().length > 0);
  return detalhe ? `${manchete}

O que o leitor encontrou: ${detalhe}` : manchete;
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

/** Estado mutável de um parse: linhas aceitas, ignoradas, não lidas, ocorrência e ordem de leitura. */
interface Coletor {
  rows: ExtratoRow[];
  ignoradas: ExtratoRowIgnorada[];
  naoLidas: ExtratoRowNaoLida[];
  contagem: Map<string, number>;
  seq: number;
  /** Linhas de dados vistas na fonte, antes de qualquer filtro. */
  lidasDoArquivo: number;
}

function novoColetor(): Coletor {
  return { rows: [], ignoradas: [], naoLidas: [], contagem: new Map(), seq: 0, lidasDoArquivo: 0 };
}

/**
 * Linhas não vazias com o número ORIGINAL de cada uma no arquivo. Sem isso o
 * "Linha 12" da mensagem apontava para outra linha em qualquer arquivo com
 * linha em branco no meio — e o usuário não achava o problema.
 */
function linhasUteis(texto: string): { conteudo: string[]; numero: number[] } {
  const conteudo: string[] = [];
  const numero: number[] = [];
  texto
    .replace(/^﻿/, "")
    .split(/\r?\n/)
    .forEach((l, i) => {
      if (l.trim().length > 0) {
        conteudo.push(l);
        numero.push(i + 1);
      }
    });
  return { conteudo, numero };
}

/** Recorte curto do conteúdo cru, o bastante para o usuário achar a linha no arquivo. */
function recorte(s: string): string {
  const t = String(s ?? "").replace(/\s+/g, " ").trim();
  return t.length > 120 ? `${t.slice(0, 117)}…` : t;
}

function pushRow(col: Coletor, partial: Omit<ExtratoRow, "ocorrencia" | "dedupKey" | "seq">) {
  const chaveBase = `${partial.data}|${partial.historico}|${partial.documento ?? ""}|${partial.valor.toFixed(2)}|${partial.tipo}`;
  const ocorrencia = (col.contagem.get(chaveBase) ?? 0) + 1;
  col.contagem.set(chaveBase, ocorrencia);
  col.rows.push({
    ...partial,
    ocorrencia,
    seq: col.seq++,
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

function pushIgnorada(col: Coletor, partial: Omit<ExtratoRowIgnorada, "seq">) {
  col.ignoradas.push({ ...partial, seq: col.seq++ });
}

/**
 * Registra a linha que o leitor não entendeu. É a ÚNICA saída permitida para
 * uma linha de dados que não vira `row` nem `ignorada` — nenhum `continue` do
 * laço pode escapar sem passar por aqui, ou a linha some do balanço.
 */
function pushNaoLida(col: Coletor, linha: number, motivo: string, conteudo: string) {
  col.naoLidas.push({ linha, motivo, conteudo: recorte(conteudo), seq: col.seq++ });
}

/** Frase de erro (lista `erros`) equivalente ao registro de não lida. */
function textoNaoLida(n: ExtratoRowNaoLida): string {
  return `Linha ${n.linha}: ${n.motivo}${n.conteudo ? ` — “${n.conteudo}”` : ""}`;
}

/** `erros` derivado das não lidas, para quem só consome a lista de strings. */
function errosDe(col: Coletor): string[] {
  return col.naoLidas.map(textoNaoLida);
}

/**
 * CSV Gendo / agenda: Data;Vencimento;Comanda;Responsável;Categoria;Descrição;Realizado;Valor
 * Só Realizado=Sim entra no extrato. Valor negativo = débito.
 */
export function parseGendoTransacoesCsv(texto: string): ExtratoParseResult {
  const col = novoColetor();
  const rows = col.rows;
  let ignoradasNaoRealizadas = 0;
  const { conteudo: linhas, numero: numLinha } = linhasUteis(texto);
  if (!linhas.length) {
    return {
      header: null,
      rows,
      erros: ["O arquivo não tem nenhuma linha — está vazio."],
      linhasArquivo: 0,
      naoLidas: [],
      formato: "gendo-transacoes",
    };
  }
  // Linhas de DADOS do arquivo, contadas na fonte: tudo menos o cabeçalho.
  col.lidasDoArquivo = linhas.length - 1;

  const headerCols = splitCsvSemi(linhas[0]).map(normHeaderCell);
  const iData = headerCols.findIndex((h) => h === "data");
  const iCat = headerCols.findIndex((h) => h === "categoria");
  const iDesc = headerCols.findIndex((h) => h.startsWith("descri"));
  const iReal = headerCols.findIndex((h) => h === "realizado");
  const iValor = headerCols.findIndex((h) => h === "valor");
  const iComanda = headerCols.findIndex((h) => h === "comanda");
  const iVenc = headerCols.findIndex((h) => h === "vencimento");

  if (iData < 0 || iValor < 0 || iDesc < 0) {
    /*
     * Sem saber em que coluna estão Data, Descrição e Valor, NENHUMA linha pode
     * ser lida — e cada uma delas precisa aparecer como não lida. Antes este
     * return devolvia `naoLidas: []` com `linhasArquivo` cheio: as linhas
     * ficavam contadas e sem categoria nenhuma, o mesmo buraco do cabeçalho.
     */
    for (let n = 1; n < linhas.length; n++) {
      pushNaoLida(
        col,
        numLinha[n],
        "o cabeçalho deste arquivo não traz as colunas Data, Descrição e Valor, então não dá para saber o que cada campo é.",
        linhas[n],
      );
    }
    return {
      header: null,
      rows,
      erros: ["Cabeçalho Gendo inválido (precisa Data, Descrição e Valor).", ...errosDe(col)],
      linhasArquivo: col.lidasDoArquivo,
      naoLidas: col.naoLidas,
      formato: "gendo-transacoes",
    };
  }

  for (let n = 1; n < linhas.length; n++) {
    const campos = splitCsvSemi(linhas[n]);
    const realizado = iReal >= 0 ? normHeaderCell(campos[iReal] ?? "") : "sim";
    const naoRealizado =
      realizado === "nao" ||
      realizado === "não" ||
      (!!realizado && realizado !== "sim" && !["s", "yes", "true", "1", "pago"].includes(realizado));
    if (naoRealizado) {
      ignoradasNaoRealizadas++;
      const catIg = (iCat >= 0 ? campos[iCat] : "") || "";
      const descIg = campos[iDesc] ?? "";
      const signedIg = parseBrNumber((campos[iValor] ?? "").replace(/^"|"$/g, ""));
      pushIgnorada(col, {
        data: parseBrDate(campos[iData] ?? "") ?? (iVenc >= 0 ? parseBrDate(campos[iVenc] ?? "") : null),
        historico: normalizeHistorico(
          [catIg, descIg].filter((x) => x && x !== "--").join(" - ") || descIg || catIg,
        ),
        documento: null,
        valor: signedIg != null ? Math.abs(signedIg) : null,
        tipo: signedIg == null ? null : signedIg > 0 ? "C" : "D",
        motivo: "Realizado=Não no Gendo (ainda não passou na conta).",
      });
      continue;
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
      const falta = [
        !data ? "a data" : null,
        !historico ? "a descrição" : null,
        signed == null ? "o valor" : signed === 0 ? "um valor diferente de zero" : null,
      ].filter(Boolean);
      pushNaoLida(col, numLinha[n], `não deu para ler ${falta.join(" nem ")}.`, linhas[n]);
      continue;
    }

    const tipo: "C" | "D" = signed > 0 ? "C" : "D";
    const valor = Math.abs(signed);

    pushRow(col, {
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
    erros: errosDe(col),
    linhasArquivo: col.lidasDoArquivo,
    naoLidas: col.naoLidas,
    formato: "gendo-transacoes",
    ignoradasNaoRealizadas,
    ignoradas: col.ignoradas,
  };
}

/**
 * Extrato CSV "Conta;… / ID;Titulo;Valor;Tipo;Data;…" (app bancário).
 * Ignora SALDO ANTERIOR e Tipo=Todos.
 */
export function parseContaTitularesCsv(texto: string): ExtratoParseResult {
  const col = novoColetor();
  const rows = col.rows;
  const linhas = texto.replace(/^\uFEFF/, "").split(/\r?\n/);
  let contaNum = "";
  let titular: string | null = null;
  let iCols: ReturnType<typeof mapContaTitularesCols> | null = null;
  /** Saldos lidos do arquivo (último ganha = fechamento). */
  let saldoArquivo: number | null = null;
  let dataExtrato: string | null = null;

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
    if (key0 === "saldo") {
      const v = parseBrNumber(campos[1] ?? "");
      if (v != null) saldoArquivo = v;
      continue;
    }
    if (key0 === "data do extrato") {
      const d = parseBrDate(campos[1] ?? "");
      if (d) dataExtrato = d;
      // "Data do Extrato;…;Saldo;1342,9"
      const iSaldo = campos.findIndex((c) => normHeaderCell(c) === "saldo");
      if (iSaldo >= 0) {
        const v = parseBrNumber(campos[iSaldo + 1] ?? "");
        if (v != null) saldoArquivo = v;
      }
      continue;
    }

    if (isContaTitularesHeaderRow(campos)) {
      iCols = mapContaTitularesCols(campos.map(normHeaderCell));
      continue;
    }

    // Daqui para baixo é LINHA DE DADOS: conta na fonte, antes de qualquer
    // filtro. Nenhuma saída abaixo pode ser um `continue` mudo.
    col.lidasDoArquivo++;

    if (!iCols) {
      pushNaoLida(
        col,
        n + 1,
        "linha antes do cabeçalho de colunas (ID;Titulo;Valor;Tipo;…), não dá para saber o que cada campo é.",
        raw,
      );
      continue;
    }

    const titulo = campos[iCols.titulo] ?? "";
    const tipoRaw = campos[iCols.tipo] ?? "";
    if (isSaldoAnterior(titulo, tipoRaw)) {
      const vIg = parseBrNumber(campos[iCols.valor] ?? "");
      pushIgnorada(col, {
        data:
          parseBrDate(campos[iCols.dataTransacao] ?? "") ?? parseBrDate(campos[iCols.data] ?? "") ?? null,
        historico: normalizeHistorico(titulo),
        documento: null,
        valor: vIg,
        tipo: null,
        motivo:
          normHeaderCell(tipoRaw) === "todos"
            ? "Linha de saldo (Tipo=Todos), não é movimentação."
            : "SALDO ANTERIOR, não é movimentação.",
      });
      continue;
    }

    const tipoN = normHeaderCell(tipoRaw);
    let tipo: "C" | "D" | null = null;
    if (tipoN.startsWith("credito") || tipoN === "c" || tipoN === "credit") tipo = "C";
    else if (tipoN.startsWith("debito") || tipoN === "d" || tipoN === "debit") tipo = "D";
    else {
      // Era um `continue` mudo: a linha sumia sem entrar em nada.
      pushNaoLida(
        col,
        n + 1,
        tipoRaw.trim()
          ? `a coluna Tipo diz “${tipoRaw.trim()}”, e eu só entendo Crédito ou Débito.`
          : "a coluna Tipo veio vazia, e sem ela não dá para saber se entra ou sai.",
        raw,
      );
      continue;
    }

    const data =
      parseBrDate(campos[iCols.dataTransacao] ?? "") ?? parseBrDate(campos[iCols.data] ?? "") ?? null;
    const valor = parseBrNumber(campos[iCols.valor] ?? "");
    const historico = normalizeHistorico(titulo);
    const id = (iCols.id >= 0 ? campos[iCols.id] ?? "" : "").trim();
    const doc = (iCols.documento >= 0 ? campos[iCols.documento] ?? "" : "").trim();
    // ID vazio/"0" → cai no Documento (ex.: cartão sem ID)
    const documento = (id && id !== "0" ? id : "") || doc || null;

    if (!data || !historico || valor == null || valor <= 0) {
      const falta = [
        !data ? "a data" : null,
        !historico ? "o título" : null,
        valor == null
          ? "o valor"
          : valor === 0
            ? "um valor diferente de zero (esta linha veio R$ 0,00)"
            : valor < 0
              ? "um valor positivo (esta linha veio negativa; o sinal quem dá é a coluna Tipo)"
              : null,
      ].filter(Boolean);
      pushNaoLida(col, n + 1, `não deu para ler ${falta.join(" nem ")}.`, raw);
      continue;
    }

    pushRow(col, {
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
      // As linhas lidas vão junto mesmo sem conta: zerá-las aqui abriria o mesmo
      // buraco do cabeçalho — linha contada em `linhasArquivo` e em categoria
      // nenhuma. Sem `header` o import recusa o arquivo de qualquer jeito.
      rows,
      erros: [
        "O arquivo parece um extrato, mas não traz o número da conta no topo (linha \"Conta;…\"). Baixe o extrato de novo pelo aplicativo do banco, sem editar o arquivo.",
      ],
      linhasArquivo: col.lidasDoArquivo,
      naoLidas: col.naoLidas,
      formato: "conta-titulares",
      ignoradas: col.ignoradas,
    };
  }

  const lastRowDate = rows.reduce<string | null>((max, r) => (!max || r.data > max ? r.data : max), null);
  const saldoExtrato =
    saldoArquivo != null
      ? { data: dataExtrato || lastRowDate, valor: saldoArquivo }
      : null;

  return {
    header: { agencia: "banco", conta: contaNum },
    rows,
    erros: errosDe(col),
    linhasArquivo: col.lidasDoArquivo,
    naoLidas: col.naoLidas,
    formato: "conta-titulares",
    titular,
    saldoExtrato,
    ignoradas: col.ignoradas,
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
  const col = novoColetor();
  const rows = col.rows;
  const limpo = texto.replace(/^\uFEFF/, "");
  if (!isOfxText(limpo)) {
    return {
      header: null,
      rows,
      erros: ["Arquivo não parece OFX."],
      linhasArquivo: 0,
      naoLidas: [],
      formato: "ofx",
    };
  }

  const acctRaw = ofxTag(limpo, "ACCTID") || "";
  const acct = acctRaw.replace(/\D/g, "") || acctRaw.trim();
  const titular = ofxTag(limpo, "HOLDER") || null;

  const trnBlocks = limpo.split(/<STMTTRN>/i).slice(1);
  // Transações do arquivo, contadas na FONTE: um <STMTTRN> é uma linha de dados.
  col.lidasDoArquivo = trnBlocks.length;
  for (let i = 0; i < trnBlocks.length; i++) {
    const block = trnBlocks[i].split(/<\/STMTTRN>/i)[0] ?? trnBlocks[i];
    const name = ofxTag(block, "NAME") || ofxTag(block, "MEMO") || "";
    const trnType = (ofxTag(block, "TRNTYPE") || "").toUpperCase();
    if (isSaldoAnterior(name)) {
      const amtIg = parseBrNumber(ofxTag(block, "TRNAMT") || "");
      pushIgnorada(col, {
        data: parseOfxDate(ofxTag(block, "DTPOSTED")),
        historico: normalizeHistorico(name),
        documento: null,
        valor: amtIg != null ? Math.abs(amtIg) : null,
        tipo: null,
        motivo: "SALDO ANTERIOR, não é movimentação.",
      });
      continue;
    }

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
    // A especificação do OFX manda ponto decimal, mas os bancos brasileiros emitem
    // vírgula ("19,47") — o extrato real em tests/core.test.ts é assim. parseBrNumber
    // resolve os dois porque decide pelo separador que aparece por ÚLTIMO.
    // Antes ele apagava todo ponto antes de decidir, e "-480.26" entrava como -48026:
    // todo OFX com centavos era importado 100x maior, em silêncio.
    const signed = parseBrNumber(amtRaw);
    if (signed != null && signed < 0) {
      tipo = "D";
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
      const falta = [
        !data ? "a data (DTPOSTED)" : null,
        !historico ? "o nome (NAME/MEMO)" : null,
        valor == null
          ? "o valor (TRNAMT)"
          : valor === 0
            ? "um valor diferente de zero (TRNAMT veio 0)"
            : null,
        !tipo ? "o tipo (TRNTYPE não é crédito nem débito)" : null,
      ].filter(Boolean);
      pushNaoLida(
        col,
        i + 1,
        `transação ${i + 1} do OFX: não deu para ler ${falta.join(" nem ")}.`,
        block,
      );
      continue;
    }

    pushRow(col, {
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
      // Idem conta-titulares: as transações lidas continuam na resposta para que
      // `linhasArquivo` nunca fique maior do que a soma das categorias.
      rows,
      erros: ["OFX sem ACCTID (número da conta)."],
      linhasArquivo: col.lidasDoArquivo,
      naoLidas: col.naoLidas,
      formato: "ofx",
      titular,
      ignoradas: col.ignoradas,
    };
  }

  const balAmt = parseBrNumber(ofxTag(limpo, "BALAMT") || "");
  const dtEnd = parseOfxDate(ofxTag(limpo, "DTEND"));
  const lastRowDate = rows.reduce<string | null>((max, r) => (!max || r.data > max ? r.data : max), null);
  const saldoExtrato =
    balAmt != null ? { data: dtEnd || lastRowDate, valor: balAmt } : null;

  return {
    header: { agencia: "banco", conta: acct },
    rows,
    erros: errosDe(col),
    linhasArquivo: col.lidasDoArquivo,
    naoLidas: col.naoLidas,
    formato: "ofx",
    titular,
    saldoExtrato,
    ignoradas: col.ignoradas,
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

/**
 * A linha do CSV Viacredi é uma transação VÁLIDA? É a régua do próprio parser,
 * extraída para poder ser reusada pelo detector de cabeçalho — as duas TÊM que
 * ser a mesma, ou uma linha de dados cai no vão entre elas.
 */
function ehTransacaoViacrediValida(campos: string[]): boolean {
  if (campos.length < 5) return false;
  const data = parseBrDate(campos[0] ?? "");
  const historico = normalizeHistorico(campos[1] ?? "");
  const valor = parseBrNumber(campos[3] ?? "");
  const tipoRaw = (campos[4] ?? "").trim().toUpperCase();
  return (
    !!data && !!historico && valor != null && valor > 0 && (tipoRaw === "C" || tipoRaw === "D")
  );
}

/**
 * A primeira linha é DADO ou é o cabeçalho da conta (agência;descrição;conta)?
 *
 * A régua era `/^\d{2}\/\d{2}\//` — MAIS ESTREITA que a de `parseBrDate`, que
 * também lê ISO. Uma linha "2026-07-01;ISO PRIMEIRA LINHA;D900;999,00;C" era
 * engolida como cabeçalho: saía de `rows` E de `linhasArquivo`, não virava
 * `naoLida` nem `ignorada`, e o balanço fechava em VERDE com o crédito de
 * R$ 999,00 desaparecido do sistema — e ainda pior, a data virava agência e o
 * documento virava número de conta.
 *
 * Agora vale a régua do parser: se a linha é uma transação válida, é dado. E se
 * ela só COMEÇA com uma data que `parseBrDate` lê, também é dado — quebrada,
 * mas do extrato: vai para `naoLida`, que é uma categoria do balanço, com
 * motivo e número da linha. Cabeçalho de conta não começa com data.
 */
function ehLinhaDeDadosViacredi(campos: string[]): boolean {
  if (ehTransacaoViacrediValida(campos)) return true;
  return parseBrDate(campos[0] ?? "") != null;
}

export function parseExtratoCsv(texto: string): ExtratoParseResult {
  const limpo = texto.replace(/^\uFEFF/, "");
  const { conteudo: linhas, numero: numLinha } = linhasUteis(limpo);
  if (linhas.length === 0) {
    return {
      header: null,
      rows: [],
      erros: ["O arquivo não tem nenhuma linha — está vazio."],
      linhasArquivo: 0,
      naoLidas: [],
    };
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

  const col = novoColetor();
  const rows = col.rows;
  let header: ExtratoHeader | null = null;

  /*
   * CONTAGEM PRIMEIRO, decisão de cabeçalho DEPOIS — e a decisão é a única
   * coisa autorizada a tirar uma linha da contagem, no máximo uma, e por
   * escrito. `totalLinhas` é o arquivo inteiro (menos as linhas em branco), lido
   * antes de qualquer régua.
   */
  const totalLinhas = linhas.length;
  const primeira = splitCsvSemi(linhas[0]);
  const temCabecalho = !ehLinhaDeDadosViacredi(primeira);
  const inicio = temCabecalho ? 1 : 0;
  if (temCabecalho && primeira[0] && primeira[2]) {
    header = { agencia: primeira[0], conta: primeira[2] };
  }

  // Linhas de DADOS do arquivo, contadas na fonte: tudo menos o cabeçalho.
  col.lidasDoArquivo = Math.max(0, totalLinhas - inicio);

  for (let n = inicio; n < linhas.length; n++) {
    const campos = splitCsvSemi(linhas[n]);
    if (campos.length < 5) {
      pushNaoLida(
        col,
        numLinha[n],
        `um extrato tem 5 colunas separadas por ponto e vírgula (data; histórico; documento; valor; tipo) e esta tem ${campos.length}.`,
        linhas[n],
      );
      continue;
    }

    const data = parseBrDate(campos[0]);
    const historico = normalizeHistorico(campos[1] ?? "");
    const docRaw = (campos[2] ?? "").trim();
    const documento = docRaw.length > 0 ? docRaw : null;
    const valor = parseBrNumber(campos[3]);
    const tipoRaw = (campos[4] ?? "").trim().toUpperCase();

    if (!data || !historico || valor == null || valor <= 0 || (tipoRaw !== "C" && tipoRaw !== "D")) {
      const falta = [
        !data ? "a data" : null,
        !historico ? "o histórico" : null,
        valor == null
          ? "o valor"
          : valor === 0
            ? "um valor diferente de zero (esta linha veio R$ 0,00)"
            : valor < 0
              ? "um valor positivo (esta linha veio negativa; o sinal quem dá é a coluna tipo)"
              : null,
        tipoRaw !== "C" && tipoRaw !== "D"
          ? `o tipo C ou D (veio ${tipoRaw ? `“${tipoRaw}”` : "vazio"})`
          : null,
      ].filter(Boolean);
      pushNaoLida(col, numLinha[n], `não deu para ler ${falta.join(" nem ")}.`, linhas[n]);
      continue;
    }
    const tipo = tipoRaw as "C" | "D";

    pushRow(col, {
      data,
      historico,
      documento,
      valor,
      tipo,
    });
  }

  return {
    header,
    rows,
    erros: errosDe(col),
    linhasArquivo: col.lidasDoArquivo,
    naoLidas: col.naoLidas,
    formato: "viacredi",
    ignoradas: col.ignoradas,
  };
}

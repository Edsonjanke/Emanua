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
}

export interface ExtratoParseResult {
  header: ExtratoHeader | null;
  rows: ExtratoRow[];
  erros: string[];
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

export function parseExtratoCsv(texto: string): ExtratoParseResult {
  const erros: string[] = [];
  const rows: ExtratoRow[] = [];
  let header: ExtratoHeader | null = null;

  const linhas = texto.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (linhas.length === 0) {
    return { header, rows, erros: ["CSV vazio."] };
  }

  let inicio = 0;
  if (!/^\d{2}\/\d{2}\//.test(linhas[0].trim())) {
    const campos = linhas[0].split(";").map((c) => c.trim());
    if (campos[0] && campos[2]) {
      header = { agencia: campos[0], conta: campos[2] };
    }
    inicio = 1;
  }

  const contagem = new Map<string, number>();

  for (let n = inicio; n < linhas.length; n++) {
    const campos = linhas[n].split(";");
    if (campos.length < 5) {
      erros.push(`Linha ${n + 1} ignorada (menos de 5 campos).`);
      continue;
    }

    const data = parseBrDate(campos[0].trim());
    const historico = normalizeHistorico(campos[1] ?? "");
    const docRaw = (campos[2] ?? "").trim();
    const documento = docRaw.length > 0 ? docRaw : null;
    const valor = parseBrNumber(campos[3].trim());
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

  return { header, rows, erros };
}

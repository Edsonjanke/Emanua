import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  parseExtratoArquivo,
  parseGendoTransacoesCsv,
  buildDedupKey,
  type ExtratoRow,
} from "@shared/extrato-import";
import {
  classificarLinhas,
  diffLinhaVsExistente,
  periodoDe,
  totaisDe,
  type LancamentoVinculavel,
  type MovExistente,
} from "@shared/extrato-diff";

const FIXTURES =
  "C:/Users/Edson/AppData/Local/Temp/claude/E--Emanua-Financeiro-Emanua-Financeiro/f79e99f8-e0a9-42bd-9467-b11e32d15f0f/scratchpad/fixtures";

function lerFixture(nome: string): string {
  return fs.readFileSync(path.join(FIXTURES, nome), "utf-8");
}

const EXTRATO_CSV = "extrato_1787012861.586474.csv";
const EXTRATO_CSV_2 = "extrato_1787060678.9206839.csv";
const GENDO_CSV = "transacoes.csv";
const GENDO_CONTAS_CSV = "transacoes_contas.csv";

/** Converte linhas do extrato em "já gravadas no banco". */
function comoExistentes(rows: ExtratoRow[]): MovExistente[] {
  return rows.map((r, i) => ({
    id: `mov-${i}`,
    data: r.data,
    historico: r.historico,
    documento: r.documento,
    valor: r.valor,
    tipo: r.tipo,
    dedupKey: r.dedupKey,
    ocorrencia: r.ocorrencia,
  }));
}

describe("fixtures reais do banco (Conta/Titulares)", () => {
  it("parseia o extrato com conta, saldo e linhas", () => {
    const parsed = parseExtratoArquivo(lerFixture(EXTRATO_CSV), EXTRATO_CSV);
    expect(parsed.formato).toBe("conta-titulares");
    expect(parsed.header).toEqual({ agencia: "banco", conta: "21865663" });
    expect(parsed.rows.length).toBeGreaterThan(10);
    expect(parsed.saldoExtrato?.valor).toBeTypeOf("number");
    expect(parsed.titular).toContain("ISMALDA JANKE");
  });

  it("marca SALDO ANTERIOR / Tipo=Todos como ignorada com motivo", () => {
    const parsed = parseExtratoArquivo(lerFixture(EXTRATO_CSV), EXTRATO_CSV);
    expect((parsed.ignoradas ?? []).length).toBeGreaterThan(0);
    for (const ig of parsed.ignoradas ?? []) {
      expect(ig.motivo).toBeTruthy();
      expect(ig.historico).toContain("SALDO ANTERIOR");
    }

    const { linhas, resumo } = classificarLinhas({
      rows: parsed.rows,
      ignoradas: parsed.ignoradas,
      existentes: [],
    });
    expect(resumo.ignoradas).toBe((parsed.ignoradas ?? []).length);
    const ignoradas = linhas.filter((l) => l.situacao === "ignorada");
    expect(ignoradas.every((l) => !!l.motivo)).toBe(true);
    // Nenhuma linha de saldo entra no total de movimentações.
    expect(resumo.novas + resumo.duplicadas + resumo.conflitos).toBe(parsed.rows.length);
  });

  it("banco vazio: tudo NOVA", () => {
    const parsed = parseExtratoArquivo(lerFixture(EXTRATO_CSV), EXTRATO_CSV);
    const { resumo } = classificarLinhas({ rows: parsed.rows, existentes: [] });
    expect(resumo.novas).toBe(parsed.rows.length);
    expect(resumo.duplicadas).toBe(0);
    expect(resumo.conflitos).toBe(0);
  });

  it("reimportar o mesmo arquivo: tudo DUPLICADA, zero conflito", () => {
    const parsed = parseExtratoArquivo(lerFixture(EXTRATO_CSV), EXTRATO_CSV);
    const { resumo, linhas } = classificarLinhas({
      rows: parsed.rows,
      ignoradas: parsed.ignoradas,
      existentes: comoExistentes(parsed.rows),
    });
    expect(resumo.novas).toBe(0);
    expect(resumo.conflitos).toBe(0);
    expect(resumo.duplicadas).toBe(parsed.rows.length);
    expect(linhas.filter((l) => l.situacao === "duplicada").every((l) => !!l.existente)).toBe(true);
  });

  it("os dois extratos do cliente são o mesmo arquivo: reimport não gera nada novo", () => {
    const a = parseExtratoArquivo(lerFixture(EXTRATO_CSV), EXTRATO_CSV);
    const b = parseExtratoArquivo(lerFixture(EXTRATO_CSV_2), EXTRATO_CSV_2);
    const { resumo } = classificarLinhas({ rows: b.rows, existentes: comoExistentes(a.rows) });
    expect(resumo.novas).toBe(0);
    expect(resumo.conflitos).toBe(0);
  });
});

describe("identidade por documento (o bug conceitual)", () => {
  const parsed = () => parseExtratoArquivo(lerFixture(EXTRATO_CSV), EXTRATO_CSV);

  function comDocumento(): ExtratoRow {
    const row = parsed().rows.find((r) => r.documento && r.documento !== "0");
    if (!row) throw new Error("fixture sem linha com documento");
    return row;
  }

  it("a fixture tem documento (ID do banco) nas linhas", () => {
    const rows = parsed().rows;
    const comDoc = rows.filter((r) => r.documento && r.documento !== "0");
    expect(comDoc.length).toBeGreaterThan(5);
  });

  it("valor corrigido pelo banco vira CONFLITO, não linha nova", () => {
    const rows = parsed().rows;
    const alvo = comDocumento();
    // Banco tinha o valor errado; o extrato traz o certo.
    const existentes = comoExistentes(rows).map((m) =>
      m.documento === alvo.documento && m.data === alvo.data
        ? { ...m, valor: m.valor + 10, dedupKey: `${m.dedupKey}-antigo` }
        : m,
    );

    const { linhas, resumo } = classificarLinhas({ rows, existentes });
    expect(resumo.conflitos).toBe(1);
    expect(resumo.novas).toBe(0);

    const conflito = linhas.find((l) => l.situacao === "conflito")!;
    expect(conflito.documento).toBe(alvo.documento);
    expect(conflito.diffs).toBeDefined();
    const dValor = conflito.diffs!.find((d) => d.campo === "valor")!;
    expect(dValor.de).toBe((alvo.valor + 10).toFixed(2));
    expect(dValor.para).toBe(alvo.valor.toFixed(2));
    expect(conflito.existente!.id).toBeTruthy();
  });

  it("data corrigida pelo banco vira CONFLITO com diff de data", () => {
    const rows = parsed().rows;
    const alvo = comDocumento();
    const existentes = comoExistentes(rows).map((m) =>
      m.documento === alvo.documento && m.data === alvo.data
        ? { ...m, data: "2026-07-01", dedupKey: `${m.dedupKey}-antigo` }
        : m,
    );
    const { linhas, resumo } = classificarLinhas({ rows, existentes });
    expect(resumo.conflitos).toBe(1);
    const diffs = linhas.find((l) => l.situacao === "conflito")!.diffs!;
    expect(diffs.map((d) => d.campo)).toContain("data");
    expect(diffs.find((d) => d.campo === "data")!.de).toBe("2026-07-01");
    expect(diffs.find((d) => d.campo === "data")!.para).toBe(alvo.data);
  });

  it("histórico reescrito pelo banco vira CONFLITO com diff de historico", () => {
    const rows = parsed().rows;
    const alvo = comDocumento();
    const existentes = comoExistentes(rows).map((m) =>
      m.documento === alvo.documento && m.data === alvo.data
        ? { ...m, historico: "DESCRICAO ANTIGA DO BANCO", dedupKey: `${m.dedupKey}-antigo` }
        : m,
    );
    const { linhas, resumo } = classificarLinhas({ rows, existentes });
    expect(resumo.conflitos).toBe(1);
    expect(linhas.find((l) => l.situacao === "conflito")!.diffs!.map((d) => d.campo)).toEqual([
      "historico",
    ]);
  });

  it("sem documento cai no dedupKey legado: duplicada, e nova quando o valor muda", () => {
    const row: ExtratoRow = {
      data: "2026-08-01",
      historico: "PGT.FATURA CARTAO",
      documento: null,
      valor: 942.95,
      tipo: "D",
      ocorrencia: 1,
      dedupKey: buildDedupKey("2026-08-01", "PGT.FATURA CARTAO", null, 942.95, "D", 1),
    };
    const existente: MovExistente = {
      id: "m1",
      data: row.data,
      historico: row.historico,
      documento: null,
      valor: row.valor,
      tipo: "D",
      dedupKey: row.dedupKey,
    };
    expect(classificarLinhas({ rows: [row], existentes: [existente] }).resumo.duplicadas).toBe(1);
    // Sem identidade estável não há como saber que é a mesma: vira nova (comportamento legado).
    expect(
      classificarLinhas({ rows: [row], existentes: [{ ...existente, valor: 900, dedupKey: "outra" }] })
        .resumo.novas,
    ).toBe(1);
  });

  it("diffLinhaVsExistente retorna vazio quando são idênticas", () => {
    const rows = parsed().rows;
    const m = comoExistentes(rows)[0];
    expect(diffLinhaVsExistente(rows[0], m)).toEqual([]);
  });
});

describe("Gendo — Realizado=Não é ignorada com motivo", () => {
  it("transacoes.csv: as linhas Realizado=Não viram ignoradas", () => {
    const parsed = parseGendoTransacoesCsv(lerFixture(GENDO_CSV));
    expect(parsed.formato).toBe("gendo-transacoes");
    expect(parsed.ignoradasNaoRealizadas).toBeGreaterThan(0);
    expect(parsed.ignoradas!.length).toBe(parsed.ignoradasNaoRealizadas);

    const { linhas, resumo } = classificarLinhas({
      rows: parsed.rows,
      ignoradas: parsed.ignoradas,
      existentes: [],
    });
    expect(resumo.ignoradas).toBe(parsed.ignoradasNaoRealizadas);
    const ig = linhas.filter((l) => l.situacao === "ignorada");
    expect(ig.every((l) => (l.motivo ?? "").includes("Realizado=Não"))).toBe(true);
  });

  it("transacoes_contas.csv (contas a pagar do Gendo) também classifica", () => {
    const parsed = parseGendoTransacoesCsv(lerFixture(GENDO_CONTAS_CSV));
    const { resumo } = classificarLinhas({
      rows: parsed.rows,
      ignoradas: parsed.ignoradas,
      existentes: [],
    });
    expect(resumo.ignoradas).toBeGreaterThan(0);
    expect(resumo.conflitos).toBe(0);
  });
});

describe("vínculo com fonte manual", () => {
  const parsed = () => parseExtratoArquivo(lerFixture(EXTRATO_CSV), EXTRATO_CSV);

  it("acha a conta a pagar de mesmo valor com data a ±3 dias e aponta os diffs", () => {
    const rows = parsed().rows;
    const debito = rows.find((r) => r.tipo === "D")!;
    const vinculaveis: LancamentoVinculavel[] = [
      {
        tipo: "conta_pagar",
        id: "cp-1",
        descricao: "Aluguel sala",
        valor: debito.valor,
        data: debito.data,
        fluxo: "D",
        status: "pendente",
        dataPagamento: null,
      },
    ];
    const { linhas } = classificarLinhas({ rows, existentes: [], vinculaveis });
    const comVinculo = linhas.filter((l) => l.vinculo);
    expect(comVinculo).toHaveLength(1);
    const v = comVinculo[0].vinculo!;
    expect(v.tipo).toBe("conta_pagar");
    expect(v.id).toBe("cp-1");
    expect(v.diffs.map((d) => d.campo)).toContain("status");
    expect(v.diffs.find((d) => d.campo === "status")!.para).toBe("pago");
  });

  it("não vincula fora da janela de 3 dias nem com o fluxo trocado", () => {
    const rows = parsed().rows;
    const debito = rows.find((r) => r.tipo === "D")!;
    const longe: LancamentoVinculavel[] = [
      {
        tipo: "conta_pagar",
        id: "cp-longe",
        descricao: "Fora da janela",
        valor: debito.valor,
        data: "2026-01-01",
        fluxo: "D",
        status: "pendente",
      },
      {
        tipo: "receita_dia",
        id: "rd-fluxo-errado",
        descricao: "Crédito com valor de débito",
        valor: debito.valor,
        data: debito.data,
        fluxo: "C",
      },
    ];
    const { linhas } = classificarLinhas({ rows, existentes: [], vinculaveis: longe });
    expect(linhas.filter((l) => l.vinculo?.id === "cp-longe")).toHaveLength(0);
    const creditosVinculados = linhas.filter((l) => l.vinculo?.id === "rd-fluxo-errado");
    for (const l of creditosVinculados) expect(l.tipo).toBe("C");
  });

  it("um lançamento manual só é vinculado uma vez", () => {
    const row: ExtratoRow = {
      data: "2026-08-05",
      historico: "CREDITO PIX - X",
      documento: "doc-a",
      valor: 100,
      tipo: "C",
      ocorrencia: 1,
      dedupKey: buildDedupKey("2026-08-05", "CREDITO PIX - X", "doc-a", 100, "C", 1),
    };
    const row2: ExtratoRow = {
      ...row,
      documento: "doc-b",
      dedupKey: buildDedupKey("2026-08-05", "CREDITO PIX - X", "doc-b", 100, "C", 1),
    };
    const vinculaveis: LancamentoVinculavel[] = [
      { tipo: "receita_dia", id: "rd-1", descricao: "Receita", valor: 100, data: "2026-08-05", fluxo: "C" },
    ];
    const { linhas } = classificarLinhas({ rows: [row, row2], existentes: [], vinculaveis });
    expect(linhas.filter((l) => l.vinculo).length).toBe(1);
  });
});

describe("linha já importada com vínculo divergente", () => {
  const parsed = () => parseExtratoArquivo(lerFixture(EXTRATO_CSV), EXTRATO_CSV);

  /** Uma conta a pagar pendente casando com o débito (mesmo valor, mesma data). */
  function contaPagarPendente(debito: ExtratoRow): LancamentoVinculavel {
    return {
      tipo: "conta_pagar",
      id: "cp-divergente",
      descricao: "Fornecedor X",
      valor: debito.valor,
      data: debito.data,
      fluxo: "D",
      status: "pendente",
      dataPagamento: null,
    };
  }

  it("classifica como CONFLITO, e não como duplicada", () => {
    const rows = parsed().rows;
    const debito = rows.find((r) => r.tipo === "D")!;
    const { linhas, resumo } = classificarLinhas({
      rows,
      existentes: comoExistentes(rows), // tudo já importado, idêntico
      vinculaveis: [contaPagarPendente(debito)],
    });

    expect(resumo.conflitos).toBe(1);
    expect(resumo.novas).toBe(0);
    expect(resumo.duplicadas).toBe(rows.length - 1);

    const conflito = linhas.find((l) => l.situacao === "conflito")!;
    expect(conflito.origemConflito).toBe("vinculo");
    expect(conflito.motivo).toContain("vinculada está divergente");
    // A movimentação em si está certa: nenhum diff de movimentação.
    expect(conflito.diffs ?? []).toEqual([]);
    // O que diverge está no vínculo.
    expect(conflito.vinculo!.id).toBe("cp-divergente");
    expect(conflito.vinculo!.diffs.length).toBeGreaterThan(0);
    expect(conflito.vinculo!.diffs.map((d) => d.campo)).toContain("status");
  });

  it("vínculo idêntico (nada a corrigir) segue duplicada", () => {
    const rows = parsed().rows;
    const debito = rows.find((r) => r.tipo === "D")!;
    const jaPago: LancamentoVinculavel = {
      ...contaPagarPendente(debito),
      status: "pago",
      dataPagamento: debito.data,
    };
    const { linhas, resumo } = classificarLinhas({
      rows,
      existentes: comoExistentes(rows),
      vinculaveis: [jaPago],
    });
    expect(resumo.conflitos).toBe(0);
    expect(resumo.duplicadas).toBe(rows.length);
    const comVinculo = linhas.find((l) => l.vinculo)!;
    expect(comVinculo.situacao).toBe("duplicada");
    expect(comVinculo.vinculo!.diffs).toEqual([]);
  });

  it("diff de movimentação continua mandando no motivo, mesmo com vínculo divergente", () => {
    const rows = parsed().rows;
    const debito = rows.find((r) => r.tipo === "D" && r.documento && r.documento !== "0")!;
    const existentes = comoExistentes(rows).map((m) =>
      m.documento === debito.documento && m.data === debito.data
        ? { ...m, valor: m.valor + 10, dedupKey: `${m.dedupKey}-antigo` }
        : m,
    );
    const { linhas } = classificarLinhas({
      rows,
      existentes,
      vinculaveis: [contaPagarPendente(debito)],
    });
    const conflito = linhas.find((l) => l.documento === debito.documento)!;
    expect(conflito.situacao).toBe("conflito");
    expect(conflito.origemConflito).toBe("movimentacao");
    expect(conflito.diffs!.map((d) => d.campo)).toContain("valor");
  });

  it("rótulo e conteúdo batem: nada é 'Já importada, idêntica.' exibindo diff", () => {
    const rows = parsed().rows;
    const debito = rows.find((r) => r.tipo === "D")!;
    const { linhas } = classificarLinhas({
      rows,
      ignoradas: parsed().ignoradas,
      existentes: comoExistentes(rows),
      vinculaveis: [contaPagarPendente(debito)],
    });
    for (const l of linhas) {
      const temDiff = (l.diffs?.length ?? 0) > 0 || (l.vinculo?.diffs?.length ?? 0) > 0;
      if (l.situacao === "duplicada") {
        expect(temDiff).toBe(false);
        expect(l.motivo).toBe("Já importada, idêntica.");
      }
      if (temDiff) expect(l.situacao).toBe("conflito");
      if (l.situacao === "conflito") expect(temDiff).toBe(true);
    }
  });
});

describe("período e totais do preview", () => {
  it("bate com a fixture", () => {
    const parsed = parseExtratoArquivo(lerFixture(EXTRATO_CSV), EXTRATO_CSV);
    const { de, ate } = periodoDe(parsed.rows);
    expect(de).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(ate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(de! <= ate!).toBe(true);

    const totais = totaisDe(parsed.rows);
    expect(totais.creditos.n + totais.debitos.n).toBe(parsed.rows.length);
    const somaManual = parsed.rows.reduce((s, r) => s + r.valor, 0);
    expect(Math.abs(totais.creditos.soma + totais.debitos.soma - somaManual)).toBeLessThan(0.02);
  });
});

import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseExtratoArquivo, type ExtratoParseResult } from "@shared/extrato-import";
import { classificarLinhas, type MovExistente } from "@shared/extrato-diff";
import {
  balancoPreview,
  balancoResultado,
  type ContagemLinhas,
} from "@shared/extrato-balanco";

const FIXTURES =
  "C:/Users/Edson/AppData/Local/Temp/claude/E--Emanua-Financeiro-Emanua-Financeiro/f79e99f8-e0a9-42bd-9467-b11e32d15f0f/scratchpad/fixtures";

const EXTRATO = "extrato_corrigido.csv";

function contar(linhas: { situacao: string }[]): ContagemLinhas {
  const c: ContagemLinhas = { nova: 0, duplicada: 0, conflito: 0, ignorada: 0, naoLida: 0 };
  for (const l of linhas) {
    if (l.situacao === "nao-lida") c.naoLida++;
    else c[l.situacao as "nova" | "duplicada" | "conflito" | "ignorada"]++;
  }
  return c;
}

/** Transforma as linhas do arquivo em movimentações "já gravadas". */
function comoExistentes(rows: any[], mexer?: (r: any, i: number) => any): MovExistente[] {
  return rows.map((r, i) => {
    const base = {
      id: `mov-${i}`,
      data: r.data,
      historico: r.historico,
      documento: r.documento,
      valor: r.valor,
      tipo: r.tipo,
      dedupKey: r.dedupKey,
      ocorrencia: r.ocorrencia,
    };
    return mexer ? mexer(base, i) : base;
  });
}

function ler(nome: string): ExtratoParseResult {
  return parseExtratoArquivo(fs.readFileSync(`${FIXTURES}/${nome}`, "utf-8"), nome);
}

/*
 * FIXTURES QUE TENTAM ENGANAR O BALANÇO.
 *
 * Cada arquivo esconde uma linha que o leitor antigo descartava em silêncio:
 * ela não entrava em `rows` nem em `ignoradas`, e como `linhasLidas` era
 * `rows.length + ignoradas.length`, a conta fechava POR CONSTRUÇÃO. O caso real
 * foi um CSV de 33 linhas onde a de R$ 0,00 evaporou e a tela mostrou selo verde
 * "Confere" e "Nenhuma linha ficou de fora".
 *
 * O contrato testado aqui: a soma das categorias TEM que dar o número de linhas
 * de dados DO ARQUIVO — nunca um número derivado do que sobreviveu ao filtro.
 */
const MAUS: { arquivo: string; linhasDeDados: number; naoLidas: number; oQueEsconde: string }[] = [
  { arquivo: "mau_valor_zero.csv", linhasDeDados: 5, naoLidas: 1, oQueEsconde: "linha de R$ 0,00" },
  { arquivo: "mau_negativo.csv", linhasDeDados: 5, naoLidas: 2, oQueEsconde: "dois valores negativos" },
  { arquivo: "mau_data_invalida.csv", linhasDeDados: 5, naoLidas: 1, oQueEsconde: "data 99/99/9999" },
  {
    arquivo: "mau_tipo_desconhecido.csv",
    linhasDeDados: 5,
    naoLidas: 1,
    oQueEsconde: "Tipo=Estorno (era um `continue` mudo)",
  },
  {
    arquivo: "mau_truncada.csv",
    linhasDeDados: 5,
    naoLidas: 2,
    oQueEsconde: "linha cortada no download + R$ 0,00",
  },
  { arquivo: "so_cabecalho.csv", linhasDeDados: 0, naoLidas: 0, oQueEsconde: "só o cabeçalho" },
  {
    arquivo: "so_cabecalho_banco.csv",
    linhasDeDados: 0,
    naoLidas: 0,
    oQueEsconde: "só o cabeçalho de colunas",
  },
];

describe("o leitor conta as linhas NA FONTE e não perde nenhuma", () => {
  for (const caso of MAUS) {
    it(`${caso.arquivo} — ${caso.oQueEsconde}`, () => {
      const p = ler(caso.arquivo);
      expect(p.linhasArquivo).toBe(caso.linhasDeDados);
      expect(p.naoLidas.length).toBe(caso.naoLidas);
      // A única equação que importa: nada pode sumir entre o arquivo e as listas.
      expect(p.rows.length + (p.ignoradas?.length ?? 0) + p.naoLidas.length).toBe(p.linhasArquivo);
      // Toda linha perdida traz motivo e conteúdo — senão o usuário não a acha.
      for (const nl of p.naoLidas) {
        expect(nl.motivo.trim().length).toBeGreaterThan(0);
        expect(nl.linha).toBeGreaterThan(0);
      }
      // `erros` tem uma frase por linha não lida, e nada além disso.
      expect(p.erros.length).toBe(p.naoLidas.length);
    });
  }

  it("o arquivo real continua fechando, sem inventar linha não lida", () => {
    const p = ler(EXTRATO);
    expect(p.linhasArquivo).toBe(32);
    expect(p.naoLidas.length).toBe(0);
    expect(p.rows.length + (p.ignoradas?.length ?? 0)).toBe(p.linhasArquivo);
  });

  it("linhasArquivo NÃO é derivado de rows + ignoradas", () => {
    // Se alguém voltar a calcular o total depois do filtro, este teste cai:
    // aqui o arquivo tem 5 linhas de dados e só 3 sobrevivem ao leitor.
    const p = ler("mau_valor_zero.csv");
    expect(p.rows.length + (p.ignoradas?.length ?? 0)).toBe(4);
    expect(p.linhasArquivo).toBe(5);
  });
});

describe("balanço do preview: a soma das categorias é o total de linhas do arquivo", () => {
  for (const caso of MAUS) {
    it(`${caso.arquivo} fecha ou acusa, nunca sorri em silêncio`, () => {
      const p = ler(caso.arquivo);
      const { linhas } = classificarLinhas({
        rows: p.rows,
        ignoradas: p.ignoradas ?? [],
        naoLidas: p.naoLidas,
        existentes: [],
        vinculaveis: [],
      });
      const c = contar(linhas);
      const b = balancoPreview(p.linhasArquivo, c);

      expect(b.novas + b.conflitos + b.jaNoSistema + b.descartadas + b.naoLidas).toBe(
        p.linhasArquivo,
      );
      expect(b.naoClassificadas).toBe(0);
      expect(b.total).toBe(p.linhasArquivo);
      expect(b.fecha).toBe(true);
      // A linha perdida tem categoria PRÓPRIA — não se esconde em "descartadas".
      expect(b.naoLidas).toBe(caso.naoLidas);
      expect(linhas.filter((l) => l.situacao === "nao-lida").length).toBe(caso.naoLidas);
    });
  }

  it("fecha no arquivo real, com conflito e linha descartada", () => {
    const p = ler(EXTRATO);
    const existentes = comoExistentes(p.rows.slice(0, -1), (m, i) =>
      i === 0 ? { ...m, valor: m.valor + 9.74 } : m,
    );
    const { linhas } = classificarLinhas({
      rows: p.rows,
      ignoradas: p.ignoradas ?? [],
      naoLidas: p.naoLidas,
      existentes,
      vinculaveis: [],
    });
    const c = contar(linhas);
    const b = balancoPreview(p.linhasArquivo, c);

    expect(b.novas + b.conflitos + b.jaNoSistema + b.descartadas + b.naoLidas).toBe(
      p.linhasArquivo,
    );
    expect(b.naoClassificadas).toBe(0);
    expect(b.fecha).toBe(true);
    expect(b.descartadas).toBe(1); // SALDO ANTERIOR
    expect(b.conflitos).toBe(1);
    expect(b.novas).toBe(1);
    expect(b.naoLidas).toBe(0);
    expect(b.jaNoSistema).toBe(p.linhasArquivo - 3);
  });

  it("fecha quando o arquivo é todo novo", () => {
    const p = ler(EXTRATO);
    const { linhas } = classificarLinhas({
      rows: p.rows,
      ignoradas: p.ignoradas ?? [],
      naoLidas: p.naoLidas,
      existentes: [],
      vinculaveis: [],
    });
    const b = balancoPreview(p.linhasArquivo, contar(linhas));
    expect(b.novas).toBe(p.rows.length);
    expect(b.total).toBe(p.linhasArquivo);
    expect(b.fecha).toBe(true);
  });

  it("denuncia a linha que sumiu em vez de deixar a conta não fechar em silêncio", () => {
    // Este é o caso relatado: 32 linhas no arquivo, 31 classificadas.
    const b = balancoPreview(32, { nova: 0, duplicada: 30, conflito: 0, ignorada: 1, naoLida: 0 });
    expect(b.naoClassificadas).toBe(1);
    expect(b.fecha).toBe(false);
    expect(b.total).toBe(32);
  });

  it("acusa também quando as categorias somam MAIS do que o arquivo tem", () => {
    const b = balancoPreview(5, { nova: 4, duplicada: 2, conflito: 0, ignorada: 1, naoLida: 0 });
    expect(b.naoClassificadas).toBe(-2);
    expect(b.fecha).toBe(false);
  });
});

describe("balanço do resultado: são os números da API, não os do preview", () => {
  function soma(b: ReturnType<typeof balancoResultado>): number {
    return (
      b.inseridas +
      b.regravadas +
      b.jaNoSistema +
      b.foraDaSelecao +
      b.descartadas +
      b.naoLidas +
      b.naoClassificadas
    );
  }

  it("modo somente-novas: o conflito continua como está e conta como já no sistema", () => {
    const b = balancoResultado({
      linhasLidas: 32,
      inseridas: 1,
      regravadas: 0,
      jaNoSistema: 30,
      foraDaSelecao: 0,
      descartadas: 1,
      naoLidas: 0,
    });
    expect(b.jaNoSistema).toBe(30);
    expect(soma(b)).toBe(32);
    expect(b.fecha).toBe(true);
  });

  it("a linha não lida aparece no resultado, com nome próprio", () => {
    const b = balancoResultado({
      linhasLidas: 5,
      inseridas: 3,
      regravadas: 0,
      jaNoSistema: 0,
      foraDaSelecao: 0,
      descartadas: 1,
      naoLidas: 1,
    });
    expect(b.naoLidas).toBe(1);
    expect(b.descartadas).toBe(1);
    expect(b.fecha).toBe(true);
  });

  /*
   * O TESTE QUE O BALANÇO ANTIGO NÃO PODIA PASSAR.
   *
   * `balancoResultado` fazia limitar(inseridas, contagem.nova) e depois
   * foraDaSelecao = nova − inseridas, jaNoSistema = duplicada + (conflito −
   * regravadas). Algebricamente isso colapsa em nova + duplicada + conflito +
   * ignorada, ou seja, no balanço do PREVIEW — fechava sempre, tivesse o
   * servidor respondido o que tivesse. Agora a resposta entra crua e mentira
   * aritmética aparece.
   */
  it("o servidor gravando MENOS do que disse: a conta não fecha e a tela precisa dizer", () => {
    const b = balancoResultado({
      linhasLidas: 32,
      inseridas: 1,
      regravadas: 0,
      jaNoSistema: 28, // uma linha não foi para lugar nenhum
      foraDaSelecao: 0,
      descartadas: 1,
      naoLidas: 0,
    });
    expect(b.naoClassificadas).toBe(2);
    expect(b.fecha).toBe(false);
  });

  it("o servidor reportando MAIS gravações do que o arquivo tinha: acusa, não disfarça", () => {
    const b = balancoResultado({
      linhasLidas: 32,
      inseridas: 99,
      regravadas: 99,
      jaNoSistema: 30,
      foraDaSelecao: 0,
      descartadas: 1,
      naoLidas: 0,
    });
    // O balanço antigo grampeava os números no teto do preview e fechava.
    expect(b.inseridas).toBe(99);
    expect(b.naoClassificadas).toBeLessThan(0);
    expect(b.fecha).toBe(false);
  });

  it("bate com o preview do mesmo arquivo quando o import faz o combinado", () => {
    const p = ler(EXTRATO);
    const existentes = comoExistentes(p.rows.slice(0, -1), (m, i) =>
      i === 0 ? { ...m, valor: m.valor + 9.74 } : m,
    );
    const { linhas } = classificarLinhas({
      rows: p.rows,
      ignoradas: p.ignoradas ?? [],
      naoLidas: p.naoLidas,
      existentes,
      vinculaveis: [],
    });
    const c = contar(linhas);
    const prev = balancoPreview(p.linhasArquivo, c);
    const res = balancoResultado({
      linhasLidas: p.linhasArquivo,
      inseridas: c.nova,
      regravadas: c.conflito,
      jaNoSistema: c.duplicada,
      foraDaSelecao: 0,
      descartadas: c.ignorada,
      naoLidas: c.naoLida,
    });

    expect(prev.total).toBe(p.linhasArquivo);
    expect(soma(res)).toBe(p.linhasArquivo);
    expect(res.inseridas).toBe(prev.novas);
    expect(res.regravadas).toBe(prev.conflitos);
    expect(res.jaNoSistema).toBe(prev.jaNoSistema);
    expect(res.descartadas).toBe(prev.descartadas);
  });
});

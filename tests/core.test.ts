import { describe, expect, it } from "vitest";
import { parseExtratoCsv, buildDedupKey } from "@shared/extrato-import";
import { sugerirConciliacao } from "@shared/extrato-conciliacao";
import { classifyProLabore, resolveDebitoNatureza } from "@shared/prolabore";
import {
  calcMinimoSobrevivencia,
  calcPontoEquilibrio,
  sumReceitasMes,
} from "@shared/minimo-sobrevivencia";
import { parseBrNumber, parseBrDate } from "@shared/parse-br";

describe("parse-br", () => {
  it("parseia número BR", () => {
    expect(parseBrNumber("1.234,56")).toBe(1234.56);
  });
  it("parseia data BR", () => {
    expect(parseBrDate("10/08/2026")).toBe("2026-08-10");
  });
});

describe("extrato-import", () => {
  it("parseia CSV Viacredi-like", () => {
    const csv = `16;16;758450;;
03/02/2025;CR.DESC. DE TITULO;158.966;11.746,72;C
03/02/2025;PIX ENVIADO;1;50,00;D`;
    const r = parseExtratoCsv(csv);
    expect(r.header).toEqual({ agencia: "16", conta: "758450" });
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].tipo).toBe("C");
    expect(r.rows[0].valor).toBe(11746.72);
    expect(r.rows[1].dedupKey).toBe(
      buildDedupKey("2025-02-03", "PIX ENVIADO", "1", 50, "D", 1),
    );
  });

  it("parseia CSV Gendo transacoes.csv", () => {
    const csv = `"Data";"Vencimento";"Comanda";"Responsável";"Categoria";"Descrição";"Realizado";"Valor"
"10/08/2026";"25/08/2026";"0";"--";"Bens de pequeno valor";"Iplus";"Não";"-216,85"
"09/08/2026";"09/08/2026";"53";"--";"Pagamento";"Permuta";"Sim";"145,00"
"09/08/2026";"09/08/2026";"0";"--";"Combustível";"Abastecimento carro";"Sim";"-100,00"
"05/08/2026";"05/08/2026";"12";"--";"Taxas";"Taxa Cartão";"Sim";"-4,88"`;
    const r = parseExtratoCsv(csv);
    expect(r.formato).toBe("gendo-transacoes");
    expect(r.header).toEqual({ agencia: "gendo", conta: "transacoes" });
    expect(r.ignoradasNaoRealizadas).toBe(1);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({
      data: "2026-08-09",
      tipo: "C",
      valor: 145,
      documento: "comanda:53",
    });
    expect(r.rows[1].tipo).toBe("D");
    expect(r.rows[1].valor).toBe(100);
    expect(r.rows[2].valor).toBe(4.88);
  });
});

describe("extrato-conciliacao", () => {
  it("sugere match por valor e data", () => {
    const sug = sugerirConciliacao(
      [{ id: "m1", data: "2026-08-10", valor: 100, tipo: "C" }],
      [{ id: "r1", valor: 100, dataVencimento: "2026-08-12", status: "aberta" }],
    );
    expect(sug).toHaveLength(1);
    expect(sug[0].recebivelId).toBe("r1");
  });
});

describe("prolabore", () => {
  it("classifica por regra", () => {
    expect(
      classifyProLabore("PIX ATAIZE SILVA", [{ socio: "ataize", padrao: "ATAIZE", ordem: 1 }]),
    ).toBe("ataize");
  });
  it("resolve override manual", () => {
    const r = resolveDebitoNatureza("qualquer", "ataize", []);
    expect(r.natureza).toBe("pro_labore");
    expect(r.socio).toBe("ataize");
  });
  it("override excluir vira excluido", () => {
    expect(resolveDebitoNatureza("x", "excluir", []).natureza).toBe("excluido");
  });
});

describe("minimo-sobrevivencia", () => {
  it("soma mínimo", () => {
    expect(calcMinimoSobrevivencia({ contasPagarMes: 100, custosFixos: 50, custosVariaveis: 25 })).toBe(
      175,
    );
  });
  it("calcula PE", () => {
    expect(calcPontoEquilibrio(1000, 50)).toBe(2000);
    expect(calcPontoEquilibrio(1000, 0)).toBeNull();
  });
  it("soma receitas do mês", () => {
    expect(
      sumReceitasMes(
        [
          { data: "2026-08-01", valor: 100 },
          { data: "2026-08-15", valor: 50.5 },
          { data: "2026-07-01", valor: 999 },
        ],
        2026,
        8,
      ),
    ).toBe(150.5);
  });
});

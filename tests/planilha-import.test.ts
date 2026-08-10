import { describe, expect, it } from "vitest";
import {
  parsePlanilhaMovimentacoesRows,
  mapCategoriaPagar,
  inferFormaReceita,
  isReceitaOperacional,
  isTransferenciaInterna,
  inferSaldoInicialPlanilha,
} from "@shared/planilha-movimentacoes-import";

describe("planilha-movimentacoes-import", () => {
  const header = [
    "Data",
    "Mês",
    "Conta",
    "Fonte",
    "Tipo",
    "Descrição",
    "Categoria",
    "Subcategoria",
    "Entrada (R$)",
    "Saída (R$)",
    "Valor líquido (R$)",
    "Saldo após (R$)",
    "Observação",
  ];

  it("parseia linhas de entrada e saída", () => {
    const r = parsePlanilhaMovimentacoesRows([
      header,
      [
        new Date(2026, 5, 3),
        "2026-06",
        "Viacredi",
        "Viacredi - Jun/2026",
        "Entrada",
        "CREDITO PIX - PEDRO",
        "Receita operacional",
        "Atendimentos/serviços",
        150,
        0,
        150,
        283.14,
        null,
      ],
      [
        "03/06/2026",
        "2026-06",
        "Viacredi",
        "Viacredi - Jun/2026",
        "Saída",
        "CARTAO DEBITO - REDE TOP",
        "Alimentação/Mercado",
        "Mercado / alimentação",
        0,
        13.47,
        -13.47,
        269.67,
        null,
      ],
    ]);
    expect(r.erros).toEqual([]);
    expect(r.rows).toHaveLength(2);
    expect(r.rows[0].data).toBe("2026-06-03");
    expect(r.rows[0].tipo).toBe("Entrada");
    expect(r.rows[0].entrada).toBe(150);
    expect(r.rows[0].saldoApos).toBe(283.14);
    expect(r.rows[1].tipo).toBe("Saida");
    expect(r.rows[1].saida).toBe(13.47);
    expect(r.resumo.receitaOperacional).toBe(1);
  });

  it("infere saldo inicial pelo Saldo após", () => {
    const r = parsePlanilhaMovimentacoesRows([
      header,
      [
        "01/06/2026",
        "2026-06",
        "Viacredi",
        "x",
        "Saída",
        "Mercado",
        "Alimentação/Mercado",
        null,
        0,
        102.5,
        -102.5,
        123.41,
        null,
      ],
    ]);
    const s = inferSaldoInicialPlanilha(r.rows);
    expect(s.valor).toBe(225.91); // 123.41 - (-102.5)
    expect(s.data).toBe("2026-05-31");
  });

  it("mapeia categorias e forma", () => {
    expect(mapCategoriaPagar("Espaço profissional")).toBe("Aluguel");
    expect(mapCategoriaPagar("Compras/Fornecedores")).toBe("Insumos");
    expect(inferFormaReceita("Cloudwalk/InfinitePay", "Depósito de vendas")).toBe("cartao");
    expect(inferFormaReceita("Viacredi", "CREDITO PIX - JOAO")).toBe("pix");
    expect(isReceitaOperacional("Receita operacional")).toBe(true);
    expect(isTransferenciaInterna("Transferência interna")).toBe(true);
  });
});

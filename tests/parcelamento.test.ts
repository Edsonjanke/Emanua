import { describe, expect, it } from "vitest";
import {
  addMeses,
  datasParcelasMensais,
  gerarParcelas,
  normalizaTotalParcelas,
  proximoVencimentoMensal,
} from "@shared/parcelamento";
import { diasVencido, estadoVencimento, rotuloAtraso } from "@shared/vencimento";

describe("parcelamento", () => {
  it("gera N vencimentos mensais a partir da data base", () => {
    expect(datasParcelasMensais("2026-08-18", 3)).toEqual([
      "2026-08-18",
      "2026-09-18",
      "2026-10-18",
    ]);
  });

  it("gruda no último dia do mês em vez de vazar para o mês seguinte", () => {
    expect(addMeses("2026-01-31", 1)).toBe("2026-02-28");
    expect(addMeses("2028-01-31", 1)).toBe("2028-02-29"); // bissexto
    expect(addMeses("2026-03-31", 1)).toBe("2026-04-30");
  });

  it("vira o ano corretamente", () => {
    expect(datasParcelasMensais("2026-11-10", 3)).toEqual([
      "2026-11-10",
      "2026-12-10",
      "2027-01-10",
    ]);
    expect(proximoVencimentoMensal("2026-12-05")).toBe("2027-01-05");
  });

  it("normaliza o total de parcelas", () => {
    expect(normalizaTotalParcelas(undefined)).toBe(0);
    expect(normalizaTotalParcelas(1)).toBe(0);
    expect(normalizaTotalParcelas("3")).toBe(3);
    expect(normalizaTotalParcelas(999)).toBe(60);
  });

  it("numera as parcelas 1..N mantendo o molde", () => {
    const parcelas = gerarParcelas({ clienteNome: "Família PEPRATIC" }, "2026-08-18", 3);
    expect(parcelas.map((p) => `${p.parcelaAtual}/${p.totalParcelas}`)).toEqual([
      "1/3",
      "2/3",
      "3/3",
    ]);
    expect(parcelas[2].clienteNome).toBe("Família PEPRATIC");
    expect(parcelas[2].dataVencimento).toBe("2026-10-18");
  });
});

describe("vencimento", () => {
  const hoje = "2026-08-18";

  it("separa vence hoje de vence em breve", () => {
    expect(estadoVencimento(hoje, hoje)).toBe("hoje");
    expect(estadoVencimento("2026-08-20", hoje)).toBe("breve");
    expect(estadoVencimento("2026-08-25", hoje)).toBe("breve"); // 7º dia ainda é "breve"
    expect(estadoVencimento("2026-08-26", hoje)).toBe("aberto");
    expect(estadoVencimento("2026-08-15", hoje)).toBe("vencido");
    expect(estadoVencimento("2026-08-15", hoje, { quitado: true })).toBe("quitado");
  });

  it("conta o aging em dias", () => {
    expect(diasVencido("2026-08-15", hoje)).toBe(3);
    expect(diasVencido(hoje, hoje)).toBe(0);
    expect(diasVencido("2026-08-30", hoje)).toBe(0);
  });

  it("rotula o atraso em português", () => {
    expect(rotuloAtraso("2026-08-15", hoje)).toBe("vencido há 3 dias");
    expect(rotuloAtraso("2026-08-17", hoje)).toBe("vencido há 1 dia");
    expect(rotuloAtraso(hoje, hoje)).toBeNull();
  });
});

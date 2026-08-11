import { describe, expect, it } from "vitest";
import { parseGendoContasPagarCsv } from "@shared/contas-pagar-import";

describe("contas-pagar-import", () => {
  it("parseia CSV Gendo de contas a pagar", () => {
    const csv = `"Data";"Vencimento";"Comanda";"Responsável";"Categoria";"Descrição";"Realizado";"Valor";"Forma Pagto."
"10/08/2026";"25/08/2026";"0";"";"Cursos/formações";"Faculdade biomedicina";"Não";"-283,58";"Conta Corrente"
"10/08/2026";"15/08/2026";"0";"";"Despesas com aluguel";"Aluguel sala";"Não";"-1.400,00";"Conta Corrente"
"09/08/2026";"09/08/2026";"0";"";"Combustível";"Abastecimento carro";"Sim";"-100,00";""`;
    const r = parseGendoContasPagarCsv(csv, "2026-08-10");
    expect(r.erros).toEqual([]);
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0]).toMatchObject({
      dataVencimento: "2026-08-25",
      descricao: "Faculdade biomedicina",
      status: "pendente",
      valor: 283.58,
    });
    expect(r.rows[1]).toMatchObject({
      categoria: "Aluguel",
      valor: 1400,
      status: "pendente",
    });
    expect(r.rows[2]).toMatchObject({
      status: "pago",
      dataPagamento: "2026-08-09",
      valor: 100,
    });
    expect(r.resumo).toEqual({ total: 3, pagas: 1, pendentes: 2, vencidas: 0 });
  });
});

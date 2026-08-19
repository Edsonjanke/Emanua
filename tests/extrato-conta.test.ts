import fs from "node:fs";
import { describe, expect, it } from "vitest";
import { parseExtratoArquivo } from "@shared/extrato-import";
import {
  validarIdentidadeConta,
  planejarContaAtiva,
  perguntaContaDiferente,
  type ContaIdentificada,
} from "@shared/extrato-conta";

const FIXTURES =
  "C:/Users/Edson/AppData/Local/Temp/claude/E--Emanua-Financeiro-Emanua-Financeiro/f79e99f8-e0a9-42bd-9467-b11e32d15f0f/scratchpad/fixtures";

const CONTA_REAL: ContaIdentificada = {
  id: "conta-real",
  nome: "Conta 21865663 · ISMALDA JANKE",
  agencia: "banco",
  conta: "21865663",
};

/*
 * O ARQUIVO INVÁLIDO QUE TROCAVA A CONTA ATIVA.
 *
 * Ao importar um CSV cuja primeira linha foi lida como cabeçalho, o sistema
 * criou uma conta com agência "2026-07-01" e conta "D900" — a transação comida
 * virou IDENTIDADE DE CONTA —, ativou essa conta, desativou a real, e o painel
 * foi de "Saldo real hoje R$ 223,95" para "Defina o saldo inicial". A tela de
 * resultado ainda afirmou: "Nenhum lançamento que já estava no sistema foi
 * alterado". Duas portas fecham isso, e as duas estão testadas aqui.
 */
describe("identidade de conta: arquivo torto não vira conta", () => {
  it("agência com cara de data é recusada, com mensagem que diz o que fazer", () => {
    const r = validarIdentidadeConta("2026-07-01", "D900");
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.campo).toBe("agencia");
    expect(r.motivo).toMatch(/é uma data/);
    expect(r.motivo).toMatch(/nenhuma conta foi criada/i);
  });

  it("data em dd/mm/aaaa e data impossível também são recusadas", () => {
    expect(validarIdentidadeConta("01/07/2026", "123").ok).toBe(false);
    expect(validarIdentidadeConta("2026-07-32", "123").ok).toBe(false);
    expect(validarIdentidadeConta("1/7/26", "123").ok).toBe(false);
  });

  it("campo vazio é recusado — dos dois lados", () => {
    expect(validarIdentidadeConta("", "21865663").ok).toBe(false);
    expect(validarIdentidadeConta("banco", "   ").ok).toBe(false);
  });

  it("valor em reais e histórico inteiro não viram conta", () => {
    expect(validarIdentidadeConta("banco", "999,00").ok).toBe(false);
    expect(
      validarIdentidadeConta("banco", "DEBITO PIX - MERCADO PAGO INSTITUICAO DE PAGAMENTO").ok,
    ).toBe(false);
    expect(validarIdentidadeConta("banco", "1;PIX;100,00;Credito").ok).toBe(false);
  });

  it("as identidades REAIS do sistema continuam passando", () => {
    for (const [ag, ct] of [
      ["banco", "21865663"],
      ["0101", "21865663"],
      ["gendo", "transacoes"],
      ["planilha", "planilha-consolidada"],
      ["1234", "12.345-6"],
    ]) {
      const r = validarIdentidadeConta(ag, ct);
      expect(r.ok, `${ag}/${ct}`).toBe(true);
    }
  });

  it("a fixture ruim não chega nem a ter identidade para validar", () => {
    // Com o detector de cabeçalho consertado, a linha ISO é DADO: não sobra
    // header nenhum, e sem header o import é recusado antes de qualquer escrita.
    const p = parseExtratoArquivo(
      fs.readFileSync(`${FIXTURES}/cabecalho_come_iso.csv`, "utf-8"),
      "cabecalho_come_iso.csv",
    );
    expect(p.header).toBeNull();
    // E se alguém mandar a identidade velha direto na API, ela é barrada.
    expect(validarIdentidadeConta("2026-07-01", "D900").ok).toBe(false);
  });
});

describe("conta ativa: trocar é decisão do usuário, nunca efeito colateral", () => {
  const extrato = { agencia: "banco", conta: "99999999", nome: "Conta 99999999" };

  it("extrato de OUTRA conta, sem resposta: pergunta, e ninguém escreve nada", () => {
    const p = planejarContaAtiva({ ativaAtual: CONTA_REAL, alvo: null, extrato });
    expect(p.acao).toBe("perguntar");
    if (p.acao !== "perguntar") return;
    expect(p.contaAtiva.nome).toBe(CONTA_REAL.nome);
    expect(p.contaExtrato.existe).toBe(false);
    const texto = perguntaContaDiferente(p);
    expect(texto).toMatch(/diferente da sua conta ativa/i);
    expect(texto).toMatch(/Nada foi gravado ainda/i);
  });

  it("o arquivo inválido de antes: mesmo cenário, mesma parada", () => {
    const p = planejarContaAtiva({
      ativaAtual: CONTA_REAL,
      alvo: null,
      extrato: { agencia: "2026-07-01", conta: "D900", nome: "Conta 2026-07-01/D900" },
    });
    // Nem chega a ativar: para e pergunta. (E a identidade já teria sido
    // recusada antes disto — são duas portas independentes.)
    expect(p.acao).toBe("perguntar");
  });

  it("respondeu 'manter': importa sem mexer em quem está ativa", () => {
    const p = planejarContaAtiva({
      ativaAtual: CONTA_REAL,
      alvo: null,
      extrato,
      decisao: "manter",
    });
    expect(p).toEqual({ acao: "manter", motivo: "usuario-pediu" });
  });

  it("respondeu 'trocar': aí sim ativa a conta do extrato", () => {
    const p = planejarContaAtiva({
      ativaAtual: CONTA_REAL,
      alvo: null,
      extrato,
      decisao: "trocar",
    });
    expect(p).toEqual({ acao: "ativar", motivo: "usuario-pediu" });
  });

  it("extrato da PRÓPRIA conta ativa: nada a perguntar", () => {
    const p = planejarContaAtiva({
      ativaAtual: CONTA_REAL,
      alvo: CONTA_REAL,
      extrato: { agencia: CONTA_REAL.agencia, conta: CONTA_REAL.conta, nome: CONTA_REAL.nome },
    });
    expect(p).toEqual({ acao: "ativar", motivo: "ja-era-a-ativa" });
  });

  it("primeira conta do sistema: ativa, porque não há nada a perder", () => {
    const p = planejarContaAtiva({ ativaAtual: null, alvo: null, extrato });
    expect(p).toEqual({ acao: "ativar", motivo: "primeira-conta" });
  });

  it("`ativar: false` (contrato antigo) continua significando 'não mexa'", () => {
    const p = planejarContaAtiva({ ativaAtual: CONTA_REAL, alvo: null, extrato, ativar: false });
    expect(p).toEqual({ acao: "manter", motivo: "import-nao-ativa" });
  });

  it("NENHUM caminho ativa outra conta sem pedido explícito", () => {
    // A varredura que o código antigo não passaria: ele ativava sempre que
    // `ativar !== false`, e o cliente manda `ativar: true` em todo import.
    const outraConta: ContaIdentificada = {
      id: "outra",
      nome: "Conta 99999999",
      agencia: "banco",
      conta: "99999999",
    };
    for (const alvo of [null, outraConta]) {
      for (const ativar of [undefined, true]) {
        const p = planejarContaAtiva({ ativaAtual: CONTA_REAL, alvo, extrato, ativar });
        expect(p.acao).toBe("perguntar");
      }
    }
  });
});

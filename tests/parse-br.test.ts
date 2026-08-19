import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseBrNumber, parseBrDate } from "@shared/parse-br";
import { parseExtratoOfx, parseExtratoArquivo } from "@shared/extrato-import";
import {
  parseValorPositivoDigitado,
  parseNumeroDigitado,
  MSG_VALOR_ILEGIVEL,
  MSG_VALOR_INVALIDO,
} from "@shared/valor";

/*
 * O BUG DAS 100 VEZES — e o motivo deste arquivo existir.
 *
 * `parseBrNumber` fazia `replace(/\./g, "")` ANTES de decidir o que o ponto
 * era. O ponto do formato brasileiro é milhar, então apagá-lo parecia certo —
 * até chegar um número com PONTO DECIMAL, que é o que a especificação do OFX
 * manda usar. Aí "1234.56" virava 123456 e "0.50" virava 50: cem vezes o valor
 * de verdade, em silêncio, sem erro nenhum na tela.
 *
 * E como a função devolvia um NÚMERO (errado) em vez de `null`, o fallback de
 * formato americano em `parseExtratoOfx` nunca chegava a rodar. Resultado: todo
 * import de OFX com centavos entrava 100x maior, e o painel dava um saldo que
 * não existia.
 *
 * A regra que substituiu aquilo: **o separador que aparece por ÚLTIMO é o
 * decimal**. Estes testes são o cadeado. Se alguém reintroduzir qualquer
 * apagamento de ponto anterior à decisão, os blocos "cadeado" abaixo quebram.
 */

describe("parseBrNumber: o que a usuária escreve e o que o banco manda", () => {
  const casos: [string, number | null][] = [
    // Formato brasileiro puro — vírgula decimal, ponto de milhar.
    ["1.234,56", 1234.56],
    ["223,95", 223.95],
    ["1.234.567,89", 1234567.89],
    ["19,47", 19.47],
    ["0,50", 0.5],

    // Ponto decimal — OFX pela especificação, planilha colada, API.
    ["1234.56", 1234.56],
    ["0.50", 0.5],
    ["99.90", 99.9],

    // Formato americano completo: vírgula de milhar, ponto decimal.
    ["1,234.56", 1234.56],

    // Só ponto, três casas: milhar. É a ÚNICA ambiguidade que sobra, e ela é
    // resolvida pelo padrão brasileiro — de propósito, não por acidente.
    ["1.234", 1234],
    ["1.000", 1000],
    ["10.500", 10500],

    // Ruído que vem de tela e de arquivo.
    ["R$ 1.400,00", 1400],
    ["  R$ 99,90 ", 99.9],
    ["(50,00)", -50],
    ["-480,26", -480.26],
    ["-19,47", -19.47],
    ["+1.234,56", 1234.56],
    ["(1.234,56)", -1234.56],

    // Não é número: precisa devolver null, não zero e não um chute. Devolver
    // um número errado foi exatamente o que escondeu o bug das 100 vezes.
    ["abc", null],
    ["", null],
    ["R$", null],
    ["-", null],
    ["1,5x", null],
    ["--5", null],
  ];

  for (const [entrada, esperado] of casos) {
    it(`${JSON.stringify(entrada)} → ${esperado}`, () => {
      expect(parseBrNumber(entrada)).toBe(esperado);
    });
  }

  it("null e undefined também são null, não 0", () => {
    expect(parseBrNumber(null)).toBeNull();
    expect(parseBrNumber(undefined)).toBeNull();
  });

  /*
   * Entradas malformadas que ninguém digita de propósito. Não têm resposta
   * "certa" — têm uma resposta DECIDIDA, e é ela que está travada aqui, para
   * que uma mudança futura não as altere sem que alguém veja.
   */
  it("separadores repetidos: o último manda, o resto vira milhar", () => {
  });

  it("separador sem parte inteira ou sem decimal", () => {
    expect(parseBrNumber(",50")).toBe(0.5);
    expect(parseBrNumber(".50")).toBe(0.5);
    expect(parseBrNumber("1.234,")).toBe(1234);
    expect(parseBrNumber("1.2345")).toBe(1.2345); // 4 casas: decimal, não milhar
  });
});

describe("CADEADO: nada pode voltar a apagar o ponto antes de decidir", () => {
  /*
   * Cada linha aqui é 100x menor do que o que o código antigo devolvia. Se o
   * `replace` de ponto voltar — em parse-br.ts ou em qualquer wrapper —, estes
   * números viram 123456, 50, 9990, 22395 e o teste cai na hora.
   */
  const cemVezes: [string, number][] = [
    ["1234.56", 1234.56],
    ["0.50", 0.5],
    ["99.90", 99.9],
    ["223.95", 223.95],
    ["-480.26", -480.26],
    ["12.34", 12.34],
  ];

  for (const [entrada, esperado] of cemVezes) {
    it(`${entrada} não pode virar ${esperado * 100}`, () => {
      const n = parseBrNumber(entrada);
      expect(n).toBe(esperado);
      expect(n).not.toBe(esperado * 100);
    });
  }

  it("o mesmo dinheiro escrito dos dois jeitos dá o mesmo número", () => {
    // Este é o coração do defeito: "1.234,56" já funcionava, "1234.56" não.
    expect(parseBrNumber("1234.56")).toBe(parseBrNumber("1.234,56"));
    expect(parseBrNumber("19.47")).toBe(parseBrNumber("19,47"));
    expect(parseBrNumber("480.26")).toBe(parseBrNumber("480,26"));
  });

  it("o código-fonte não tem replace global de ponto", () => {
    // Cadeado literal, além do de comportamento: o defeito tinha uma FORMA, e
    // ela não pode reaparecer nem numa função auxiliar deste arquivo.
    const fonte = fs.readFileSync(
      path.resolve(import.meta.dirname, "../shared/parse-br.ts"),
      "utf-8",
    );
    const semComentarios = fonte.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    expect(semComentarios).not.toMatch(/replace\(\s*\/\\\.\/g/);
    expect(semComentarios).not.toMatch(/replaceAll\(\s*["'`]\.["'`]/);
  });
});

describe("agrupamento malformado devolve null em vez de número inventado", () => {
  it("recusa o que não é leitura de nenhum formato", () => {
    // Antes estes devolviam 123 e 1234.56 — números que nenhuma leitura do texto justifica.
    expect(parseBrNumber("1.2.3")).toBeNull();
    expect(parseBrNumber("12,34,56")).toBeNull();
    expect(parseBrNumber("1,2,3")).toBeNull();
  });

  it("só é milhar quando o agrupamento é bem formado", () => {
    expect(parseBrNumber("1.234")).toBe(1234); // grupos de 3: milhar
    expect(parseBrNumber("1.234.567")).toBe(1234567);
    // primeiro grupo com 4 dígitos não é milhar brasileiro — é decimal
    expect(parseBrNumber("1234.567")).toBe(1234.567);
    expect(parseBrNumber("0.005")).toBe(0.005);
  });
});

/* ------------------------------------------------------------------ *
 * OFX de ponta a ponta: os DOIS separadores no MESMO arquivo.          *
 * ------------------------------------------------------------------ */

/**
 * Extrato real de banco brasileiro: a especificação do OFX manda ponto decimal
 * e os bancos daqui emitem vírgula — às vezes no mesmo arquivo, quando o
 * extrato passa por mais de um sistema. Os dois têm de sair com o mesmo
 * significado, e nenhum pode sair 100x maior.
 */
const OFX_MISTO = `OFXHEADER:100
DATA:OFXSGML
VERSION:102

<OFX>
<BANKMSGSRSV1><STMTTRNRS><STMTRS>
<CURDEF>BRL
<BANKACCTFROM><BANKID>085<ACCTID>21865663<ACCTTYPE>CHECKING</BANKACCTFROM>
<BANKTRANLIST>
<DTSTART>20260701<DTEND>20260731
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260703
<TRNAMT>-480.26
<FITID>D0001
<NAME>DEBITO PIX - ALUGUEL SALA
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT
<DTPOSTED>20260705
<TRNAMT>-19,47
<FITID>D0002
<NAME>TARIFA PACOTE DE SERVICOS
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260710
<TRNAMT>1.234,56
<FITID>C0001
<NAME>CREDITO PIX - MARIA SILVA
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT
<DTPOSTED>20260712
<TRNAMT>223.95
<FITID>C0002
<NAME>CREDITO PIX - JOAO PEREIRA
</STMTTRN>
</BANKTRANLIST>
<LEDGERBAL><BALAMT>958.78<DTASOF>20260731</LEDGERBAL>
</STMTRS></STMTTRNRS></BANKMSGSRSV1>
</OFX>`;

describe("OFX: ponto decimal e vírgula decimal no mesmo arquivo", () => {
  const p = parseExtratoOfx(OFX_MISTO);
  const por = (doc: string) => p.rows.find((r) => r.documento === doc)!;

  it("lê as 4 transações, sem sobra e sem descarte", () => {
    expect(p.header).toEqual({ agencia: "banco", conta: "21865663" });
    expect(p.rows).toHaveLength(4);
    expect(p.naoLidas).toHaveLength(0);
  });

  it("TRNAMT -480.26 (ponto) vira 480,26 débito — não 48.026,00", () => {
    const r = por("D0001");
    expect(r.valor).toBe(480.26);
    expect(r.tipo).toBe("D");
    expect(r.data).toBe("2026-07-03");
  });

  it("TRNAMT -19,47 (vírgula) vira 19,47 débito", () => {
    const r = por("D0002");
    expect(r.valor).toBe(19.47);
    expect(r.tipo).toBe("D");
  });

  it("os dois formatos convivem no mesmo arquivo, cada um com seu valor", () => {
    expect(por("C0001").valor).toBe(1234.56); // "1.234,56"
    expect(por("C0002").valor).toBe(223.95); // "223.95"
    expect(por("C0001").tipo).toBe("C");
  });

  it("nenhuma linha saiu 100x maior — a soma bate com a mão", () => {
    const creditos = p.rows.filter((r) => r.tipo === "C").reduce((s, r) => s + r.valor, 0);
    const debitos = p.rows.filter((r) => r.tipo === "D").reduce((s, r) => s + r.valor, 0);
    expect(creditos).toBeCloseTo(1458.51, 2);
    expect(debitos).toBeCloseTo(499.73, 2);
    // O total do arquivo cabe em quatro dígitos. Com o bug antigo passava de
    // cem mil — a checagem mais crua possível, e a que teria salvado o painel.
    expect(creditos + debitos).toBeLessThan(10_000);
  });

  it("BALAMT com ponto decimal também não é multiplicado", () => {
    expect(p.saldoExtrato).toEqual({ data: "2026-07-31", valor: 958.78 });
  });

  it("o mesmo arquivo com BALAMT em vírgula dá o mesmo saldo", () => {
    const virgula = parseExtratoOfx(OFX_MISTO.replace("<BALAMT>958.78", "<BALAMT>958,78"));
    expect(virgula.saldoExtrato?.valor).toBe(958.78);
  });

  it("BALAMT negativo (conta no vermelho) continua negativo", () => {
    const vermelho = parseExtratoOfx(OFX_MISTO.replace("<BALAMT>958.78", "<BALAMT>-1.234,56"));
    expect(vermelho.saldoExtrato?.valor).toBe(-1234.56);
  });

  it("entra pelo detector de formato do mesmo jeito", () => {
    const auto = parseExtratoArquivo(OFX_MISTO, "extrato-julho.ofx");
    expect(auto.formato).toBe("ofx");
    expect(auto.rows.map((r) => r.valor).sort((a, b) => a - b)).toEqual([
      19.47, 223.95, 480.26, 1234.56,
    ]);
  });
});

/* ------------------------------------------------------------------ *
 * O MESMO parser, agora atendendo o teclado.                          *
 * ------------------------------------------------------------------ */

describe("valor digitado: o app aceita do teclado o que já aceitava do banco", () => {
  it("99,90 é R$ 99,90 — não R$ 9.990,00", () => {
    const r = parseValorPositivoDigitado("99,90");
    expect(r).toEqual({ ok: true, valor: 99.9 });
  });

  it("aceita os formatos que aparecem no boleto, na nota e na planilha", () => {
    for (const [texto, esperado] of [
      ["99,90", 99.9],
      ["1.234,56", 1234.56],
      ["1234.56", 1234.56],
      ["R$ 1.400,00", 1400],
      ["  1.400,00  ", 1400],
      ["1400", 1400],
    ] as [string, number][]) {
      const r = parseValorPositivoDigitado(texto);
      expect(r.ok, texto).toBe(true);
      if (r.ok) expect(r.valor, texto).toBe(esperado);
    }
  });

  it("número continua sendo aceito — o contrato antigo não mudou", () => {
    expect(parseValorPositivoDigitado(99.9)).toEqual({ ok: true, valor: 99.9 });
  });

  it("a guarda de zero e negativo continua de pé", () => {
    // O buraco anterior deste arquivo: conta a pagar negativa DIMINUÍA o total
    // devido. Trocar o campo para texto não podia reabrir isso.
    for (const texto of ["0", "0,00", "-50,00", "(50,00)", "-480,26"]) {
      const r = parseValorPositivoDigitado(texto);
      expect(r.ok, texto).toBe(false);
      if (!r.ok) expect(r.erro).toBe(MSG_VALOR_INVALIDO);
    }
  });

  it("texto ilegível dá erro de LEITURA, com mensagem própria", () => {
    for (const texto of ["abc", "R$", "1,5x", "--5"]) {
      const r = parseValorPositivoDigitado(texto);
      expect(r.ok, texto).toBe(false);
      if (!r.ok) expect(r.erro).toBe(MSG_VALOR_ILEGIVEL);
    }
  });

  it("campo vazio pede um valor, não reclama de leitura", () => {
    expect(parseValorPositivoDigitado("")).toEqual({ ok: false, erro: MSG_VALOR_INVALIDO });
    expect(parseValorPositivoDigitado("   ")).toEqual({ ok: false, erro: MSG_VALOR_INVALIDO });
  });

  it("acima do teto de decimal(12,2) é recusado, como sempre foi", () => {
    const r = parseValorPositivoDigitado("99.999.999.999,99");
    expect(r.ok).toBe(false);
  });

  it("saldo de conta pode ser negativo — é o único que pode", () => {
    expect(parseNumeroDigitado("-1.234,56")).toEqual({ ok: true, valor: -1234.56 });
    expect(parseNumeroDigitado("(1.234,56)")).toEqual({ ok: true, valor: -1234.56 });
    expect(parseNumeroDigitado("0")).toEqual({ ok: true, valor: 0 });
    expect(parseNumeroDigitado("958.78")).toEqual({ ok: true, valor: 958.78 });
    expect(parseNumeroDigitado("abc").ok).toBe(false);
  });
});

describe("parseBrDate continua onde estava", () => {
  it("lê dd/mm/aaaa e ISO, e recusa data que não existe", () => {
    expect(parseBrDate("17/04/2026")).toBe("2026-04-17");
    expect(parseBrDate("2026-04-17")).toBe("2026-04-17");
    expect(parseBrDate("99/99/9999")).toBeNull();
    expect(parseBrDate("29/02/2025")).toBeNull(); // 2025 não é bissexto
    expect(parseBrDate("29/02/2024")).toBe("2024-02-29");
  });
});

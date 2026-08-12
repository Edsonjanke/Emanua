import { describe, expect, it } from "vitest";
import {
  parseExtratoArquivo,
  parseExtratoCsv,
  parseContaTitularesCsv,
  parseExtratoOfx,
  buildDedupKey,
} from "@shared/extrato-import";
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
      syncReceita: true,
      forma: "dinheiro",
    });
    expect(r.rows[1]).toMatchObject({ tipo: "D", valor: 100, syncDespesa: true });
    expect(r.rows[2].valor).toBe(4.88);
    expect(r.rows[2].syncDespesa).toBe(true);
  });

  it("parseia Conta/Titulares CSV (ignora SALDO ANTERIOR; ID vazio usa Documento)", () => {
    const csv = `Conta;21865663
Titulares;
63 027 712 ISMALDA JANKE (**.***.712/0001-**)
Saldo;1342,9;Limite;0

Data do Extrato;11/08/2026 00:00:00;Saldo;1322,37
ID;Titulo;Valor;Tipo;Data;Documento;Protocolo;TipoComprovante;TipoTransacao;ComprovantePix;DataTransacao
0;SALDO ANTERIOR;1322,37;Todos;11/08/2026 00:00:00;;;0;0;False;2026-08-11 00:00:00

Data do Extrato;11/08/2026 00:00:00;Saldo;1342,9
ID;Titulo;Valor;Tipo;Data;Documento;Protocolo;TipoComprovante;TipoTransacao;ComprovantePix;DataTransacao
3364386879;DEBITO PIX - CHARLES KESKE;110;Debito;11/08/2026 00:00:00;882502.945;2411.3354.2410.0B08.1A22.025D.0A;1;34;True;2026-08-11 09:27:13
;CARTAO DEBITO - REDE TOP LONTRAS;19,47;Debito;11/08/2026 00:00:00;00811183726;;1;0;False;2026-08-11 15:37:27
3365359364;CREDITO PIX - PAISAGISMO NASATO LTDA;150;Credito;11/08/2026 00:00:00;883033.697;;2;34;True;2026-08-11 21:54:25
`;
    const r = parseContaTitularesCsv(csv);
    expect(r.formato).toBe("conta-titulares");
    expect(r.header).toEqual({ agencia: "banco", conta: "21865663" });
    expect(r.titular).toMatch(/ISMALDA JANKE/);
    expect(r.rows).toHaveLength(3);
    expect(r.rows.find((x) => x.historico.includes("SALDO"))).toBeUndefined();
    expect(r.rows[0]).toMatchObject({
      data: "2026-08-11",
      tipo: "D",
      valor: 110,
      documento: "3364386879",
      forma: "pix",
    });
    expect(r.rows[1]).toMatchObject({
      historico: "CARTAO DEBITO - REDE TOP LONTRAS",
      documento: "00811183726",
      valor: 19.47,
      tipo: "D",
      forma: "cartao",
    });
    expect(r.rows[2]).toMatchObject({ tipo: "C", valor: 150, documento: "3365359364" });
    expect(parseExtratoArquivo(csv, "extrato.csv").formato).toBe("conta-titulares");
  });

  it("parseia OFX SGML (ignora SALDO ANTERIOR; FITID vazio ainda importa)", () => {
    const ofx = `OFXHEADER:100
DATA:OFXSGML
VERSION:102
SECURITY:NONE
ENCODING:USASCII
CHARSET:1252
COMPRESSION:NONE
OLDFILEUID:NONE
NEWFILEUID:NONE

<OFX>
<BANKMSGSRSV1>
<STMTTRNRS>
<STMTRS>
<BANKACCTFROM>
<ACCTID>21865663</ACCTID>
</BANKACCTFROM>
<BANKINFO>
<HOLDER>63 027 712 ISMALDA JANKE (**.***.712/0001-**)</HOLDER>
<BALAMT>1342,9</BALAMT>
<CREDITLIMIT>0</CREDITLIMIT>
</BANKINFO>
<BANKTRANLIST>
<DTSTART>20260811</DTSTART>
<DTEND>20260811</DTEND>
<STMTTRN>
<TRNTYPE>CREDIT</TRNTYPE>
<DTPOSTED>20260811000000</DTPOSTED>
<TRNAMT>1322,37</TRNAMT>
<FITID>0</FITID>
<NAME>SALDO ANTERIOR</NAME>
</STMTTRN>
</BANKTRANLIST>
<BANKTRANLIST>
<DTSTART>20260811</DTSTART>
<DTEND>20260811</DTEND>
<STMTTRN>
<TRNTYPE>DEBIT</TRNTYPE>
<DTPOSTED>20260811092713</DTPOSTED>
<TRNAMT>110</TRNAMT>
<FITID>3364386879</FITID>
<NAME>DEBITO PIX - CHARLES KESKE</NAME>
</STMTTRN>
<STMTTRN>
<TRNTYPE>DEBIT</TRNTYPE>
<DTPOSTED>20260811153727</DTPOSTED>
<TRNAMT>19,47</TRNAMT>
<FITID></FITID>
<NAME>CARTAO DEBITO - REDE TOP LONTRAS</NAME>
</STMTTRN>
<STMTTRN>
<TRNTYPE>CREDIT</TRNTYPE>
<DTPOSTED>20260811215425</DTPOSTED>
<TRNAMT>150</TRNAMT>
<FITID>3365359364</FITID>
<NAME>CREDITO PIX - PAISAGISMO NASATO LTDA</NAME>
</STMTTRN>
</BANKTRANLIST>
</STMTRS>
</STMTTRNRS>
</BANKMSGSRSV1>
</OFX>
`;
    const r = parseExtratoOfx(ofx);
    expect(r.formato).toBe("ofx");
    expect(r.header).toEqual({ agencia: "banco", conta: "21865663" });
    expect(r.titular).toMatch(/ISMALDA JANKE/);
    expect(r.rows).toHaveLength(3);
    expect(r.rows.find((x) => x.historico.includes("SALDO"))).toBeUndefined();
    expect(r.rows[0]).toMatchObject({
      data: "2026-08-11",
      tipo: "D",
      valor: 110,
      documento: "3364386879",
      forma: "pix",
    });
    expect(r.rows[1]).toMatchObject({
      historico: "CARTAO DEBITO - REDE TOP LONTRAS",
      documento: null,
      valor: 19.47,
      tipo: "D",
      forma: "cartao",
    });
    expect(r.rows[2]).toMatchObject({ tipo: "C", valor: 150, documento: "3365359364" });
    expect(parseExtratoArquivo(ofx, "extrato.ofx").formato).toBe("ofx");
    expect(parseExtratoCsv(ofx).formato).toBe("ofx");
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

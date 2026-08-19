import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseExtratoArquivo,
  parseExtratoCsv,
  linhasSemCategoria,
  mensagemArquivoInvalido,
  type ExtratoParseResult,
} from "@shared/extrato-import";
import { classificarLinhas } from "@shared/extrato-diff";
import { balancoPreview, type ContagemLinhas } from "@shared/extrato-balanco";
import { plural, contarPlural } from "@shared/texto";

const FIXTURES =
  "C:/Users/Edson/AppData/Local/Temp/claude/E--Emanua-Financeiro-Emanua-Financeiro/f79e99f8-e0a9-42bd-9467-b11e32d15f0f/scratchpad/fixtures";

function ler(nome: string): ExtratoParseResult {
  return parseExtratoArquivo(fs.readFileSync(`${FIXTURES}/${nome}`, "utf-8"), nome);
}

function contar(linhas: { situacao: string }[]): ContagemLinhas {
  const c: ContagemLinhas = { nova: 0, duplicada: 0, conflito: 0, ignorada: 0, naoLida: 0 };
  for (const l of linhas) {
    if (l.situacao === "nao-lida") c.naoLida++;
    else c[l.situacao as "nova" | "duplicada" | "conflito" | "ignorada"]++;
  }
  return c;
}

/*
 * O DETECTOR DE CABEÇALHO COMIA UMA LINHA DE DADOS.
 *
 * `parseExtratoCsv` decidia se a linha 1 era cabeçalho com /^\d{2}\/\d{2}\//.
 * Quem lê a data logo abaixo é `parseBrDate`, que TAMBÉM aceita ISO. A régua do
 * detector era mais estreita que a do parser, e no vão entre as duas sumia uma
 * linha inteira: ela saía de `rows` E de `linhasArquivo`, não virava `naoLida`
 * nem `ignorada`, e não sobrava em `naoClassificadas`. A API respondia
 * { linhasLidas: 1, novas: 1, naoLidas: 0 } para um arquivo de 2 transações e a
 * tela dizia, em VERDE: "1 linha do arquivo = 1 nova + 0 conflitos + …".
 * O crédito de R$ 999,00 não existia em lugar nenhum.
 */
describe("cabeçalho x linha de dados: a régua do detector é a do parser", () => {
  it("a fixture exata: 2 linhas de dados, as duas válidas, nenhuma engolida", () => {
    const p = ler("cabecalho_come_iso.csv");

    // Contagem NA FONTE: as duas linhas do arquivo.
    expect(p.linhasArquivo).toBe(2);
    expect(p.rows.length).toBe(2);
    expect(p.naoLidas.length).toBe(0);
    expect(linhasSemCategoria(p)).toBe(0);

    // A linha ISO é a primeira transação, com o crédito de R$ 999,00 inteiro.
    expect(p.rows[0]).toMatchObject({
      data: "2026-07-01",
      historico: "ISO PRIMEIRA LINHA",
      documento: "D900",
      valor: 999,
      tipo: "C",
    });
    expect(p.rows[1]).toMatchObject({ data: "2026-07-11", valor: 12, tipo: "D" });

    // E ela NÃO virou identidade de conta: sem cabeçalho, não há header.
    expect(p.header).toBeNull();
  });

  it("o balanço não fecha em verde escondendo a linha comida", () => {
    const p = ler("cabecalho_come_iso.csv");
    const { linhas } = classificarLinhas({
      rows: p.rows,
      ignoradas: p.ignoradas ?? [],
      naoLidas: p.naoLidas,
      existentes: [],
      vinculaveis: [],
    });
    const b = balancoPreview(p.linhasArquivo, contar(linhas));
    expect(b.linhasLidas).toBe(2);
    expect(b.novas).toBe(2);
    expect(b.naoClassificadas).toBe(0);
    expect(b.fecha).toBe(true);
  });

  it("primeira linha dd/mm (a régua antiga já pegava): continua sendo dado", () => {
    const p = ler("cabecalho_come_ddmm.csv");
    expect(p.linhasArquivo).toBe(2);
    expect(p.rows.length).toBe(2);
    expect(p.rows[0].data).toBe("2026-07-01");
    expect(linhasSemCategoria(p)).toBe(0);
    expect(p.header).toBeNull();
  });

  it("cabeçalho de verdade continua sendo cabeçalho, e sai da contagem UMA vez", () => {
    const p = ler("cabecalho_de_verdade.csv");
    expect(p.header).toEqual({ agencia: "0101", conta: "21865663" });
    expect(p.linhasArquivo).toBe(2);
    expect(p.rows.length).toBe(2);
    expect(p.rows[0].historico).toBe("ISO PRIMEIRA LINHA");
    expect(linhasSemCategoria(p)).toBe(0);
  });

  it("primeira linha com data mas quebrada vira NÃO LIDA — nunca cabeçalho", () => {
    // Sem tipo C/D. Uma régua "só transação perfeita é dado" a devolveria para o
    // cabeçalho e ela sumiria de novo; aqui ela continua contada, com motivo.
    const p = ler("cabecalho_come_iso_quebrada.csv");
    expect(p.linhasArquivo).toBe(2);
    expect(p.rows.length).toBe(1);
    expect(p.naoLidas.length).toBe(1);
    expect(p.naoLidas[0].linha).toBe(1);
    expect(p.naoLidas[0].motivo).toMatch(/tipo/i);
    expect(p.header).toBeNull();
    expect(linhasSemCategoria(p)).toBe(0);
  });

  it("arquivo sem cabeçalho nenhum, todas as linhas dd/mm", () => {
    const p = parseExtratoCsv(
      [
        "01/07/2026;PRIMEIRA;A1;10,00;C",
        "02/07/2026;SEGUNDA;A2;20,00;D",
        "03/07/2026;TERCEIRA;A3;30,00;C",
      ].join("\n"),
    );
    expect(p.linhasArquivo).toBe(3);
    expect(p.rows.length).toBe(3);
    expect(p.header).toBeNull();
    expect(linhasSemCategoria(p)).toBe(0);
  });

  it("cabeçalho + linhas dd/mm: o arquivo Viacredi de sempre", () => {
    const p = parseExtratoCsv(
      ["0101;Conta Corrente;21865663", "01/07/2026;PRIMEIRA;A1;10,00;C"].join("\n"),
    );
    expect(p.header).toEqual({ agencia: "0101", conta: "21865663" });
    expect(p.linhasArquivo).toBe(1);
    expect(p.rows.length).toBe(1);
  });

  it("a linha comida também não vira mais IDENTIDADE DE CONTA", () => {
    // Era daqui que saía a conta agência "2026-07-01" / conta "D900".
    const p = ler("cabecalho_come_iso.csv");
    expect(p.header?.agencia).not.toBe("2026-07-01");
    expect(p.header).toBeNull();
  });

  it("o arquivo sem cabeçalho é recusado dizendo o que falta, não 'não tem colunas'", () => {
    const texto = fs.readFileSync(`${FIXTURES}/cabecalho_come_iso.csv`, "utf-8");
    const p = parseExtratoCsv(texto);
    const msg = mensagemArquivoInvalido("cabecalho_come_iso.csv", texto, p.erros, p);
    expect(msg).toMatch(/2 transações/);
    expect(msg).toMatch(/de qual conta/i);
    expect(msg).not.toMatch(/não tem as colunas/i);
  });
});

/*
 * VARREDURA DOS QUATRO LEITORES.
 *
 * A invariante é uma só: `linhasArquivo` = rows + ignoradas + naoLidas. Toda
 * linha que sai da contagem sem virar categoria é um buraco como o do
 * cabeçalho. Aqui passam TODAS as fixtures do diretório, boas e ruins, nos
 * quatro formatos, mais os arquivos gerados na hora para os cantos que fixture
 * nenhuma cobre.
 */
describe("nenhum dos quatro leitores perde linha entre o arquivo e as categorias", () => {
  const arquivos = fs
    .readdirSync(FIXTURES)
    .filter((f) => f.toLowerCase().endsWith(".csv") || f.toLowerCase().endsWith(".ofx"));

  it("o diretório de fixtures não está vazio (senão este bloco não prova nada)", () => {
    expect(arquivos.length).toBeGreaterThan(10);
  });

  for (const nome of arquivos) {
    it(`${nome}: rows + descartadas + não lidas = linhas do arquivo`, () => {
      const p = ler(nome);
      expect(linhasSemCategoria(p)).toBe(0);
      // E o contrário também: nada de categoria inventada além do que o arquivo tem.
      expect(p.rows.length + (p.ignoradas?.length ?? 0) + p.naoLidas.length).toBe(p.linhasArquivo);
      // Arquivo recusado (sem identidade de conta) tem que sair com uma
      // mensagem que nomeia o arquivo e diz o que fazer — nunca em silêncio.
      if (!p.header) {
        const texto = fs.readFileSync(`${FIXTURES}/${nome}`, "utf-8");
        const msg = mensagemArquivoInvalido(nome, texto, p.erros, p);
        expect(msg).toContain(nome);
        expect(msg.length).toBeGreaterThan(40);
      }
      // Toda não lida traz motivo e número de linha — senão o usuário não a acha.
      for (const nl of p.naoLidas) {
        expect(nl.motivo.trim().length).toBeGreaterThan(0);
        expect(nl.linha).toBeGreaterThan(0);
      }
    });
  }

  const GERADOS: { nome: string; texto: string; linhas: number }[] = [
    {
      nome: "viacredi só com uma linha ilegível",
      texto: "0101;Conta;21865663\nlixo sem ponto e vírgula",
      linhas: 1,
    },
    {
      nome: "viacredi com linha em branco no meio",
      texto: "0101;Conta;21865663\n01/07/2026;A;1;10,00;C\n\n02/07/2026;B;2;20,00;D",
      linhas: 2,
    },
    {
      nome: "gendo com cabeçalho e uma não realizada",
      texto:
        "Data;Vencimento;Comanda;Responsável;Categoria;Descrição;Realizado;Valor\n" +
        "01/07/2026;01/07/2026;0;EU;Pagamento;Sessão;Sim;100,00\n" +
        "02/07/2026;02/07/2026;0;EU;Pagamento;Sessão;Não;50,00\n" +
        "03/07/2026;03/07/2026;0;EU;Pagamento;;Sim;0",
      linhas: 3,
    },
    {
      nome: "gendo com cabeçalho sem as colunas obrigatórias",
      // Reconhecido como Gendo pelo conjunto data/categoria/realizado/valor, mas
      // sem Descrição: nenhuma linha pode ser lida — e nenhuma pode sumir.
      texto: "Data;Categoria;Realizado;Valor\n01/07/2026;Pagamento;Sim;100,00",
      linhas: 1,
    },
    {
      nome: "ofx com uma transação boa e uma sem tipo",
      texto:
        "OFXHEADER:100\n<OFX><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260701<TRNAMT>100.00<FITID>1<NAME>PIX</STMTTRN>" +
        "<STMTTRN><TRNTYPE>OTHER<DTPOSTED>20260702<TRNAMT>0<FITID>2<NAME>NADA</STMTTRN>" +
        "<ACCTID>21865663</OFX>",
      linhas: 2,
    },
    {
      nome: "ofx sem ACCTID (recusado, mas sem perder linha)",
      texto:
        "OFXHEADER:100\n<OFX><STMTTRN><TRNTYPE>CREDIT<DTPOSTED>20260701<TRNAMT>100.00<FITID>1<NAME>PIX</STMTTRN></OFX>",
      linhas: 1,
    },
    {
      // As linhas de metadado do conta-titulares (Conta, Titulares, Saldo, Data
      // do Extrato, o titular e a própria linha de colunas) são puladas ANTES da
      // contagem — o mesmo lugar onde o cabeçalho do Viacredi engolia uma linha.
      // Aqui elas convivem com linhas de dados de ID vazio e com uma SEGUNDA
      // seção (o arquivo real do banco tem duas), e a contagem só pega as 3
      // linhas de movimento + a de SALDO ANTERIOR.
      nome: "conta-titulares com metadado no meio e ID vazio",
      texto: [
        "Conta;21865663",
        "Titulares;",
        "63 027 712 ISMALDA JANKE (**.***.712/0001-**)",
        "Saldo;223,95;Limite;0",
        "",
        "Data do Extrato;03/08/2026 00:00:00;Saldo;1000,00",
        "ID;Titulo;Valor;Tipo;Data;Documento",
        "0;SALDO ANTERIOR;1000,00;Todos;03/08/2026 00:00:00;",
        "1;PIX RECEBIDO;100,00;Credito;03/08/2026 00:00:00;",
        "",
        "Data do Extrato;04/08/2026 00:00:00;Saldo;900,00",
        "ID;Titulo;Valor;Tipo;Data;Documento",
        ";CARTAO DEBITO SEM ID;10,00;Debito;04/08/2026 00:00:00;80815151402",
        "2;PIX ENVIADO;90,00;Debito;04/08/2026 00:00:00;",
      ].join("\n"),
      linhas: 4,
    },
    {
      nome: "conta-titulares sem a linha Conta (recusado, mas sem perder linha)",
      texto:
        "Titulares;\nID;Titulo;Valor;Tipo;Data;Documento\n1;PIX;100,00;Credito;01/07/2026;;\n",
      linhas: 1,
    },
  ];

  for (const g of GERADOS) {
    it(`${g.nome}: nada sai da contagem sem categoria`, () => {
      const p = parseExtratoArquivo(g.texto, g.nome.includes("ofx") ? "x.ofx" : "x.csv");
      expect(p.linhasArquivo).toBe(g.linhas);
      expect(linhasSemCategoria(p)).toBe(0);
    });
  }
});

/*
 * "Só cabeçalho" devolvia "0 linhas" com selo POSITIVO. Arquivo sem transação
 * nenhuma não é sucesso: é aviso. O parser conta zero (correto) e a tela é
 * obrigada a tratar zero como "não havia nada para importar".
 */
describe("arquivo sem nenhuma transação", () => {
  for (const nome of ["so_cabecalho.csv", "so_cabecalho_banco.csv"]) {
    it(`${nome}: zero linhas de dados, e zero não é sucesso`, () => {
      const p = ler(nome);
      expect(p.linhasArquivo).toBe(0);
      expect(p.rows.length).toBe(0);
      const b = balancoPreview(p.linhasArquivo, {
        nova: 0,
        duplicada: 0,
        conflito: 0,
        ignorada: 0,
        naoLida: 0,
      });
      // A conta "fecha" — 0 = 0 —, e é exatamente por isso que fechar não pode
      // ser o critério de sucesso da tela: zero linha precisa de aviso próprio.
      expect(b.fecha).toBe(true);
      expect(b.linhasLidas).toBe(0);
    });
  }
});

/*
 * UM helper de plural só. O cabeçalho do modal concatenava `${n} linhas lidas`
 * na unha e escrevia "1 linhas lidas", enquanto o balanço logo abaixo, com o
 * helper, escrevia "1 linha do arquivo".
 */
describe("plural", () => {
  it("singular só no 1", () => {
    expect(plural(1, "linha", "linhas")).toBe("linha");
    expect(plural(0, "linha", "linhas")).toBe("linhas");
    expect(plural(2, "linha", "linhas")).toBe("linhas");
    expect(plural(-1, "linha", "linhas")).toBe("linha");
  });

  it("contarPlural escreve o número junto — era aqui que saía '1 linhas lidas'", () => {
    expect(contarPlural(1, "linha lida", "linhas lidas")).toBe("1 linha lida");
    expect(contarPlural(0, "linha lida", "linhas lidas")).toBe("0 linhas lidas");
    expect(contarPlural(32, "linha lida", "linhas lidas")).toBe("32 linhas lidas");
  });
});

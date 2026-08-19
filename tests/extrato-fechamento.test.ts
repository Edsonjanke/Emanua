import fs from "node:fs";
import { describe, expect, it } from "vitest";
import {
  parseExtratoArquivo,
  saldoInicialDe,
  mensagemArquivoInvalido,
} from "@shared/extrato-import";
import { conferirFechamentoExtrato, totaisDe } from "@shared/extrato-diff";

const FIXTURES =
  "C:/Users/Edson/AppData/Local/Temp/claude/E--Emanua-Financeiro-Emanua-Financeiro/f79e99f8-e0a9-42bd-9467-b11e32d15f0f/scratchpad/fixtures";

describe("conferirFechamentoExtrato", () => {
  it("bate quando creditos - debitos dá a variação do saldo", () => {
    const r = conferirFechamentoExtrato({
      creditos: 2530,
      debitos: 3394.78,
      saldoInicial: 1088.73,
      saldoFinal: 223.95,
    });
    expect(r.movimento).toBe(-864.78);
    expect(r.variacao).toBe(-864.78);
    expect(r.diferenca).toBe(0);
    expect(r.bate).toBe(true);
  });

  it("não bate e diz de quanto é a diferença quando uma linha foi editada", () => {
    // 9,74 a mais no débito: é exatamente o 490,00 plantado no lugar de 480,26.
    const r = conferirFechamentoExtrato({
      creditos: 2530,
      debitos: 3404.52,
      saldoInicial: 1088.73,
      saldoFinal: 223.95,
    });
    expect(r.bate).toBe(false);
    expect(r.diferenca).toBe(-9.74);
  });

  it("tolera ruído binário abaixo de meio centavo", () => {
    const r = conferirFechamentoExtrato({
      creditos: 0.1 + 0.2,
      debitos: 0,
      saldoInicial: 0,
      saldoFinal: 0.3,
    });
    expect(r.bate).toBe(true);
  });
});

describe("saldoInicialDe", () => {
  it("acha o saldo de abertura na linha SALDO ANTERIOR", () => {
    const texto = fs.readFileSync(`${FIXTURES}/extrato_corrigido.csv`, "utf-8");
    const p = parseExtratoArquivo(texto, "extrato_corrigido.csv");
    expect(saldoInicialDe(p.ignoradas)).toEqual({ data: "2026-08-03", valor: 1088.73 });
  });

  it("devolve null quando o arquivo não traz SALDO ANTERIOR", () => {
    expect(saldoInicialDe([])).toBeNull();
    expect(saldoInicialDe(undefined)).toBeNull();
  });

  it("fecha ponta a ponta no fixture com o conflito plantado", () => {
    const texto = fs.readFileSync(`${FIXTURES}/extrato_corrigido.csv`, "utf-8");
    const p = parseExtratoArquivo(texto, "extrato_corrigido.csv");
    const ini = saldoInicialDe(p.ignoradas)!;
    const t = totaisDe(p.rows);
    const r = conferirFechamentoExtrato({
      creditos: t.creditos.soma,
      debitos: t.debitos.soma,
      saldoInicial: ini.valor,
      saldoFinal: p.saldoExtrato!.valor,
    });
    // O arquivo foi editado à mão (490,00 no lugar de 480,26) e por isso NÃO fecha.
    expect(r.bate).toBe(false);
    expect(r.diferenca).toBe(-9.74);
  });
});

describe("erros de arquivo inválido falam a língua do usuário", () => {
  it("arquivo vazio", () => {
    const p = parseExtratoArquivo("", "vazio.csv");
    expect(p.header).toBeNull();
    expect(p.erros[0]).toBe("O arquivo não tem nenhuma linha — está vazio.");
    expect(p.erros.join(" ")).not.toMatch(/CSV vazio/);
  });

  it("arquivo que não é extrato não fala em 'campos'", () => {
    const texto = fs.readFileSync(`${FIXTURES}/lixo.csv`, "utf-8");
    const p = parseExtratoArquivo(texto, "lixo.csv");
    expect(p.header).toBeNull();
    expect(p.erros.join(" ")).not.toMatch(/menos de 5 campos/);
    expect(p.erros.join(" ")).toMatch(/ponto e vírgula/);
  });
});

describe("mensagemArquivoInvalido", () => {
  it("nomeia o arquivo vazio e diz o que fazer", () => {
    const m = mensagemArquivoInvalido("vazio.csv", "", ["O arquivo não tem nenhuma linha — está vazio."]);
    expect(m).toContain("vazio.csv");
    expect(m).toContain("Baixe o extrato de novo");
    expect(m).not.toMatch(/CSV vazio/);
  });

  it("nomeia o arquivo que não é extrato e explica o que falta", () => {
    const texto = fs.readFileSync(`${FIXTURES}/lixo.csv`, "utf-8");
    const p = parseExtratoArquivo(texto, "lixo.csv");
    const m = mensagemArquivoInvalido("lixo.csv", texto, p.erros);
    expect(m).toContain("lixo.csv");
    expect(m).toContain("data, histórico, valor, tipo");
    // o resmungo do leitor vira nota de rodapé, não manchete
    expect(m.split("\n")[0]).not.toMatch(/ponto e vírgula/);
    expect(m).toContain("O que o leitor encontrou:");
  });

  it("funciona sem detalhe nenhum do leitor", () => {
    const m = mensagemArquivoInvalido("x.csv", "abc", []);
    expect(m).not.toContain("O que o leitor encontrou");
  });
});

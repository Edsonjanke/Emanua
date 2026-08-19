import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  validarIdentidadeConta,
  planejarContaAtiva,
  perguntaContaDiferente,
  type ContaIdentificada,
} from "@shared/extrato-conta";
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

/*
 * IMPORTAR PLANILHA NÃO ROUBA A CONTA ATIVA.
 *
 * `POST /api/planilha/import` fazia, em TODO import e sem perguntar nada:
 *
 *     await db.update(bancoContas).set({ ativo: false }).where(ne(id, contaId));
 *     await db.update(bancoContas).set({ ativo: true }).where(eq(id, contaId));
 *
 * Era o irmão exato do defeito já consertado no import de extrato. O Fluxo lê a
 * conta ATIVA para calcular o saldo real; ao importar uma planilha, a conta
 * consolidada tomava esse lugar e o painel passava a mostrar o saldo da
 * planilha no lugar do saldo do banco — sem pergunta antes, sem aviso depois.
 *
 * A regra passa a ser a mesma do extrato (`planejarContaAtiva`): trocar quem
 * está ativa é decisão do usuário. Na dúvida, para e pergunta, sem gravar nada.
 */
describe("planilha: trocar a conta ativa é decisão do usuário", () => {
  /** A identidade fixa que a rota usa para a conta consolidada. */
  const PLANILHA = {
    agencia: "planilha",
    conta: "planilha-consolidada",
    nome: "Planilha consolidada",
  };
  const CONTA_BANCO: ContaIdentificada = {
    id: "conta-banco",
    nome: "Conta 21865663 · ISMALDA JANKE",
    agencia: "banco",
    conta: "21865663",
  };
  const CONTA_PLANILHA: ContaIdentificada = { id: "conta-planilha", ...PLANILHA };

  it("a identidade da conta consolidada é válida — nada torto vira conta", () => {
    const r = validarIdentidadeConta(PLANILHA.agencia, PLANILHA.conta);
    expect(r.ok).toBe(true);
  });

  it("com a conta do BANCO ativa, o import PARA e pergunta — nada é gravado", () => {
    const p = planejarContaAtiva({
      ativaAtual: CONTA_BANCO,
      alvo: null,
      extrato: PLANILHA,
    });
    expect(p.acao).toBe("perguntar");
    if (p.acao !== "perguntar") return;
    expect(p.contaAtiva.nome).toBe(CONTA_BANCO.nome);
    expect(perguntaContaDiferente(p)).toMatch(/Nada foi gravado ainda/i);
  });

  it("a consolidada já existir não autoriza a troca sozinha", () => {
    // O caso do reimport: a conta da planilha existe, mas quem está ativa é a
    // do banco. Existir não é o mesmo que ter sido escolhida.
    const p = planejarContaAtiva({
      ativaAtual: CONTA_BANCO,
      alvo: CONTA_PLANILHA,
      extrato: PLANILHA,
    });
    expect(p.acao).toBe("perguntar");
  });

  it("respondeu 'manter': importa e a conta do banco continua ativa", () => {
    const p = planejarContaAtiva({
      ativaAtual: CONTA_BANCO,
      alvo: CONTA_PLANILHA,
      extrato: PLANILHA,
      decisao: "manter",
    });
    expect(p).toEqual({ acao: "manter", motivo: "usuario-pediu" });
  });

  it("respondeu 'trocar': aí sim a consolidada vira a ativa", () => {
    const p = planejarContaAtiva({
      ativaAtual: CONTA_BANCO,
      alvo: CONTA_PLANILHA,
      extrato: PLANILHA,
      decisao: "trocar",
    });
    expect(p).toEqual({ acao: "ativar", motivo: "usuario-pediu" });
  });

  it("sistema sem conta nenhuma, ou já com a consolidada ativa: segue sem perguntar", () => {
    expect(planejarContaAtiva({ ativaAtual: null, alvo: null, extrato: PLANILHA })).toEqual({
      acao: "ativar",
      motivo: "primeira-conta",
    });
    expect(
      planejarContaAtiva({
        ativaAtual: CONTA_PLANILHA,
        alvo: CONTA_PLANILHA,
        extrato: PLANILHA,
      }),
    ).toEqual({ acao: "ativar", motivo: "ja-era-a-ativa" });
  });

  it("NENHUM caminho troca a conta ativa sem pedido explícito", () => {
    for (const alvo of [null, CONTA_PLANILHA]) {
      for (const ativar of [undefined, true]) {
        const p = planejarContaAtiva({
          ativaAtual: CONTA_BANCO,
          alvo,
          extrato: PLANILHA,
          ativar,
        });
        expect(p.acao).toBe("perguntar");
      }
    }
  });

  /*
   * Cadeado sobre a ROTA, não só sobre a regra: a regra pura já existia quando
   * a planilha ainda roubava a conta ativa — o defeito estava em a rota não
   * chamar ninguém. Se o `SET ativo=false` voltar a rodar solto, isto cai.
   */
  it("a rota de import de planilha só desativa as outras dentro do if", () => {
    const fonte = fs.readFileSync(
      path.resolve(import.meta.dirname, "../server/routes.ts"),
      "utf-8",
    );
    const inicio = fonte.indexOf('app.post("/api/planilha/import"');
    expect(inicio).toBeGreaterThan(-1);
    const rota = fonte.slice(inicio, fonte.indexOf("app.post(", inicio + 10));

    // A rota decide com planejarContaAtiva e sabe recusar com 409.
    expect(rota).toMatch(/planejarContaAtiva\(/);
    expect(rota).toMatch(/validarIdentidadeConta\(/);
    expect(rota).toMatch(/perguntaContaDiferente\(/);
    expect(rota).toMatch(/status\(409\)/);

    // E toda desativação em massa está atrás da decisão.
    const desativacoes = [...rota.matchAll(/set\(\{\s*ativo:\s*false\s*\}\)/g)];
    expect(desativacoes.length).toBeGreaterThan(0);
    for (const m of desativacoes) {
      const antes = rota.slice(Math.max(0, m.index! - 400), m.index!);
      expect(antes, "desativar as outras contas precisa estar dentro de if (ativarEstaConta)").toMatch(
        /if\s*\(ativarEstaConta\)\s*\{[^}]*$/,
      );
    }
  });
});

import { describe, expect, it } from "vitest";
import { MSG_VALOR_INVALIDO, parseValorPositivo, parseValorPositivoOpcional } from "@shared/valor";
import { contemBusca, normalizarBusca } from "@shared/texto";
import { agruparRecortes, ordenarContas } from "@shared/contas-recorte";

/* ────────────────────────────────────────────────────────────────────────
 * BUG 1 — valor negativo era aceito e INVERTIA o total.
 * Repro real: "ZZ Neg" com valor −50 gravou; a tela passou de 8 contas /
 * R$ 2.368,26 para 9 contas / R$ 2.318,26 — adicionar uma conta a pagar
 * diminuiu o que se deve.
 * ──────────────────────────────────────────────────────────────────────── */
describe("valor: guarda contra negativo e zero", () => {
  it("recusa o valor negativo do repro (−50)", () => {
    const r = parseValorPositivo(-50);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.erro).toBe(MSG_VALOR_INVALIDO);
  });

  it("recusa negativo também como string (o corpo JSON do form)", () => {
    expect(parseValorPositivo("-50").ok).toBe(false);
    expect(parseValorPositivo("-0.01").ok).toBe(false);
  });

  it("recusa zero, vazio, nulo, NaN e Infinity", () => {
    for (const v of [0, "0", "0,00", "", null, undefined, "abc", NaN, Infinity, -Infinity, true]) {
      expect(parseValorPositivo(v as unknown).ok, `deveria recusar ${String(v)}`).toBe(false);
    }
  });

  it("recusa 0,004 — que em decimal(12,2) é zero, não um centavo", () => {
    expect(parseValorPositivo(0.004).ok).toBe(false);
    expect(parseValorPositivo(0.005).ok).toBe(true);
  });

  it("recusa acima do teto de decimal(12,2) em vez de estourar no INSERT", () => {
    expect(parseValorPositivo(1e11).ok).toBe(false);
  });

  it("aceita valores normais e arredonda para 2 casas", () => {
    expect(parseValorPositivo(50)).toEqual({ ok: true, valor: 50 });
    expect(parseValorPositivo("1400.00")).toEqual({ ok: true, valor: 1400 });
    expect(parseValorPositivo(10.999)).toEqual({ ok: true, valor: 11 });
  });

  it("o total não pode encolher: 8 contas + uma nova conta sempre sobe", () => {
    const abertas = [2368.26];
    const nova = parseValorPositivo(-50);
    expect(nova.ok).toBe(false); // não entra na lista
    const total = abertas.reduce((a, b) => a + b, 0);
    expect(total).toBe(2368.26);
  });

  it("no PATCH, campo ausente passa e campo presente é validado", () => {
    expect(parseValorPositivoOpcional(undefined)).toBeNull();
    expect(parseValorPositivoOpcional(-50)?.ok).toBe(false);
    expect(parseValorPositivoOpcional(null)?.ok).toBe(false);
    expect(parseValorPositivoOpcional("12.34")).toEqual({ ok: true, valor: 12.34 });
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * BUG 4 — a busca não dobrava acentos.
 * "pro-labore" devolvia 0 resultados num app cuja categoria real é
 * "Pró-labore" (confirmado no banco de dev).
 * ──────────────────────────────────────────────────────────────────────── */
describe("busca: acento não é senha", () => {
  it('"pro-labore" acha "Pró-labore"', () => {
    expect(contemBusca("Pró-labore", "pro-labore")).toBe(true);
  });

  it("acha nos dois sentidos (termo com acento, dado sem acento)", () => {
    expect(contemBusca("Agua", "água")).toBe(true);
    expect(contemBusca("Água", "agua")).toBe(true);
    expect(contemBusca("Roupas/Lençóis", "lencois")).toBe(true);
    expect(contemBusca("Roupas/Lencois", "lençóis")).toBe(true);
  });

  it("continua distinguindo o que é realmente diferente", () => {
    expect(contemBusca("Aluguel sala", "energia")).toBe(false);
  });

  it("termo vazio casa com tudo e nulos não quebram", () => {
    expect(contemBusca("qualquer", "   ")).toBe(true);
    expect(contemBusca(null, "x")).toBe(false);
    expect(normalizarBusca(undefined)).toBe("");
  });

  it("normaliza caixa e preserva hífen e barra", () => {
    expect(normalizarBusca(" Pró-Labore ")).toBe("pro-labore");
    expect(normalizarBusca("Roupas/Lençóis")).toBe("roupas/lencois");
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * BUG 3 — chip "Este mês" contava a data errada na aba PAGAS.
 * Repro real: "Aluguel sala" vence 15/09/2026 e foi paga em 17/08/2026;
 * contando por vencimento ela sumia de agosto (23 em vez de 24 no banco de dev).
 * ──────────────────────────────────────────────────────────────────────── */
const JANELA = { hoje: "2026-08-19", limite7: "2026-08-26", mesAtual: "2026-08" };

const ALUGUEL = {
  id: "4ff98d80",
  valor: "1400.00",
  dataVencimento: "2026-09-15",
  dataPagamento: "2026-08-17",
  status: "pago",
  categoria: "Aluguel",
};
const PAGA_EM_AGOSTO = {
  id: "21d8ebaf",
  valor: "1400.00",
  dataVencimento: "2026-08-15",
  dataPagamento: "2026-08-15",
  status: "pago",
  categoria: "Aluguel",
};
const PAGA_EM_JULHO = {
  id: "aaaa1111",
  valor: "100.00",
  dataVencimento: "2026-08-02",
  dataPagamento: "2026-07-30",
  status: "pago",
  categoria: "Outros",
};

describe('recorte "Este mês"', () => {
  it("na aba Pagas conta por dataPagamento, não por dataVencimento", () => {
    const g = agruparRecortes([ALUGUEL, PAGA_EM_AGOSTO, PAGA_EM_JULHO], {
      ...JANELA,
      quitadas: true,
    });
    expect(g.mes.map((r) => r.id)).toEqual(["4ff98d80", "21d8ebaf"]);
    // Antes o Aluguel (venc. 15/09) caía fora e a paga em 30/07 entrava.
    expect(g.mes).toHaveLength(2);
  });

  it("na aba Em aberto continua contando por dataVencimento", () => {
    const emAberto = [
      { id: "b1", valor: "216.85", dataVencimento: "2026-08-25", status: "pendente" },
      { id: "b2", valor: "99.86", dataVencimento: "2026-09-03", status: "pendente" },
    ];
    const g = agruparRecortes(emAberto, { ...JANELA, quitadas: false });
    expect(g.mes.map((r) => r.id)).toEqual(["b1"]);
  });

  it("conta paga sem dataPagamento não entra em nenhum mês", () => {
    const g = agruparRecortes([{ ...ALUGUEL, dataPagamento: null }], {
      ...JANELA,
      quitadas: true,
    });
    expect(g.mes).toHaveLength(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * BUG 6 — a vaga única de urgência escondia um recorte inteiro.
 * Repro real: com 1 conta vencida a fileira virou "Em aberto 15 | Vencidas 1 |
 * Pagas 143" e o recorte "Vence em 7 dias 5" SUMIU da tela — cinco contas
 * vencendo na semana só existiam dentro da folha "Filtrar e ordenar".
 * O recorte "urgentes" é a UNIÃO dos dois e cabe na mesma vaga.
 * ──────────────────────────────────────────────────────────────────────── */
describe('recorte "urgentes" (vencidas ∪ vence em 7 dias)', () => {
  const EM_ABERTO = [
    { id: "u1", valor: "487.90", dataVencimento: "2026-08-13", status: "pendente" }, // vencida
    { id: "u2", valor: "149.90", dataVencimento: "2026-08-20", status: "pendente" }, // 7 dias
    { id: "u3", valor: "320.00", dataVencimento: "2026-08-26", status: "pendente" }, // 7 dias (limite)
    { id: "u4", valor: "890.00", dataVencimento: "2026-09-30", status: "pendente" }, // longe
  ];

  it("junta as vencidas e as que vencem em 7 dias, e só elas", () => {
    const g = agruparRecortes(EM_ABERTO, { ...JANELA, quitadas: false });
    expect(g.vencidas.map((r) => r.id)).toEqual(["u1"]);
    expect(g.prox7.map((r) => r.id)).toEqual(["u2", "u3"]);
    expect(g.urgentes.map((r) => r.id)).toEqual(["u1", "u2", "u3"]);
  });

  it("é união e não soma: quem cai nos dois recortes aparece UMA vez", () => {
    // status "vencido" com data futura dentro da janela: está em vencidas E em prox7.
    const ambos = [{ id: "x1", valor: "10.00", dataVencimento: "2026-08-21", status: "vencido" }];
    const g = agruparRecortes(ambos, { ...JANELA, quitadas: false });
    expect(g.vencidas).toHaveLength(1);
    expect(g.prox7).toHaveLength(1);
    expect(g.urgentes).toHaveLength(1);
  });

  it("sem nada urgente, o recorte fica vazio (a vaga não aparece)", () => {
    const longe = [{ id: "y1", valor: "10.00", dataVencimento: "2026-12-01", status: "pendente" }];
    const g = agruparRecortes(longe, { ...JANELA, quitadas: false });
    expect(g.urgentes).toHaveLength(0);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * BUG 5 — ordenação sem desempate.
 * Repro real: as 5 contas de 03/09/2026 trocaram de ordem entre duas cargas
 * da mesma sessão.
 * ──────────────────────────────────────────────────────────────────────── */
const MESMO_DIA = [
  { id: "dedb84bd", valor: "99.86", dataVencimento: "2026-09-03" },
  { id: "c0b1ddc0", valor: "39.90", dataVencimento: "2026-09-03" },
  { id: "ce10bd4c", valor: "94.00", dataVencimento: "2026-09-03" },
  { id: "83079c7d", valor: "67.83", dataVencimento: "2026-09-03" },
  { id: "cec343ec", valor: "166.24", dataVencimento: "2026-09-03" },
];

describe("ordenação estável", () => {
  it("as 5 contas de 03/09 saem na mesma ordem venha o array como vier", () => {
    const a = ordenarContas(MESMO_DIA, "venc-asc").map((r) => r.id);
    const b = ordenarContas([...MESMO_DIA].reverse(), "venc-asc").map((r) => r.id);
    const c = ordenarContas([...MESMO_DIA].sort(() => -1), "venc-asc").map((r) => r.id);
    expect(b).toEqual(a);
    expect(c).toEqual(a);
    expect(a).toEqual(["83079c7d", "c0b1ddc0", "ce10bd4c", "cec343ec", "dedb84bd"]);
  });

  it("vale para venc-desc também", () => {
    const a = ordenarContas(MESMO_DIA, "venc-desc").map((r) => r.id);
    const b = ordenarContas([...MESMO_DIA].reverse(), "venc-desc").map((r) => r.id);
    expect(b).toEqual(a);
  });

  it("empate de VALOR também desempata por id", () => {
    const iguais = [
      { id: "z", valor: "100.00", dataVencimento: "2026-09-01" },
      { id: "a", valor: "100.00", dataVencimento: "2026-10-01" },
    ];
    expect(ordenarContas(iguais, "valor-desc").map((r) => r.id)).toEqual(["a", "z"]);
    expect(ordenarContas([...iguais].reverse(), "valor-desc").map((r) => r.id)).toEqual(["a", "z"]);
  });

  it("não muta o array de entrada", () => {
    const antes = MESMO_DIA.map((r) => r.id);
    ordenarContas(MESMO_DIA, "valor-asc");
    expect(MESMO_DIA.map((r) => r.id)).toEqual(antes);
  });
});

/* ────────────────────────────────────────────────────────────────────────
 * BUG 7 — a aba PAGAS não tinha como ordenar por data de PAGAMENTO.
 * `dataDoMes()` já trocava para dataPagamento nas quitadas (o recorte
 * "Pagas este mês" contava certo), mas `ordenarContas` comparava SEMPRE
 * dataVencimento e a folha só oferecia vencimento e valor.
 * Repro real (banco de dev, 143 pagas): a conta paga em 19/08/2026 caía na
 * posição 142 de 143 e as 24 pagas no mês eram as ÚLTIMAS 24 — 14.997px de
 * rolagem num iPad de 834px para chegar na primeira delas.
 * ──────────────────────────────────────────────────────────────────────── */
const QUITADAS = [
  // vence primeiro, mas foi paga por último
  { id: "p3", valor: "10.00", dataVencimento: "2026-07-01", dataPagamento: "2026-08-19" },
  { id: "p1", valor: "20.00", dataVencimento: "2026-09-15", dataPagamento: "2026-06-02" },
  { id: "p2", valor: "30.00", dataVencimento: "2026-08-10", dataPagamento: "2026-07-20" },
];

describe("ordenação por data de PAGAMENTO (aba Pagas)", () => {
  it("pag-desc põe a conta paga por último em PRIMEIRO", () => {
    expect(ordenarContas(QUITADAS, "pag-desc").map((r) => r.id)).toEqual(["p3", "p2", "p1"]);
  });

  it("pag-asc é o espelho exato", () => {
    expect(ordenarContas(QUITADAS, "pag-asc").map((r) => r.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("não é a ordem de vencimento — é outra pergunta", () => {
    // Vencimento crescente: p3 (01/07) → p2 (10/08) → p1 (15/09).
    // Pagamento crescente:  p1 (02/06) → p2 (20/07) → p3 (19/08).
    // A conta paga POR ÚLTIMO é a que vence PRIMEIRO: ordenar por vencimento
    // na aba Pagas é responder a pergunta errada, e era o que acontecia.
    expect(ordenarContas(QUITADAS, "venc-asc").map((r) => r.id)).toEqual(["p3", "p2", "p1"]);
    expect(ordenarContas(QUITADAS, "pag-asc").map((r) => r.id)).toEqual(["p1", "p2", "p3"]);
  });

  it("mesma data de pagamento desempata por id, sem embaralhar entre cargas", () => {
    const mesmoDia = [
      { id: "b", valor: "1.00", dataVencimento: "2026-01-01", dataPagamento: "2026-08-19" },
      { id: "a", valor: "2.00", dataVencimento: "2026-02-01", dataPagamento: "2026-08-19" },
      { id: "c", valor: "3.00", dataVencimento: "2026-03-01", dataPagamento: "2026-08-19" },
    ];
    const x = ordenarContas(mesmoDia, "pag-desc").map((r) => r.id);
    const y = ordenarContas([...mesmoDia].reverse(), "pag-desc").map((r) => r.id);
    expect(x).toEqual(["a", "b", "c"]);
    expect(y).toEqual(x);
  });

  it("conta SEM data de pagamento vai para o fim nas DUAS direções", () => {
    // "" não é a data mais antiga do mundo: é data nenhuma. Se entrasse na
    // comparação de texto, ela lideraria a lista em pag-asc.
    const comBuraco = [
      { id: "sem", valor: "1.00", dataVencimento: "2026-01-01", dataPagamento: null },
      { id: "com", valor: "2.00", dataVencimento: "2026-02-01", dataPagamento: "2026-08-19" },
    ];
    expect(ordenarContas(comBuraco, "pag-desc").map((r) => r.id)).toEqual(["com", "sem"]);
    expect(ordenarContas(comBuraco, "pag-asc").map((r) => r.id)).toEqual(["com", "sem"]);
  });

  it("não muta o array de entrada", () => {
    const antes = QUITADAS.map((r) => r.id);
    ordenarContas(QUITADAS, "pag-desc");
    expect(QUITADAS.map((r) => r.id)).toEqual(antes);
  });
});

/**
 * Identidade da conta bancária no import de extrato, e quem fica ATIVA depois.
 *
 * O defeito que fez este arquivo existir: um CSV cuja primeira linha era uma
 * transação foi lido como cabeçalho de conta. O import então criou uma conta com
 * `agencia = "2026-07-01"` e `conta = "D900"` — uma data e um número de
 * documento —, ATIVOU essa conta, DESATIVOU a real, e o painel foi de
 * "Saldo real hoje R$ 223,95" para "Defina o saldo inicial". A tela de resultado
 * ainda disse: "Nenhum lançamento que já estava no sistema foi alterado."
 *
 * Duas regras nascem daí, e as duas moram aqui, puras e testáveis:
 *   1. Identidade que parece data, ou vazia, ou com cara de linha de movimento
 *      NÃO vira conta. Recusa com mensagem que diz o que fazer.
 *   2. Trocar qual conta está ativa é uma decisão do usuário, nunca um efeito
 *      colateral de importar um arquivo. Na dúvida, PERGUNTA.
 */

import { parseBrDate } from "./parse-br";

export interface ContaIdentificada {
  id: string;
  nome: string;
  agencia: string;
  conta: string;
}

export type IdentidadeConta =
  | { ok: true; agencia: string; conta: string }
  | { ok: false; campo: "agencia" | "conta"; motivo: string };

/**
 * Cara de data mesmo depois de `parseBrDate` dizer não: "2026-07-32",
 * "1/7/26". Barra e ano-mês-dia não existem em número de conta; hífen sozinho
 * existe (dígito verificador), e por isso "12.345-6" NÃO cai aqui.
 */
const CARA_DE_DATA = /^(\d{1,4}\/\d{1,2}\/\d{1,4}|\d{4}-\d{1,2}-\d{1,2})$/;
/** "999,00", "1.234,56": valor em reais, não identidade de conta. */
const CARA_DE_VALOR = /^-?\d{1,3}(\.\d{3})*,\d{2}$/;
/** Um campo de identidade é curto. Histórico inteiro caindo aqui é sintoma. */
const LIMITE = 40;

function motivoInvalido(bruto: string): string | null {
  const v = bruto.trim();
  if (!v) return "veio vazio";
  if (v.length > LIMITE) return `tem ${v.length} caracteres — parece o histórico de um lançamento`;
  if (parseBrDate(v) != null || CARA_DE_DATA.test(v)) return `é uma data (“${v}”)`;
  if (CARA_DE_VALOR.test(v)) return `é um valor em reais (“${v}”)`;
  if (/[\r\n;]/.test(v)) return "tem uma linha inteira do arquivo dentro";
  return null;
}

/**
 * A agência e a conta que o leitor tirou do arquivo servem como identidade de
 * uma conta bancária? Recusar aqui é o que impede um arquivo torto de virar
 * conta nova — e, na sequência, de roubar a conta ativa.
 */
export function validarIdentidadeConta(
  agenciaBruta: unknown,
  contaBruta: unknown,
): IdentidadeConta {
  const agencia = String(agenciaBruta ?? "").trim();
  const conta = String(contaBruta ?? "").trim();
  const proAgencia = motivoInvalido(agencia);
  if (proAgencia) {
    return {
      ok: false,
      campo: "agencia",
      motivo: `Não vou criar uma conta com esta identidade: a agência ${proAgencia}. Isso acontece quando a primeira linha do arquivo é uma transação e acaba lida como cabeçalho da conta. Baixe o extrato de novo pelo aplicativo do banco, sem abrir nem salvar por cima no Excel — nenhuma conta foi criada e nada foi alterado.`,
    };
  }
  const proConta = motivoInvalido(conta);
  if (proConta) {
    return {
      ok: false,
      campo: "conta",
      motivo: `Não vou criar uma conta com esta identidade: o número da conta ${proConta}. Isso acontece quando a primeira linha do arquivo é uma transação e acaba lida como cabeçalho da conta. Baixe o extrato de novo pelo aplicativo do banco, sem abrir nem salvar por cima no Excel — nenhuma conta foi criada e nada foi alterado.`,
    };
  }
  return { ok: true, agencia, conta };
}

/** O que o usuário respondeu quando perguntamos sobre a conta ativa. */
export type DecisaoContaAtiva = "trocar" | "manter";

export type PlanoContaAtiva =
  /** Pode ativar a conta do extrato: ou não havia ativa, ou já é ela, ou o usuário pediu. */
  | { acao: "ativar"; motivo: "primeira-conta" | "ja-era-a-ativa" | "usuario-pediu" }
  /** Importa sem mexer em quem está ativa. */
  | { acao: "manter"; motivo: "usuario-pediu" | "import-nao-ativa" }
  /** Não dá para decidir sozinho: o extrato é de outra conta. Ninguém escreve nada até responder. */
  | { acao: "perguntar"; contaAtiva: ContaIdentificada; contaExtrato: { agencia: string; conta: string; nome: string; existe: boolean } };

/**
 * Quem fica ativa depois deste import.
 *
 * O import fazia, SEMPRE que `ativar !== false` (e o cliente manda `true`
 * sempre): `UPDATE banco_contas SET ativo=false WHERE id <> alvo` seguido de
 * `SET ativo=true WHERE id = alvo`. Ou seja, qualquer arquivo — inclusive um
 * arquivo inválido que acabou de criar uma conta com nome de data — roubava a
 * conta ativa, e com ela o saldo real do painel. Aqui a troca só acontece quando
 * não há nada a perder (primeira conta), quando não há troca nenhuma (já é a
 * ativa) ou quando o usuário respondeu que quer trocar.
 */
export function planejarContaAtiva(params: {
  /** Conta ativa ANTES deste import, se houver. */
  ativaAtual: ContaIdentificada | null;
  /** Conta do extrato, quando ela já existe no banco. */
  alvo: ContaIdentificada | null;
  /** Identidade do extrato (existindo a conta ou não). */
  extrato: { agencia: string; conta: string; nome: string };
  decisao?: DecisaoContaAtiva | null;
  /** Contrato antigo: `ativar: false` quer dizer "não mexa na conta ativa". */
  ativar?: boolean;
}): PlanoContaAtiva {
  const { ativaAtual, alvo, extrato, decisao, ativar } = params;
  if (ativar === false) return { acao: "manter", motivo: "import-nao-ativa" };
  if (!ativaAtual) return { acao: "ativar", motivo: "primeira-conta" };
  if (alvo && alvo.id === ativaAtual.id) return { acao: "ativar", motivo: "ja-era-a-ativa" };
  if (decisao === "trocar") return { acao: "ativar", motivo: "usuario-pediu" };
  if (decisao === "manter") return { acao: "manter", motivo: "usuario-pediu" };
  return {
    acao: "perguntar",
    contaAtiva: ativaAtual,
    contaExtrato: { ...extrato, existe: !!alvo },
  };
}

/** A pergunta em português, do jeito que a tela mostra. */
export function perguntaContaDiferente(p: Extract<PlanoContaAtiva, { acao: "perguntar" }>): string {
  const alvo = p.contaExtrato.existe
    ? `da conta ${p.contaExtrato.nome}`
    : `de uma conta que ainda não existe aqui (${p.contaExtrato.agencia}/${p.contaExtrato.conta})`;
  return `Este arquivo é ${alvo}, diferente da sua conta ativa (${p.contaAtiva.nome}). O que você quer fazer? Nada foi gravado ainda.`;
}

/**
 * O que mudou FORA das linhas do extrato. A tela de resultado dizia "Nenhum
 * lançamento que já estava no sistema foi alterado" enquanto a conta ativa havia
 * trocado e o saldo do painel havia sumido: verdade sobre as linhas, mentira
 * sobre o sistema. Estas são as mudanças que precisam aparecer escritas.
 */
export interface MudancasFora {
  contaCriada: boolean;
  contaAtivaTrocada: boolean;
  contaAtivaAntes: { id: string; nome: string } | null;
  contaAtivaAgora: { id: string; nome: string } | null;
  ancoraGravada: { data: string | null; valor: number | null } | null;
  ancoraAnterior: { data: string | null; valor: number | null } | null;
  nomeAlterado: { de: string; para: string } | null;
}

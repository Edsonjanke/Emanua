import { parseBrNumber } from "./parse-br";

/**
 * Guarda única de "quanto vale este lançamento".
 *
 * Existe porque um valor negativo passava por todos os lados: o <input type="number">
 * não tinha `min`, o servidor só checava `valor == null`, e uma conta a pagar de −50
 * DIMINUÍA o total devido — somar uma dívida reduzia a dívida. O mesmo buraco existia
 * em recebíveis e receitas do dia, que alimentam o saldo projetado do Fluxo.
 *
 * Um dinheiro só pode ser: número finito, maior que zero e dentro de decimal(12,2).
 */

/** Mensagem única — a mesma frase no cliente e no servidor. */
export const MSG_VALOR_INVALIDO = "Informe um valor maior que zero";
export const MSG_VALOR_ALTO = "Valor acima do limite permitido (R$ 9.999.999.999,99)";

/** Teto de decimal(12, 2) do Postgres. Acima disso o INSERT explodiria em 500. */
export const VALOR_MAX = 9_999_999_999.99;

export type ResultadoValor =
  | { ok: true; valor: number }
  | { ok: false; erro: string };

/**
 * Aceita number ou string decimal ("1234.56"). Recusa null, "", NaN, Infinity,
 * zero e negativos. Devolve o número já arredondado a 2 casas (a coluna é
 * decimal(12,2): 10,999 viraria 11,00 no banco de qualquer jeito).
 */
export function parseValorPositivo(bruto: unknown): ResultadoValor {
  if (bruto === null || bruto === undefined || bruto === "") {
    return { ok: false, erro: MSG_VALOR_INVALIDO };
  }
  if (typeof bruto === "boolean") return { ok: false, erro: MSG_VALOR_INVALIDO };

  const n = typeof bruto === "number" ? bruto : Number(String(bruto).trim());
  if (!Number.isFinite(n)) return { ok: false, erro: MSG_VALOR_INVALIDO };

  const arredondado = Math.round(n * 100) / 100;
  // Arredondar antes de comparar: 0,004 é zero em decimal(12,2), não um centavo.
  if (arredondado <= 0) return { ok: false, erro: MSG_VALOR_INVALIDO };
  if (arredondado > VALOR_MAX) return { ok: false, erro: MSG_VALOR_ALTO };

  return { ok: true, valor: arredondado };
}

/**
 * Versão para PATCH: campo ausente (`undefined`) é "não mexeu", e passa.
 * Campo presente precisa ser um valor válido — inclusive quando vem `null`.
 */
export function parseValorPositivoOpcional(bruto: unknown): ResultadoValor | null {
  if (bruto === undefined) return null;
  return parseValorPositivo(bruto);
}

/* ------------------------------------------------------------------ *
 * VALOR DIGITADO — o teclado da usuária é brasileiro.                  *
 * ------------------------------------------------------------------ */

/**
 * O campo Valor era `<input type="number">`. Num teclado brasileiro isso é uma
 * armadilha: quem digita "99,90" — como está escrito no boleto, na nota e no
 * extrato — dá ao navegador um valor que ele considera vazio, e num navegador
 * que aceita a vírgula o Number("99,90") vira NaN. Pior: no fluxo em que a
 * vírgula era simplesmente engolida, "99,90" virava 9990 e a conta entrava
 * cem vezes maior. O app lia "1.234,56" do arquivo do banco sem hesitar e se
 * recusava a ler do próprio teclado.
 *
 * Estas duas funções fecham isso reusando o MESMO parser do CSV e do OFX
 * (parseBrNumber), que já sabe que o separador que aparece por ÚLTIMO é o
 * decimal.
 */

/**
 * Texto que não é número nenhum. É diferente de MSG_VALOR_INVALIDO: lá o
 * número existe e não serve (zero, negativo); aqui não deu nem para ler.
 */
export const MSG_VALOR_ILEGIVEL =
  "Não consegui ler esse valor. Escreva como no extrato: 99,90 ou 1.234,56";

/**
 * Valor positivo DIGITADO em português: "99,90", "1.234,56", "R$ 1.400,00".
 * Também aceita "1234.56" (o que vem colado de planilha ou de OFX) e number.
 * Passa pela mesma guarda de sempre — zero, negativo e acima do teto caem aqui
 * exatamente como caíam antes.
 */
export function parseValorPositivoDigitado(bruto: unknown): ResultadoValor {
  if (typeof bruto === "number") return parseValorPositivo(bruto);
  if (bruto === null || bruto === undefined) return { ok: false, erro: MSG_VALOR_INVALIDO };
  const texto = String(bruto).trim();
  if (texto === "") return { ok: false, erro: MSG_VALOR_INVALIDO };
  const n = parseBrNumber(texto);
  if (n === null) return { ok: false, erro: MSG_VALOR_ILEGIVEL };
  return parseValorPositivo(n);
}

/**
 * Número digitado que PODE ser negativo nem zero — o saldo de uma conta é o
 * caso: uma conta pode estar no vermelho, e a âncora precisa poder dizer isso.
 * Só o teto de decimal(12,2) continua valendo.
 */
export function parseNumeroDigitado(bruto: unknown): ResultadoValor {
  if (bruto === null || bruto === undefined) return { ok: false, erro: MSG_VALOR_ILEGIVEL };
  const n = typeof bruto === "number" ? bruto : parseBrNumber(String(bruto).trim());
  if (n === null || !Number.isFinite(n)) return { ok: false, erro: MSG_VALOR_ILEGIVEL };
  const arredondado = Math.round(n * 100) / 100;
  if (Math.abs(arredondado) > VALOR_MAX) return { ok: false, erro: MSG_VALOR_ALTO };
  return { ok: true, valor: arredondado };
}

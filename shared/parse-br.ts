/** Parse helpers BR (número e data). */

/**
 * Separa o número em sinal + corpo, aceitando "R$", espaço fino e parênteses de negativo.
 * Devolve null se sobrar qualquer coisa que não seja dígito, ponto ou vírgula.
 */
function partesNumero(s: string): { sinal: number; corpo: string } | null {
  let t = s.trim().replace(/\s| |R\$/g, "");
  let sinal = 1;
  if (/^\(.*\)$/.test(t)) {
    sinal = -1;
    t = t.slice(1, -1);
  }
  if (t.startsWith("-")) {
    sinal = -sinal;
    t = t.slice(1);
  } else if (t.startsWith("+")) {
    t = t.slice(1);
  }
  if (!/^[\d.,]+$/.test(t) || !/\d/.test(t)) return null;
  return { sinal, corpo: t };
}

// O primeiro grupo do milhar nunca começa com zero: ninguém escreve "0.005"
// querendo dizer cinco. Sem o [1-9], "0.005" casava como milhar e virava 5.
const AGRUPAMENTO_PONTO = /^[1-9]\d{0,2}(\.\d{3})+$/;
const AGRUPAMENTO_VIRGULA = /^[1-9]\d{0,2}(,\d{3})+$/;

/**
 * Monta o número e RECUSA agrupamento malformado na parte inteira.
 * "12,34,56" e "1.2.3" não são leitura de nenhum formato — devolvem null
 * em vez de um número inventado.
 */
function montar(sinal: number, inteiro: string, decimal: string): number | null {
  if (!/^\d*$/.test(decimal)) return null;
  if (inteiro && !/^\d+$/.test(inteiro)) {
    const ok = AGRUPAMENTO_PONTO.test(inteiro) || AGRUPAMENTO_VIRGULA.test(inteiro);
    if (!ok) return null;
  }
  const i = inteiro.replace(/[.,]/g, "");
  if (!/^\d*$/.test(i)) return null;
  const n = Number(`${i || "0"}.${decimal || "0"}`);
  return Number.isFinite(n) ? sinal * n : null;
}

/**
 * Número em formato brasileiro — vírgula decimal, ponto de milhar.
 *
 * A versão anterior fazia `replace(/\./g, "")` ANTES de decidir o que o ponto era,
 * então todo valor com ponto decimal era multiplicado por 100 em silêncio:
 * "1234.56" virava 123456 e "0.50" virava 50. Como a função devolvia um número
 * (errado) em vez de null, o fallback de formato americano em parseExtratoOfx
 * nunca chegava a rodar — e todo import de OFX, cuja especificação manda usar
 * ponto decimal, entrava com os valores 100x maiores.
 *
 * Regra agora: quem estiver por ÚLTIMO entre "." e "," é o separador decimal.
 * Com apenas ponto, "1.234" (três casas) é milhar — o padrão brasileiro —
 * e "1234.56" (uma ou duas casas) é decimal.
 * O OFX usa este mesmo parser: a especificação manda ponto decimal, mas banco
 * brasileiro emite vírgula, e a regra do último separador cobre os dois.
 */
export function parseBrNumber(s: string | null | undefined): number | null {
  if (!s) return null;
  const p = partesNumero(s);
  if (!p) return null;
  const { sinal, corpo } = p;
  const ultPonto = corpo.lastIndexOf(".");
  const ultVirg = corpo.lastIndexOf(",");

  if (ultPonto >= 0 && ultVirg >= 0) {
    const corte = Math.max(ultPonto, ultVirg);
    return montar(sinal, corpo.slice(0, corte), corpo.slice(corte + 1));
  }
  if (ultVirg >= 0) {
    return montar(sinal, corpo.slice(0, ultVirg), corpo.slice(ultVirg + 1));
  }
  if (ultPonto >= 0) {
    // Só é milhar quando o agrupamento é BEM FORMADO: "1.234", "1.234.567".
    // "1234.567" tem 4 dígitos no primeiro grupo, então não é milhar — é decimal.
    // Sem essa checagem, "1234.567" virava 1234567 e "0.005" virava 5.
    if (AGRUPAMENTO_PONTO.test(corpo)) return montar(sinal, corpo, "");
    return montar(sinal, corpo.slice(0, ultPonto), corpo.slice(ultPonto + 1));
  }
  return montar(sinal, corpo, "");
}

/**
 * A data existe mesmo no calendário? "99/99/9999" casava com a expressão e
 * virava "9999-99-99": uma data impossível entrava no extrato como se fosse boa,
 * e daí em diante nenhuma tela conseguia mais desconfiar dela.
 */
function dataReal(ano: string, mes: string, dia: string): boolean {
  const a = Number(ano);
  const m = Number(mes);
  const d = Number(dia);
  if (!Number.isInteger(a) || a < 1900 || a > 2999) return false;
  if (!Number.isInteger(m) || m < 1 || m > 12) return false;
  if (!Number.isInteger(d) || d < 1) return false;
  const bissexto = (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0;
  const diasNoMes = [31, bissexto ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1];
  return d <= diasNoMes;
}

/** "17/04/2026" (ou ISO) → "2026-04-17". Inválido ou inexistente → null. */
export function parseBrDate(s: string | null | undefined): string | null {
  if (!s) return null;
  const br = s.trim().match(/^(\d{2})\/(\d{2})\/(\d{4})/);
  if (br) return dataReal(br[3], br[2], br[1]) ? `${br[3]}-${br[2]}-${br[1]}` : null;
  const iso = s.trim().match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return dataReal(iso[1], iso[2], iso[3]) ? `${iso[1]}-${iso[2]}-${iso[3]}` : null;
  return null;
}

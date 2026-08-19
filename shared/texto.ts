/**
 * Normalização de texto para busca — um app em português não pode exigir acento.
 *
 * As categorias reais são "Pró-labore", "Água", "Roupas/Lençóis". Digitar
 * "pro-labore" no teclado do celular devolvia ZERO resultados porque os dois
 * lados da comparação eram comparados com acento. Aqui os dois lados passam
 * pela mesma função: decompõe em NFD, joga fora os diacríticos e minúsculo.
 */

const DIACRITICOS = /\p{Diacritic}/gu;

/** "Pró-labore" → "pro-labore". Preserva pontuação e hífen. */
export function normalizarBusca(bruto: unknown): string {
  if (bruto === null || bruto === undefined) return "";
  return String(bruto)
    .normalize("NFD")
    .replace(DIACRITICOS, "")
    .toLowerCase()
    .trim();
}

/**
 * `alvo` contém `termo`, ignorando acento e caixa. Termo vazio casa com tudo —
 * assim quem chama não precisa repetir o `if (!termo) return true`.
 */
export function contemBusca(alvo: unknown, termo: string): boolean {
  const t = normalizarBusca(termo);
  if (!t) return true;
  return normalizarBusca(alvo).includes(t);
}

/**
 * Plural em português: `plural(1, "linha", "linhas")` → "linha".
 *
 * Existia UMA cópia disto dentro do modal de import e, ao lado dela, um trecho
 * que concatenava `${n} linhas lidas` na unha — e escrevia "1 linhas lidas"
 * enquanto o balanço logo abaixo, esse usando o helper, escrevia "1 linha do
 * arquivo". Dois caminhos de plural, um quebrado. Agora é um só, e mora aqui,
 * onde cliente e servidor alcançam.
 */
export function plural(n: number, um: string, muitos: string): string {
  return Math.abs(Number(n)) === 1 ? um : muitos;
}

/** `contarPlural(1, "linha lida", "linhas lidas")` → "1 linha lida". */
export function contarPlural(n: number, um: string, muitos: string): string {
  return `${n} ${plural(n, um, muitos)}`;
}

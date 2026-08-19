/**
 * Balanço de linhas do import de extrato.
 *
 * REGRA DE OURO: `linhasLidas` é contado NA FONTE — o número de linhas de dados
 * do ARQUIVO, antes de qualquer filtro (`ExtratoParseResult.linhasArquivo`).
 * Nunca, em hipótese nenhuma, derive-o de `rows + ignoradas`: era exatamente
 * isso que o import fazia, e por isso o balanço fechava POR CONSTRUÇÃO e era
 * incapaz de detectar uma linha sumindo — a única coisa para a qual ele existe.
 * Uma linha de R$ 0,00 evaporava e a tela mostrava selo verde "Confere".
 *
 * Vocabulário — cada conceito tem UM nome, e nenhum nome serve a dois conceitos:
 *
 *   descartadas   → o leitor pulou a linha DE PROPÓSITO (SALDO ANTERIOR,
 *                   Realizado=Não). É uma linha entendida, só não é movimentação.
 *   naoLidas      → o leitor NÃO CONSEGUIU LER a linha (valor zero, data
 *                   inválida, linha truncada, tipo desconhecido). Sempre com
 *                   motivo, sempre visível: é uma falha, não uma decisão.
 *   jaNoSistema   → a linha já estava gravada (duplicada, ou conflito não regravado).
 *   foraDaSelecao → linha nova que o usuário não marcou; nada foi gravado.
 *   inseridas / regravadas → o que o import realmente escreveu.
 *
 * Toda categoria é disjunta das outras e a soma TEM que dar `linhasLidas`. O que
 * sobrar cai em `naoClassificadas`, que aparece na tela como erro vermelho —
 * nenhuma linha pode sumir do balanço em silêncio.
 */

export interface ContagemLinhas {
  nova: number;
  duplicada: number;
  conflito: number;
  /** Linhas que o leitor pulou de propósito (SALDO ANTERIOR, não realizadas). */
  ignorada: number;
  /** Linhas que o leitor não conseguiu ler. Categoria própria, com motivo. */
  naoLida: number;
}

export interface BalancoPreview {
  linhasLidas: number;
  novas: number;
  conflitos: number;
  jaNoSistema: number;
  descartadas: number;
  naoLidas: number;
  /** Sobra do balanço: linha do arquivo que não caiu em categoria nenhuma. Zero é o esperado. */
  naoClassificadas: number;
  /** Soma de todas as categorias, incluindo a sobra. Sempre igual a linhasLidas. */
  total: number;
  fecha: boolean;
}

export interface BalancoResultado {
  linhasLidas: number;
  inseridas: number;
  regravadas: number;
  jaNoSistema: number;
  foraDaSelecao: number;
  descartadas: number;
  naoLidas: number;
  naoClassificadas: number;
  total: number;
  fecha: boolean;
}

/**
 * Inteiro, preservando o SINAL. Zerar negativo escondia servidor devolvendo
 * número impossível (inseridas > linhas do arquivo); com o sinal preservado a
 * sobra fica negativa e o balanço acusa em vez de disfarçar.
 */
function int(v: unknown): number {
  const x = Math.trunc(Number(v));
  return Number.isFinite(x) ? x : 0;
}

/** Balanço da tela de conferência: cada linha do arquivo em UMA categoria. */
export function balancoPreview(linhasLidas: number, c: ContagemLinhas): BalancoPreview {
  const lidas = int(linhasLidas);
  const novas = int(c.nova);
  const conflitos = int(c.conflito);
  const jaNoSistema = int(c.duplicada);
  const descartadas = int(c.ignorada);
  const naoLidas = int(c.naoLida);
  const soma = novas + conflitos + jaNoSistema + descartadas + naoLidas;
  const naoClassificadas = lidas - soma;
  return {
    linhasLidas: lidas,
    novas,
    conflitos,
    jaNoSistema,
    descartadas,
    naoLidas,
    naoClassificadas,
    total: soma + naoClassificadas,
    fecha: naoClassificadas === 0,
  };
}

/**
 * O que a API do import devolveu de fato. Nada aqui é recalculado a partir da
 * classificação do preview: se o servidor gravou algo diferente do previsto, o
 * balanço tem que DIZER isso, e não colapsar de volta no balanço do preview.
 */
export interface RespostaImport {
  linhasLidas: number;
  inseridas: number;
  regravadas: number;
  jaNoSistema: number;
  foraDaSelecao: number;
  descartadas: number;
  naoLidas: number;
}

/**
 * Balanço da tela de resultado, com os números QUE A API DEVOLVEU.
 *
 * A versão anterior fazia `limitar(inseridas, contagem.nova)` e depois
 * `foraDaSelecao = nova − inseridas`, `jaNoSistema = duplicada + (conflito −
 * regravadas)`: algebricamente isso colapsa em `nova + duplicada + conflito +
 * ignorada`, ou seja, no balanço do PREVIEW, independentemente do que o servidor
 * respondeu. Era decoração — fechava sempre, mesmo com o import gravando outra
 * coisa. Agora a resposta do servidor entra crua e, se não fechar, aparece.
 */
export function balancoResultado(r: RespostaImport): BalancoResultado {
  const lidas = int(r.linhasLidas);
  const inseridas = int(r.inseridas);
  const regravadas = int(r.regravadas);
  const jaNoSistema = int(r.jaNoSistema);
  const foraDaSelecao = int(r.foraDaSelecao);
  const descartadas = int(r.descartadas);
  const naoLidas = int(r.naoLidas);
  const soma = inseridas + regravadas + jaNoSistema + foraDaSelecao + descartadas + naoLidas;
  const naoClassificadas = lidas - soma;
  return {
    linhasLidas: lidas,
    inseridas,
    regravadas,
    jaNoSistema,
    foraDaSelecao,
    descartadas,
    naoLidas,
    naoClassificadas,
    total: soma + naoClassificadas,
    fecha: naoClassificadas === 0,
  };
}

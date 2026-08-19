import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronDown,
  CircleSlash,
  Copy,
  FileText,
  Link2,
  Loader2,
  Sparkles,
  Upload,
  Wallet,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { conferirFechamentoExtrato } from "@shared/extrato-diff";
import { contemBusca, contarPlural, plural } from "@shared/texto";
import { type DecisaoContaAtiva, type MudancasFora } from "@shared/extrato-conta";
import { parseNumeroDigitado } from "@shared/valor";
import { InputDecimalBr, paraCampoDecimalBr } from "@/components/ui/input-decimal-br";
import {
  balancoPreview,
  balancoResultado,
  type BalancoPreview,
  type BalancoResultado,
  type ContagemLinhas,
  type RespostaImport,
} from "@shared/extrato-balanco";
import { useMoney } from "@/lib/hide-values";
import { formatDateBR } from "@/lib/formatters";
import { Chip, type ChipTone } from "@/components/ui/chip";
import { FilterChips, type FiltroOpcao } from "@/components/ui/filter-chips";
import { KpiCard } from "@/components/ui/kpi";
import { Busca } from "@/components/ui/busca";
import { EmptyState } from "@/components/ui/empty-state";
import { useFocoModal, useTravaScrollBody } from "@/components/ui/sheet";

/* ------------------------------------------------------------------ */
/* Contrato da API                                                     */
/* ------------------------------------------------------------------ */

/**
 * `ignorada`  = o leitor pulou DE PROPOSITO (SALDO ANTERIOR, Realizado=Nao).
 * `nao-lida`  = o leitor NAO CONSEGUIU LER a linha. Sao coisas diferentes e por
 * isso tem nomes diferentes: a primeira e uma decisao do leitor, a segunda e uma
 * falha, e a linha some do extrato sem que ninguem tenha decidido isso.
 */
export type SituacaoLinha = "nova" | "duplicada" | "conflito" | "ignorada" | "nao-lida";

/** Linha de dados que o leitor nao conseguiu interpretar, com o motivo. */
export interface LinhaNaoLida {
  linha: number;
  motivo: string;
  conteudo: string;
}

export interface DiffCampo {
  campo: "valor" | "data" | "historico" | string;
  de: string;
  para: string;
}

export interface LinhaPreview {
  idx: number;
  data: string | null;
  historico: string;
  documento?: string | null;
  valor: number | null;
  tipo: "C" | "D" | null;
  categoria?: string | null;
  dedupKey: string;
  /** Metadados que o import repassa ao sistema (sync Gendo). */
  descricao?: string | null;
  forma?: "dinheiro" | "pix" | "cartao";
  syncReceita?: boolean;
  syncDespesa?: boolean;
  ocorrencia?: number;
  situacao: SituacaoLinha;
  motivo?: string;
  /** Numero da linha no arquivo. So existe quando `situacao === "nao-lida"`. */
  linhaArquivo?: number;
  /** Conflito veio da movimentação gravada ou do lançamento manual vinculado. */
  origemConflito?: "movimentacao" | "vinculo";
  existente?: { id: string; data: string; historico: string; valor: number; tipo: string };
  diffs?: DiffCampo[];
  vinculo?: {
    tipo: "conta_pagar" | "receita_dia" | "recebivel";
    id: string;
    descricao: string;
    valor: number;
    data: string;
    diffs?: DiffCampo[];
  };
}

export interface ExtratoPreview {
  arquivo: { nome: string; formato: string; linhasLidas: number };
  conta: {
    agencia: string;
    conta: string;
    nomeSugerido: string;
    titular?: string | null;
    existenteId: string | null;
  };
  /**
   * Conta ativa AGORA, antes de gravar. Sem isto a tela não tinha como saber
   * que confirmar o import trocaria a conta ativa — e trocava em silêncio.
   */
  contaAtiva?: {
    id: string;
    nome: string;
    agencia: string;
    conta: string;
    mesmaDoArquivo: boolean;
  } | null;
  periodo: { de: string; ate: string } | null;
  /** Saldo de fechamento do arquivo. */
  saldoExtrato: { data: string | null; valor: number } | null;
  /** Saldo de abertura do arquivo (linha SALDO ANTERIOR), quando o formato traz. */
  saldoInicial?: { data: string | null; valor: number } | null;
  totais: { creditos: { n: number; soma: number }; debitos: { n: number; soma: number } };
  linhas: LinhaPreview[];
  resumo: {
    novas: number;
    duplicadas: number;
    conflitos: number;
    ignoradas: number;
    naoLidas: number;
  };
  /**
   * Linhas que o leitor nao entendeu. Estavam no contrato da API mas nem
   * declaradas neste tipo nem exibidas em lugar nenhum: o usuario nao tinha
   * como saber QUAL linha o sistema nao leu.
   */
  naoLidas: LinhaNaoLida[];
  /** Mesmas nao lidas em texto corrido, uma frase por linha. */
  erros: string[];
}

export interface ExtratoImportResult {
  inseridas: number;
  atualizadas: number;
  vinculosAtualizados: number;
  conta?: { id: string; nome: string } | null;
  /**
   * Balanco que o SERVIDOR produziu. O resultado mostra estes numeros crus:
   * recalcula-los a partir da classificacao do preview fazia o balanco fechar
   * sempre, tivesse o import gravado o que tivesse.
   */
  balanco?: RespostaImport & { linhasRecebidas?: number };
  /** O que o import mexeu FORA das linhas: conta criada, conta ativa, âncora. */
  mudancas?: MudancasFora | null;
}

/* ------------------------------------------------------------------ */
/* Rótulos / helpers                                                   */
/* ------------------------------------------------------------------ */

/*
 * VOCABULÁRIO — cada conceito tem UM nome, e nenhum nome serve a dois conceitos.
 * "Ignorada" queria dizer a linha que o leitor pulou (no preview) e a linha que
 * já estava gravada (no resultado); a conta não fechava e o usuário não tinha
 * como saber qual das duas estava vendo. Agora:
 *   Descartada        → o leitor pulou (SALDO ANTERIOR, cabeçalho).
 *   Já estava no sistema → duplicada, ou conflito que não foi regravado.
 *   Deixada de fora   → linha nova que não foi marcada.
 */
const ROTULO_SITUACAO: Record<SituacaoLinha, string> = {
  nova: "Nova",
  duplicada: "Duplicada",
  conflito: "Conflito",
  ignorada: "Descartada",
  "nao-lida": "Não lida",
};

const TONE_SITUACAO: Record<SituacaoLinha, ChipTone> = {
  nova: "accent",
  duplicada: "neutro",
  conflito: "ambar",
  ignorada: "neutro",
  // Vermelho: o sistema falhou em ler a linha. Não é uma escolha, é um defeito
  // do arquivo, e tem que ler como problema — não como categoria tranquila.
  "nao-lida": "vermelho",
};

const ROTULO_FORMATO: Record<string, string> = {
  "conta-titulares": "CSV do banco (Conta/Titulares)",
  viacredi: "CSV Viacredi",
  "gendo-transacoes": "CSV Gendo (transações)",
  ofx: "OFX",
};

const ROTULO_VINCULO: Record<string, string> = {
  conta_pagar: "Conta a pagar",
  receita_dia: "Receita do dia",
  recebivel: "Valor a receber",
};

const ROTULO_CAMPO: Record<string, string> = {
  valor: "Valor",
  valorPago: "Valor pago",
  data: "Data",
  dataPagamento: "Data de pagamento",
  dataVencimento: "Vencimento",
  historico: "Histórico",
  descricao: "Descrição",
  status: "Situação",
  tipo: "Tipo",
};

/** Só linhas novas e em conflito podem ser escolhidas para importar. */
function selecionavel(l: LinhaPreview): boolean {
  return l.situacao === "nova" || l.situacao === "conflito";
}

/**
 * O que a marca da linha decide NO MODO ATUAL. Em "Somente novas" marcar um
 * conflito não muda nada — e caixa marcada que não faz nada é mentira: ali ela
 * aparece desmarcada, desabilitada e com o motivo escrito na própria linha.
 */
function selecionavelNoModo(l: LinhaPreview, modo: Modo): boolean {
  if (l.situacao === "nova") return true;
  return l.situacao === "conflito" && modo === "sobrescrever";
}

/** A linha diverge do sistema — pela movimentação gravada ou pelo lançamento vinculado. */
function divergente(l: LinhaPreview): boolean {
  return (l.diffs?.length ?? 0) > 0 || (l.vinculo?.diffs?.length ?? 0) > 0;
}

/**
 * Dinheiro com sinal explícito. Um card de movimento sem sinal é ambíguo:
 * "R$ 5.444,52" não diz se entrou ou saiu, e no caso das duplicadas era
 * |créditos| + |débitos| — um número que não existe no extrato nem no caixa.
 */
function comSinal(v: number, format: (n: number) => string): string {
  const n = Math.round((Number(v) || 0) * 100) / 100;
  if (n === 0) return format(0);
  return `${n > 0 ? "+" : "−"}${format(Math.abs(n))}`;
}

/**
 * Conferência de fechamento do extrato: a soma dos créditos menos a dos débitos
 * tem que dar exatamente a variação do saldo do próprio arquivo. Se não der, o
 * arquivo está truncado ou tem linha que o leitor não entendeu — e isso precisa
 * aparecer ANTES de gravar, não depois.
 */
export function conferirFechamento(
  p: ExtratoPreview | null,
): (ReturnType<typeof conferirFechamentoExtrato> & { saldoInicial: number; saldoFinal: number }) | null {
  const ini = p?.saldoInicial?.valor;
  const fim = p?.saldoExtrato?.valor;
  if (p == null || ini == null || fim == null) return null;
  return {
    ...conferirFechamentoExtrato({
      creditos: p.totais?.creditos?.soma ?? 0,
      debitos: p.totais?.debitos?.soma ?? 0,
      saldoInicial: ini,
      saldoFinal: fim,
    }),
    saldoInicial: ini,
    saldoFinal: fim,
  };
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

function ehData(v: string): boolean {
  return ISO.test(v.trim());
}

/** Extrai a ocorrência do sufixo `#n` do dedupKey (compatibilidade com o import antigo). */
function ocorrenciaDe(dedupKey: string): number {
  const n = Number(String(dedupKey).split("#").pop());
  return Number.isFinite(n) && n > 0 ? n : 1;
}

async function pedirPreview(file: File): Promise<ExtratoPreview> {
  const fd = new FormData();
  fd.append("file", file);
  const res = await fetch("/api/extrato/preview", {
    method: "POST",
    body: fd,
    credentials: "include",
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Sessão expirada. Entre de novo.");
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("json")) {
    throw new Error(
      `A conferência do extrato (/api/extrato/preview) não respondeu como esperado (HTTP ${res.status}). Reinicie o servidor e tente de novo.`,
    );
  }
  const data = await res.json();
  if (!res.ok) throw new Error(data?.message || `Falha ao ler o extrato (HTTP ${res.status})`);
  return data as ExtratoPreview;
}

/**
 * O servidor recusou o import porque o extrato é de uma conta diferente da
 * ativa e ninguém autorizou a troca. NADA foi gravado: é uma pergunta, não uma
 * falha, e por isso não vira caixa vermelha de erro.
 */
export interface PerguntaContaDiferente {
  tipo: "conta-diferente";
  contaAtiva: { id: string; nome: string; agencia: string; conta: string };
  contaExtrato: { agencia: string; conta: string; nome: string; existe: boolean };
  opcoes: { id: DecisaoContaAtiva; rotulo: string }[];
}

class ImportPrecisaDecisao extends Error {
  constructor(
    message: string,
    readonly pergunta: PerguntaContaDiferente,
  ) {
    super(message);
    this.name = "ImportPrecisaDecisao";
  }
}

async function pedirImport(body: unknown): Promise<ExtratoImportResult> {
  const res = await fetch("/api/extrato/import", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status === 401) {
    window.location.href = "/login";
    throw new Error("Sessão expirada. Entre de novo.");
  }
  const ct = res.headers.get("content-type") || "";
  if (!ct.includes("json")) throw new Error(`Falha ao importar o extrato (HTTP ${res.status})`);
  const data = await res.json();
  if (res.status === 409 && data?.pergunta?.tipo === "conta-diferente") {
    throw new ImportPrecisaDecisao(
      data.message || "Este extrato é de outra conta.",
      data.pergunta as PerguntaContaDiferente,
    );
  }
  if (!res.ok) throw new Error(data?.message || `Falha ao importar o extrato (HTTP ${res.status})`);
  return data as ExtratoImportResult;
}

/* ------------------------------------------------------------------ */
/* Modal                                                               */
/* ------------------------------------------------------------------ */

type Passo = "arquivo" | "conferencia" | "resultado";
type Modo = "somente-novas" | "sobrescrever";
/** O que o modal mostra no passo final — inclui a âncora, que a API não devolve. */
type ResultadoLocal = ExtratoImportResult & { ancora?: { data: string; valor: number } | null };

export default function ImportExtratoModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const { format } = useMoney();
  const painelRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const selectAllRef = useRef<HTMLInputElement>(null);
  const selectAllMobileRef = useRef<HTMLInputElement>(null);

  const [passo, setPasso] = useState<Passo>("arquivo");
  const [arquivo, setArquivo] = useState<File | null>(null);
  const [preview, setPreview] = useState<ExtratoPreview | null>(null);
  const [resultado, setResultado] = useState<ResultadoLocal | null>(null);
  const [carregando, setCarregando] = useState(false);
  const [importando, setImportando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [arrastando, setArrastando] = useState(false);

  const [filtro, setFiltro] = useState<"todas" | SituacaoLinha>("todas");
  const [busca, setBusca] = useState("");
  const [selecionadas, setSelecionadas] = useState<Set<string>>(new Set());
  const [modo, setModo] = useState<Modo>("somente-novas");
  const [aplicarVinculos, setAplicarVinculos] = useState(true);
  const [ancora, setAncora] = useState({ data: "", valor: "" });
  const [usarAncora, setUsarAncora] = useState(true);
  /**
   * Extrato de uma conta diferente da ativa: a decisão é do usuário. Enquanto
   * for `null`, o import não manda nada e o servidor devolve a pergunta —
   * trocar a conta ativa em silêncio apagava o saldo real do painel.
   */
  const [decisaoConta, setDecisaoConta] = useState<DecisaoContaAtiva | null>(null);
  const [pergunta, setPergunta] = useState<PerguntaContaDiferente | null>(null);

  useTravaScrollBody(true);
  useFocoModal(true, painelRef, onClose);

  const linhas = preview?.linhas ?? [];

  /* --- envio do arquivo ------------------------------------------- */

  async function enviarArquivo(f: File) {
    const nome = f.name.toLowerCase();
    if (!nome.endsWith(".csv") && !nome.endsWith(".ofx")) {
      setErro(
        `“${f.name}” não é um extrato: só leio arquivos .csv e .ofx. Baixe o extrato pelo aplicativo do banco em um desses formatos.`,
      );
      return;
    }
    setArquivo(f);
    setErro(null);
    setCarregando(true);
    setPreview(null);
    setResultado(null);
    // Trocando o arquivo no meio da conferência: volta para o passo 1, que já
    // tem o "lendo o arquivo…" e a caixa de erro. Sem isso o corpo ficaria vazio.
    setPasso("arquivo");
    try {
      const p = await pedirPreview(f);
      const ls = Array.isArray(p.linhas) ? p.linhas : [];
      setPreview({ ...p, linhas: ls });
      setSelecionadas(new Set(ls.filter(selecionavel).map((l) => l.dedupKey)));
      setAncora({
        data: p.saldoExtrato?.data || p.periodo?.ate || "",
        valor: paraCampoDecimalBr(p.saldoExtrato?.valor),
      });
      setUsarAncora(p.saldoExtrato?.valor != null);
      setModo("somente-novas");
      /*
       * Conta ativa: o padrão é NÃO mexer. Só quando o extrato é da própria
       * conta ativa (ou não há nenhuma) a resposta já é óbvia e nada é
       * perguntado.
       */
      setPergunta(null);
      setDecisaoConta(
        !p.contaAtiva || p.contaAtiva.mesmaDoArquivo ? null : "manter",
      );
      // Abre já no problema mais grave: linha que o sistema não leu vem antes
      // de conflito, porque ela some do extrato sem ninguém ter decidido isso.
      setFiltro(
        (p.resumo?.naoLidas ?? 0) > 0
          ? "nao-lida"
          : (p.resumo?.conflitos ?? 0) > 0
            ? "conflito"
            : "todas",
      );
      setBusca("");
      setPasso("conferencia");
    } catch (e: any) {
      setErro(e?.message || "Não foi possível ler o extrato.");
    } finally {
      setCarregando(false);
    }
  }

  /* --- derivados --------------------------------------------------- */

  /*
   * Soma LIQUIDA de cada categoria: crédito entra somando, débito subtraindo.
   * Somar |créditos| + |débitos| dava "Duplicadas · R$ 5.444,52" para 30 linhas
   * cujo líquido é −R$ 384,52 — um número que não é dinheiro nenhum: nem entrou,
   * nem saiu, nem sobrou. Aqui o card mostra o efeito no caixa, com sinal.
   */
  const liquidoPorSituacao = useMemo(() => {
    const acc: Record<SituacaoLinha, number> = {
      nova: 0,
      duplicada: 0,
      conflito: 0,
      ignorada: 0,
      "nao-lida": 0,
    };
    for (const l of linhas) {
      const v = Math.abs(Number(l.valor) || 0);
      acc[l.situacao] = (acc[l.situacao] ?? 0) + (l.tipo === "D" ? -v : l.tipo === "C" ? v : 0);
    }
    return acc;
  }, [linhas]);

  const contagem = useMemo(() => {
    const acc: ContagemLinhas = { nova: 0, duplicada: 0, conflito: 0, ignorada: 0, naoLida: 0 };
    for (const l of linhas) {
      if (l.situacao === "nao-lida") acc.naoLida++;
      else acc[l.situacao] = (acc[l.situacao] ?? 0) + 1;
    }
    return acc;
  }, [linhas]);

  /*
   * Balanço: toda linha lida do arquivo tem que aparecer em UMA categoria, e a
   * soma tem que dar o total lido. Antes o preview dizia "1 ignorada" (linha que
   * o leitor pulou) e o resultado dizia "30 ignoradas" (linhas que já estavam no
   * sistema) — dois conceitos com o mesmo nome, e uma linha sumindo no meio.
   */
  const linhasLidas = preview?.arquivo?.linhasLidas ?? linhas.length;
  const balPreview = useMemo(() => balancoPreview(linhasLidas, contagem), [linhasLidas, contagem]);

  const visiveis = useMemo(() => {
    const termo = busca.trim();
    return linhas.filter((l) => {
      if (filtro !== "todas" && l.situacao !== filtro) return false;
      if (!termo) return true;
      // Sem acento dos dois lados: "pro-labore" acha "Pró-labore".
      return (
        contemBusca(l.historico, termo) ||
        contemBusca(l.documento, termo) ||
        contemBusca(l.categoria, termo) ||
        contemBusca(formatDateBR(l.data || ""), termo)
      );
    });
  }, [linhas, filtro, busca]);

  const selecionaveisVisiveis = useMemo(
    () => visiveis.filter((l) => selecionavelNoModo(l, modo)),
    [visiveis, modo],
  );
  const todasVisiveisMarcadas =
    selecionaveisVisiveis.length > 0 &&
    selecionaveisVisiveis.every((l) => selecionadas.has(l.dedupKey));
  const algumaVisivelMarcada = selecionaveisVisiveis.some((l) => selecionadas.has(l.dedupKey));

  useEffect(() => {
    const parcial = algumaVisivelMarcada && !todasVisiveisMarcadas;
    if (selectAllRef.current) selectAllRef.current.indeterminate = parcial;
    if (selectAllMobileRef.current) selectAllMobileRef.current.indeterminate = parcial;
  }, [algumaVisivelMarcada, todasVisiveisMarcadas]);

  const novasMarcadas = useMemo(
    () => linhas.filter((l) => l.situacao === "nova" && selecionadas.has(l.dedupKey)),
    [linhas, selecionadas],
  );
  const conflitosMarcados = useMemo(
    () => linhas.filter((l) => l.situacao === "conflito" && selecionadas.has(l.dedupKey)),
    [linhas, selecionadas],
  );
  /** Divergências REAIS no arquivo — independem do que está marcado. */
  const totalDivergentes = useMemo(() => linhas.filter(divergente).length, [linhas]);
  const totalVinculosDivergentes = useMemo(
    () => linhas.filter((l) => (l.vinculo?.diffs?.length ?? 0) > 0).length,
    [linhas],
  );
  /** Dos marcados, quantos têm vínculo a corrigir (é o que o import vai mexer). */
  const vinculosMarcados = useMemo(
    () =>
      linhas.filter((l) => selecionadas.has(l.dedupKey) && (l.vinculo?.diffs?.length ?? 0) > 0)
        .length,
    [linhas, selecionadas],
  );

  const qtdInserir = novasMarcadas.length;
  const qtdAtualizar = modo === "sobrescrever" ? conflitosMarcados.length : 0;

  /* --- âncora de saldo (grava sozinha, sem linha nenhuma) ----------- */

  /*
   * O `replace(",", ".")` que estava aqui trocava só a PRIMEIRA vírgula:
   * "1.234,56" — o jeito como o saldo aparece no extrato — virava "1.234.56"
   * e daí NaN, e o campo de âncora ficava eternamente "inválido" sem dizer por
   * quê. Agora quem lê é o parser do extrato. Saldo pode ser negativo: uma
   * conta no vermelho precisa poder dizer isso, então não é parseValorPositivo.
   */
  const ancoraLida = parseNumeroDigitado(ancora.valor);
  const valorAncoraNum = ancoraLida.ok ? ancoraLida.valor : NaN;
  const erroAncora =
    usarAncora && ancora.valor.trim() !== "" && !ancoraLida.ok ? ancoraLida.erro : null;
  const ancoraValida = usarAncora && !!ancora.data && ancoraLida.ok;
  const totalLinhas = qtdInserir + qtdAtualizar;
  const podeConfirmar = totalLinhas > 0 || ancoraValida;
  /** O rótulo do botão diz o que vai acontecer de fato. */
  const rotuloConfirmar =
    totalLinhas === 0
      ? "Gravar só o saldo"
      : qtdInserir > 0 && qtdAtualizar > 0
        ? "Importar e sobrescrever"
        : qtdAtualizar > 0
          ? `Sobrescrever ${qtdAtualizar} ${plural(qtdAtualizar, "divergente", "divergentes")}`
          : `Importar ${qtdInserir} ${plural(qtdInserir, "nova", "novas")}`;

  const fechamento = useMemo(() => conferirFechamento(preview), [preview]);

  /**
   * Balanço do resultado com os números QUE A API DEVOLVEU. Antes ele era
   * recalculado da classificação do preview e colapsava algebricamente no
   * balanço do preview: fechava sempre, dissesse o servidor o que dissesse.
   */
  const balResultado = useMemo<BalancoResultado | null>(
    () =>
      resultado?.balanco
        ? balancoResultado(resultado.balanco)
        : resultado
          ? // Servidor antigo, sem balanço: melhor admitir que não dá para
            // conferir do que inventar uma conta que fecha sozinha.
            balancoResultado({
              linhasLidas,
              inseridas: resultado.inseridas,
              regravadas: resultado.atualizadas,
              jaNoSistema: 0,
              foraDaSelecao: 0,
              descartadas: 0,
              naoLidas: 0,
            })
          : null,
    [resultado, linhasLidas],
  );

  /*
   * A descrição de cada modo tem que descrever a AÇÃO QUE VAI ACONTECER com a
   * seleção atual — nada de citar um total fixo do arquivo enquanto o rodapé diz
   * outro número. E "extrato/arquivo" é sempre o que veio do banco; o que já
   * está gravado é "os seus lançamentos" / "o sistema". Nunca "banco" para os dois.
   */
  const nMarcados = conflitosMarcados.length;
  const trechoNovas = `${qtdInserir} ${plural(qtdInserir, "linha nova marcada", "linhas novas marcadas")}`;

  const descricaoSomenteNovas =
    totalDivergentes > 0
      ? `Insere ${trechoNovas}. ${
          totalDivergentes === 1
            ? "A linha divergente continua"
            : `As ${totalDivergentes} linhas divergentes continuam`
        } como ${plural(totalDivergentes, "está", "estão")} no sistema — o extrato não regrava nada.`
      : `Insere ${trechoNovas}. Nada do que já está gravado é alterado.`;

  const descricaoSobrescrever =
    totalDivergentes === 0
      ? "Nenhuma divergência neste arquivo — não há o que regravar. Só as linhas novas marcadas entram."
      : nMarcados === 0
        ? `Nenhuma linha divergente está marcada: do jeito que está, nada será regravado. Marque ${
            totalDivergentes === 1
              ? "a linha divergente"
              : `alguma das ${totalDivergentes} linhas divergentes`
          } na lista acima para o extrato valer sobre o sistema.`
        : `Regrava ${
            nMarcados === totalDivergentes
              ? totalDivergentes === 1
                ? "a linha divergente"
                : `as ${totalDivergentes} linhas divergentes`
              : `${nMarcados} de ${totalDivergentes} linhas divergentes`
          } com a data, o valor e o histórico DO EXTRATO, por cima do que está lançado no sistema${
            qtdInserir > 0 ? `, e insere ${trechoNovas}` : ""
          }.`;

  function alternar(dedupKey: string) {
    setSelecionadas((s) => {
      const n = new Set(s);
      if (n.has(dedupKey)) n.delete(dedupKey);
      else n.add(dedupKey);
      return n;
    });
  }

  function alternarTodasVisiveis() {
    setSelecionadas((s) => {
      const n = new Set(s);
      if (todasVisiveisMarcadas) selecionaveisVisiveis.forEach((l) => n.delete(l.dedupKey));
      else selecionaveisVisiveis.forEach((l) => n.add(l.dedupKey));
      return n;
    });
  }

  /* --- import ------------------------------------------------------ */

  async function importar() {
    if (!preview) return;
    if (totalLinhas === 0 && !ancoraValida) {
      toast.message("Nada selecionado para importar.");
      return;
    }
    const soAncora = totalLinhas === 0;
    setImportando(true);
    setErro(null);
    try {
      // Nem descartada nem não lida viram movimentação: uma foi pulada de
      // propósito, a outra o leitor não conseguiu ler.
      const aImportar = linhas.filter(
        (l) => l.situacao !== "ignorada" && l.situacao !== "nao-lida",
      );
      const rows = aImportar.map((l) => ({
        data: l.data,
        historico: l.historico,
        documento: l.documento ?? null,
        valor: l.valor,
        tipo: l.tipo,
        ocorrencia: l.ocorrencia ?? ocorrenciaDe(l.dedupKey),
        dedupKey: l.dedupKey,
        categoria: l.categoria ?? null,
        // metadados que o import repassa ao sistema (sync Gendo)
        descricao: l.descricao ?? null,
        forma: l.forma,
        syncReceita: l.syncReceita,
        syncDespesa: l.syncDespesa,
      }));
      const body = {
        // compatibilidade com o import atual
        agencia: preview.conta?.agencia,
        conta: preview.conta?.conta,
        nome: preview.conta?.nomeSugerido,
        formato: preview.arquivo?.formato,
        rows,
        // preview completo, para o backend novo
        linhas,
        ativar: true,
        saldoInicialData: ancoraValida ? ancora.data : undefined,
        saldoInicialValor: ancoraValida ? valorAncoraNum : undefined,
        // novo contrato
        modo,
        // Contagens do arquivo, para o balanço do resultado fechar contra as
        // linhas do ARQUIVO e não contra as linhas que este cliente mandou.
        linhasLidas,
        descartadas: contagem.ignorada,
        naoLidas: contagem.naoLida,
        // Conta ativa: só troca se o usuário tiver dito que quer trocar.
        decisaoContaAtiva: decisaoConta,
        // Gravando só a âncora, nenhuma linha entra.
        selecionadas: soAncora ? [] : Array.from(selecionadas),
        aplicarVinculos: !soAncora && modo === "sobrescrever" ? aplicarVinculos : false,
      };
      const r = await pedirImport(body);
      setResultado({
        inseridas: r.inseridas ?? 0,
        atualizadas: r.atualizadas ?? 0,
        vinculosAtualizados: r.vinculosAtualizados ?? 0,
        balanco: r.balanco,
        mudancas: r.mudancas ?? null,
        conta: r.conta ?? null,
        ancora: ancoraValida ? { data: ancora.data, valor: valorAncoraNum } : null,
      });
      setPergunta(null);
      setPasso("resultado");
      onSaved();
    } catch (e: any) {
      // Pergunta do servidor: nada foi gravado, e isto não é erro nenhum.
      if (e instanceof ImportPrecisaDecisao) {
        setPergunta(e.pergunta);
        setErro(null);
        return;
      }
      const msg = e?.message || "Não foi possível importar o extrato.";
      setErro(msg);
      toast.error(msg);
    } finally {
      setImportando(false);
    }
  }

  function recomecar() {
    setPasso("arquivo");
    setPreview(null);
    setResultado(null);
    setArquivo(null);
    setErro(null);
    setSelecionadas(new Set());
    setBusca("");
    setFiltro("todas");
    setPergunta(null);
    setDecisaoConta(null);
  }

  /* --- render ------------------------------------------------------ */

  /*
   * Ordem do trilho de chips: PROBLEMA PRIMEIRO. Os chips pediam 411px de
   * trilho numa janela de ~300px e "Descartadas" só existia rolando — com
   * "Todas / Novas / Duplicadas" ocupando a parte visível. Agora o que exige
   * decisão (não lidas, conflitos) fica na parte que sempre aparece, e no
   * celular os chips vazios somem do trilho em vez de empurrar os cheios.
   */
  const opcoesFiltro: FiltroOpcao[] = [
    { id: "todas", label: "Todas", count: linhas.length },
    { id: "nao-lida", label: "Não lidas", count: contagem.naoLida },
    { id: "conflito", label: "Conflitos", count: contagem.conflito },
    { id: "nova", label: "Novas", count: contagem.nova },
    { id: "duplicada", label: "Duplicadas", count: contagem.duplicada },
    { id: "ignorada", label: "Descartadas", count: contagem.ignorada },
  ];
  const opcoesFiltroMobile = opcoesFiltro.filter((o) => o.id === "todas" || (o.count ?? 0) > 0);

  function diffTexto(campo: string, v: string): string {
    const s = String(v ?? "").trim();
    if (s === "") return "—";
    // Datas: qualquer campo que venha em ISO vira dd/mm/aaaa.
    if (ehData(s)) return formatDateBR(s);
    if (campo.toLowerCase().includes("valor")) {
      // O backend manda o número já com ponto decimal ("480.26").
      const n = Number(s);
      if (Number.isFinite(n)) return format(n);
      const br = Number(s.replace(/\./g, "").replace(",", "."));
      return Number.isFinite(br) ? format(br) : s;
    }
    return s;
  }

  return createPortal(
    <div className="fixed inset-0 z-50 grid place-items-center p-3 sm:p-4">
      <div className="absolute inset-0 bg-[var(--text)]/40" onClick={onClose} aria-hidden />

      <div
        ref={painelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="import-extrato-titulo"
        tabIndex={-1}
        className="relative flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] outline-none"
      >
        {/* Cabeçalho */}
        <div className="flex items-start gap-3 border-b border-[var(--border)] px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            <h2
              id="import-extrato-titulo"
              className="text-lg font-medium text-[var(--text)]"
            >
              Importar extrato
            </h2>
            <p className="mt-0.5 truncate text-xs text-[var(--text-muted)]">
              {passo === "arquivo" && "Confira tudo antes de gravar. Nada é salvo até você confirmar."}
              {/*
                MESMO helper de plural do balanço logo abaixo. Aqui era
                `${n} linhas lidas` concatenado na unha: escrevia "1 linhas
                lidas" enquanto o balanço escrevia "1 linha do arquivo".
              */}
              {passo === "conferencia" &&
                `${preview?.arquivo?.nome ?? arquivo?.name ?? "arquivo"} · ${contarPlural(
                  preview?.arquivo?.linhasLidas ?? linhas.length,
                  "linha lida",
                  "linhas lidas",
                )}`}
              {passo === "resultado" && "Importação concluída"}
            </p>
          </div>
          {passo === "conferencia" && (
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              title="Escolher outro arquivo"
              className="inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-[var(--text)] sm:pointer-fine:min-h-0"
            >
              <Upload size={13} aria-hidden />
              <span>
                Trocar<span className="hidden sm:inline"> arquivo</span>
              </span>
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            aria-label="Fechar"
            className="grid size-11 shrink-0 place-items-center rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:bg-[var(--bg-card)] hover:text-[var(--text)] sm:pointer-fine:size-8"
          >
            <X size={16} aria-hidden />
          </button>
        </div>

        {/* Corpo rolável */}
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4 sm:px-5">
          {/*
            O seletor de arquivo fica montado em TODOS os passos: é ele que faz o
            "Trocar arquivo" funcionar no celular, onde não há como arrastar nada.
          */}
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.ofx,text/csv,application/x-ofx,application/ofx"
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void enviarArquivo(f);
              e.target.value = "";
            }}
          />

          {/* PASSO 1 — arquivo */}
          {passo === "arquivo" && (
            <div className="flex flex-col gap-3">
              <button
                type="button"
                disabled={carregando}
                onClick={() => fileRef.current?.click()}
                onDragOver={(e) => {
                  e.preventDefault();
                  setArrastando(true);
                }}
                onDragLeave={() => setArrastando(false)}
                onDrop={(e) => {
                  e.preventDefault();
                  setArrastando(false);
                  const f = e.dataTransfer.files?.[0];
                  if (f) void enviarArquivo(f);
                }}
                className="flex w-full flex-col items-center justify-center gap-2 rounded-xl border border-dashed px-6 py-14 text-center transition-colors disabled:opacity-60"
                style={{
                  borderColor: arrastando ? "var(--accent)" : "var(--border)",
                  backgroundColor: arrastando
                    ? "color-mix(in srgb, var(--accent) 8%, var(--bg-card))"
                    : "var(--bg-card)",
                }}
              >
                {carregando ? (
                  <>
                    <Loader2
                      size={22}
                      aria-hidden
                      className="animate-spin text-[var(--accent-text)]"
                    />
                    <p className="text-sm font-medium text-[var(--text)]" aria-live="polite">
                      Lendo o arquivo e comparando com os seus lançamentos…
                    </p>
                    <p className="text-xs text-[var(--text-muted)]">
                      {arquivo?.name} · nada será gravado nesta etapa
                    </p>
                  </>
                ) : (
                  <>
                    <span
                      className="mb-1 grid size-11 place-items-center rounded-full text-[var(--accent-text)]"
                      style={{
                        backgroundColor: "color-mix(in srgb, var(--accent) 10%, transparent)",
                      }}
                      aria-hidden
                    >
                      <Upload size={20} />
                    </span>
                    <p className="text-sm font-medium text-[var(--text)]">
                      Arraste o extrato aqui ou clique para escolher
                    </p>
                    <p className="max-w-md text-xs text-[var(--text-muted)]">
                      Aceita <strong>.csv</strong> e <strong>.ofx</strong> — extrato do banco
                      (Conta/Titulares, Viacredi), OFX ou <em>transacoes.csv</em> do Gendo.
                    </p>
                  </>
                )}
              </button>

              {erro && <CaixaErro texto={erro} />}

              <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                Em caso de conflito, o extrato vale mais que o resto: no próximo passo você vê linha
                a linha o que é novo, o que já está no sistema e o que está divergente — e decide se
                o extrato regrava por cima.
              </p>
            </div>
          )}

          {/* PASSO 2 a 4 — conferência */}
          {passo === "conferencia" && preview && (
            /* gap-3 no celular: cada respiro de 16px vale 4px de dado a mais. */
            <div className="flex flex-col gap-3 sm:gap-4">
              {/*
                No celular a primeira dobra tem ~590px. A grade 2x2 de KPIs comia
                metade dela e empurrava a primeira linha do extrato para fora da
                tela — o usuário decidia sobre dinheiro sem ver uma linha sequer.
                Abaixo de sm o veredito vira UMA faixa de texto; a grade volta
                inteira a partir de sm, onde há altura de sobra.
              */}
              <FaixaVeredito contagem={contagem} className="sm:hidden" />

              {/*
                LINHA SUMIDA vem antes de tudo: é a única falha aqui que faz o
                usuário decidir sobre um extrato que não é o extrato dele.
              */}
              {(balPreview.naoLidas > 0 || !balPreview.fecha) && (
                <AvisoLinhasPerdidas
                  bal={balPreview}
                  fechamento={fechamento}
                  format={format}
                  aoVerLinhas={() => {
                    setFiltro(balPreview.naoLidas > 0 ? "nao-lida" : "todas");
                    setBusca("");
                  }}
                />
              )}

              {/*
                Fechamento não bateu: urgente, sobe para a primeira dobra — mas
                só quando é notícia. Com linha não lida o arquivo NÃO fecha por
                causa dela: dois alertas vermelhos empilhados para uma causa só
                custam 63px da dobra e ainda fazem o leitor procurar duas coisas.
              */}
              {fechamento && !fechamento.bate && balPreview.naoLidas === 0 && (
                <AvisoFechamento f={fechamento} format={format} />
              )}

              {/*
                ARQUIVO SEM TRANSAÇÃO NENHUMA. Antes isto virava "0 linhas do
                arquivo = 0 + 0 + 0…" com selo verde de conta fechada: um
                arquivo do qual não dá para importar nada aparecia como sucesso.
                Zero linha não é sucesso — é aviso.
              */}
              {balPreview.linhasLidas === 0 && <AvisoSemTransacoes ancoraValida={ancoraValida} />}

              {/*
                CONTA ATIVA — a decisão que o import tomava sozinha. Qualquer
                arquivo desativava a conta real e ativava a do arquivo; o painel
                perdia o saldo e a tela de resultado ainda dizia que nada tinha
                mudado. Agora quem decide é quem está lendo.
              */}
              {preview.contaAtiva && !preview.contaAtiva.mesmaDoArquivo && (
                <EscolhaContaAtiva
                  contaAtiva={preview.contaAtiva}
                  contaArquivo={{
                    nome: preview.conta?.nomeSugerido ?? "",
                    agencia: preview.conta?.agencia ?? "",
                    conta: preview.conta?.conta ?? "",
                    existe: !!preview.conta?.existenteId,
                  }}
                  decisao={decisaoConta}
                  onDecidir={setDecisaoConta}
                />
              )}

              {/* Servidor pediu a decisão (preview antigo, sem `contaAtiva`). */}
              {pergunta && (
                <PerguntaContaAtiva
                  pergunta={pergunta}
                  onResponder={(d) => {
                    setDecisaoConta(d);
                    setPergunta(null);
                  }}
                />
              )}

              {/* O que decide vem primeiro. Tom de alerta só quando há o que alertar. */}
              <div
                className={`hidden grid-cols-2 gap-3 sm:grid ${
                  contagem.naoLida > 0 ? "lg:grid-cols-5" : "lg:grid-cols-4"
                }`}
              >
                {contagem.naoLida > 0 && (
                  <KpiCard
                    count={contagem.naoLida}
                    label="Não lidas"
                    tone="vermelho"
                    hint="O sistema não entendeu estas linhas"
                  />
                )}
                <KpiCard
                  count={contagem.nova}
                  label="Novas"
                  valor={comSinal(liquidoPorSituacao.nova, format)}
                  tone={contagem.nova > 0 ? "accent" : "neutro"}
                  hint="Efeito no caixa se entrarem"
                />
                <KpiCard
                  count={contagem.duplicada}
                  label="Duplicadas"
                  valor={comSinal(liquidoPorSituacao.duplicada, format)}
                  hint="Já estão no sistema · líquido"
                />
                <KpiCard
                  count={contagem.conflito}
                  label="Conflitos"
                  valor={comSinal(liquidoPorSituacao.conflito, format)}
                  tone={contagem.conflito > 0 ? "ambar" : "neutro"}
                  hint={
                    contagem.conflito > 0
                      ? "Mesma transação, dados diferentes"
                      : "Nada divergente do sistema"
                  }
                />
                {/*
                  Sem valor: a soma das descartadas era o SALDO DE ABERTURA, e
                  saldo não é dinheiro movimentado. Exibi-lo no mesmo slot das
                  somas de movimento fazia ler um estoque como fluxo. O saldo de
                  abertura tem lugar próprio, em "Ver detalhes".
                */}
                <KpiCard
                  count={contagem.ignorada}
                  label="Descartadas"
                  hint="Saldo anterior e não realizadas — não são movimentação"
                />
              </div>

              {/* Metadados do arquivo: uma linha discreta, detalhes sob demanda. */}
              <details className="group rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
                {/*
                  No celular só o essencial fica na linha (nome da conta + o sinal
                  de fechamento); formato e período moram dentro do "Ver detalhes".
                  Uma linha em vez de três devolve ~70px à primeira dobra.
                */}
                <summary className="flex min-h-11 cursor-pointer list-none items-center gap-x-2 gap-y-1 px-3 py-2.5 text-xs text-[var(--text-muted)] max-sm:flex-nowrap sm:pointer-fine:min-h-0 sm:flex-wrap [&::-webkit-details-marker]:hidden">
                  <FileText size={13} aria-hidden className="shrink-0" />
                  <span className="truncate text-[var(--text)]">
                    {preview.conta?.nomeSugerido || "—"}
                  </span>
                  {preview.conta?.existenteId ? null : (
                    <span className="shrink-0 text-[var(--accent-text)]">(conta nova)</span>
                  )}
                  <span aria-hidden className="hidden sm:inline">
                    ·
                  </span>
                  <span className="hidden sm:inline">
                    {ROTULO_FORMATO[preview.arquivo?.formato] ?? preview.arquivo?.formato ?? "—"}
                  </span>
                  {preview.periodo?.de && preview.periodo?.ate && (
                    <>
                      <span aria-hidden className="hidden sm:inline">
                        ·
                      </span>
                      <span className="tabular-nums hidden sm:inline">
                        {formatDateBR(preview.periodo.de)} → {formatDateBR(preview.periodo.ate)}
                      </span>
                    </>
                  )}
                  {/* Fechamento OK: um selo discreto aqui; o detalhe fica lá dentro. */}
                  {fechamento?.bate && (
                    <span
                      className="ml-1 inline-flex shrink-0 items-center gap-1 whitespace-nowrap"
                      style={{ color: "var(--green)" }}
                      title="A soma das linhas bate com a variação de saldo do arquivo"
                    >
                      <Check size={12} aria-hidden />
                      Confere
                    </span>
                  )}
                  <span className="ml-auto inline-flex shrink-0 items-center gap-1 whitespace-nowrap">
                    Ver detalhes
                    <ChevronDown
                      size={13}
                      aria-hidden
                      className="transition-transform group-open:rotate-180"
                    />
                  </span>
                </summary>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-[var(--border)] px-3 py-3 text-sm sm:grid-cols-3">
                  <Dado rotulo="Formato" className="sm:hidden">
                    {ROTULO_FORMATO[preview.arquivo?.formato] ?? preview.arquivo?.formato ?? "—"}
                  </Dado>
                  {preview.periodo?.de && preview.periodo?.ate && (
                    <Dado rotulo="Período" className="sm:hidden">
                      <span className="tabular-nums">
                        {formatDateBR(preview.periodo.de)} → {formatDateBR(preview.periodo.ate)}
                      </span>
                    </Dado>
                  )}
                  <Dado rotulo="Titular">{preview.conta?.titular || "—"}</Dado>
                  <Dado rotulo="Agência / conta">
                    <span className="tabular-nums">
                      {preview.conta?.agencia || "—"} / {preview.conta?.conta || "—"}
                    </span>
                  </Dado>
                  <Dado rotulo="Saldo de abertura">
                    {preview.saldoInicial?.valor != null ? (
                      <span className="tabular-nums">
                        {format(preview.saldoInicial.valor)}
                        {preview.saldoInicial.data && (
                          <span className="ml-1 text-xs text-[var(--text-muted)]">
                            em {formatDateBR(preview.saldoInicial.data)}
                          </span>
                        )}
                      </span>
                    ) : (
                      "—"
                    )}
                  </Dado>
                  <Dado rotulo="Saldo do arquivo">
                    {preview.saldoExtrato?.valor != null ? (
                      <span className="tabular-nums">
                        {format(preview.saldoExtrato.valor)}
                        {preview.saldoExtrato.data && (
                          <span className="ml-1 text-xs text-[var(--text-muted)]">
                            em {formatDateBR(preview.saldoExtrato.data)}
                          </span>
                        )}
                      </span>
                    ) : (
                      "—"
                    )}
                  </Dado>
                  <Dado rotulo="Créditos">
                    <span className="tabular-nums text-[var(--green)]">
                      {preview.totais?.creditos?.n ?? 0} · {format(preview.totais?.creditos?.soma ?? 0)}
                    </span>
                  </Dado>
                  <Dado rotulo="Débitos">
                    <span className="tabular-nums text-[var(--red-text)]">
                      {preview.totais?.debitos?.n ?? 0} · {format(preview.totais?.debitos?.soma ?? 0)}
                    </span>
                  </Dado>
                  {/* Balanço das linhas: nenhuma linha lida pode sumir da conta. */}
                  <div className="col-span-full border-t border-[var(--border)] pt-3">
                    <dt className="text-xs text-[var(--text-muted)]">Balanço das linhas</dt>
                    <dd className="mt-0.5">
                      <BalancoLinhas
                        total={balPreview.linhasLidas}
                        partes={[
                          { n: balPreview.novas, rotulo: plural(balPreview.novas, "nova", "novas") },
                          {
                            n: balPreview.conflitos,
                            rotulo: plural(balPreview.conflitos, "conflito", "conflitos"),
                          },
                          { n: balPreview.jaNoSistema, rotulo: "já no sistema" },
                          {
                            n: balPreview.descartadas,
                            rotulo: plural(balPreview.descartadas, "descartada", "descartadas"),
                          },
                          {
                            n: balPreview.naoLidas,
                            rotulo: plural(balPreview.naoLidas, "não lida", "não lidas"),
                            alerta: true,
                          },
                        ]}
                        sobra={balPreview.naoClassificadas}
                      />
                    </dd>
                  </div>

                  {/*
                    `preview.erros` existia na API e não era exibido em canto
                    nenhum: o usuário não tinha como saber QUAL linha o sistema
                    não entendeu. Aqui vai a lista inteira, com o número da linha.
                  */}
                  {(preview.erros?.length ?? 0) > 0 && (
                    <div className="col-span-full border-t border-[var(--border)] pt-3">
                      <dt className="text-xs text-[var(--text-muted)]">
                        Linhas que o leitor não entendeu
                      </dt>
                      <dd className="mt-1">
                        <ul className="space-y-1">
                          {preview.erros.map((e, i) => (
                            <li
                              key={`erro-${i}`}
                              className="text-[13px] leading-relaxed break-words"
                              style={{ color: "var(--red-text)" }}
                            >
                              {e}
                            </li>
                          ))}
                        </ul>
                      </dd>
                    </div>
                  )}

                  {fechamento && (
                    <div className="col-span-full border-t border-[var(--border)] pt-3">
                      <dt className="text-xs text-[var(--text-muted)]">Fechamento do arquivo</dt>
                      <dd
                        className="mt-0.5 text-xs leading-relaxed"
                        style={{ color: fechamento.bate ? "var(--green)" : "var(--red-text)" }}
                      >
                        <span className="tabular-nums">
                          {format(preview.totais?.creditos?.soma ?? 0)} −{" "}
                          {format(preview.totais?.debitos?.soma ?? 0)} ={" "}
                          {format(fechamento.movimento)}
                        </span>
                        {fechamento.bate ? " — e o saldo do arquivo variou " : " — mas o saldo do arquivo variou "}
                        <span className="tabular-nums">{format(fechamento.variacao)}</span>
                        {fechamento.bate ? ". Confere." : "."}
                        <span className="mt-0.5 block text-[var(--text-muted)]">
                          De <span className="tabular-nums">{format(fechamento.saldoInicial)}</span>{" "}
                          a <span className="tabular-nums">{format(fechamento.saldoFinal)}</span>.
                          {fechamento.bate
                            ? " Nenhuma linha ficou de fora."
                            : ` Faltam ${format(Math.abs(fechamento.diferenca))} para fechar.`}
                        </span>
                      </dd>
                    </div>
                  )}
                </dl>
              </details>

              {/* Linhas — uma superfície rolante só (o corpo do modal). */}
              <div className="min-w-0 rounded-xl border border-[var(--border)] bg-[var(--bg-card)]">
                <div className="flex min-w-0 flex-col gap-2 border-b border-[var(--border)] p-3 sm:flex-row sm:items-center sm:gap-3">
                  {/*
                    flex-nowrap: no celular os chips rolam na horizontal em UMA
                    fileira em vez de quebrar em três. E a contagem some no
                    celular porque a faixa-veredito acima já traz os mesmos números.
                  */}
                  {/*
                    No celular o trilho só carrega as categorias que EXISTEM
                    neste arquivo: chip de contagem zero é trilho gasto para
                    empurrar para fora da tela o chip que importa.
                  */}
                  <FilterChips
                    opcoes={opcoesFiltroMobile}
                    valor={filtro}
                    onChange={(id) => setFiltro(id as "todas" | SituacaoLinha)}
                    ariaLabel="Filtrar linhas do extrato"
                    className="min-w-0 flex-1 flex-nowrap sm:hidden"
                    contagemSoNoDesktop
                    legivel
                  />
                  <FilterChips
                    opcoes={opcoesFiltro}
                    valor={filtro}
                    onChange={(id) => setFiltro(id as "todas" | SituacaoLinha)}
                    ariaLabel="Filtrar linhas do extrato"
                    className="hidden min-w-0 flex-1 flex-nowrap sm:flex"
                    legivel
                  />
                  <Busca
                    valor={busca}
                    onChange={setBusca}
                    placeholder="Buscar histórico ou documento…"
                    className="w-full sm:w-64 sm:shrink-0"
                  />
                </div>

                {visiveis.length === 0 ? (
                  <div className="p-4">
                    <EmptyState
                      titulo="Nenhuma linha neste filtro"
                      descricao="Troque o filtro ou limpe a busca para ver as outras linhas do extrato."
                    />
                  </div>
                ) : (
                  <>
                    {/*
                      MOBILE: cartões. Sem tabela, sem rolagem horizontal.
                      O "marcar todas" só existe quando há algo para marcar: um alvo
                      de 44px para marcar zero item é controle morto.
                    */}
                    {selecionaveisVisiveis.length > 0 && (
                      <label className="flex min-h-11 items-center gap-2 border-b border-[var(--border)] px-3 py-2 text-xs text-[var(--text-muted)] sm:hidden">
                        <input
                          ref={selectAllMobileRef}
                          type="checkbox"
                          className="size-5 shrink-0"
                          checked={todasVisiveisMarcadas}
                          onChange={alternarTodasVisiveis}
                        />
                        {selecionaveisVisiveis.length === 1
                          ? "Marcar a linha que pode entrar"
                          : `Marcar as ${selecionaveisVisiveis.length} linhas que podem entrar`}
                      </label>
                    )}
                    <ul className="divide-y divide-[var(--border)] sm:hidden">
                      {visiveis.map((l) => {
                        const podeSelecionar = selecionavelNoModo(l, modo);
                        // Só fica marcada a linha cuja marca decide alguma coisa AGORA.
                        const marcada = podeSelecionar && selecionadas.has(l.dedupKey);
                        const inerteNoModo = l.situacao === "conflito" && !podeSelecionar;
                        return (
                          <li
                            key={`m-${l.idx}-${l.dedupKey}`}
                            className="p-3"
                            style={
                              l.situacao === "conflito"
                                ? {
                                    backgroundColor:
                                      "color-mix(in srgb, var(--amber) 6%, transparent)",
                                  }
                                : l.situacao === "nao-lida"
                                  ? {
                                      backgroundColor:
                                        "color-mix(in srgb, var(--red) 6%, transparent)",
                                    }
                                  : l.situacao === "ignorada"
                                    ? { opacity: 0.65 }
                                    : undefined
                            }
                          >
                            <div className="flex items-start gap-1">
                              {/*
                                Alvo de 44x44 (WCAG 2.5.5) com margem negativa para
                                não inchar o cartão. Isto era um <span>: os 44px
                                eram desenho, não alvo — só os 20px do próprio
                                checkbox aceitavam o toque. Como <label>, a área
                                inteira marca a linha.
                              */}
                              <label className="-my-1.5 -ml-1.5 grid size-11 shrink-0 cursor-pointer place-items-center">
                                <input
                                  type="checkbox"
                                  className="size-5"
                                  checked={marcada}
                                  disabled={!podeSelecionar}
                                  onChange={() => alternar(l.dedupKey)}
                                  aria-label={`Selecionar ${l.historico}`}
                                />
                              </label>
                              <div className="min-w-0 flex-1">
                                <div className="flex items-start justify-between gap-2">
                                  <p className="min-w-0 break-words text-sm text-[var(--text)]">
                                    {l.historico || "—"}
                                  </p>
                                  <span
                                    className={`tabular-nums shrink-0 text-sm ${
                                      l.tipo === "C"
                                        ? "text-[var(--green)]"
                                        : l.tipo === "D"
                                          ? "text-[var(--red-text)]"
                                          : "text-[var(--text-muted)]"
                                    }`}
                                  >
                                    {l.valor == null
                                      ? "—"
                                      : `${l.tipo === "C" ? "+" : l.tipo === "D" ? "−" : ""}${format(
                                          Math.abs(Number(l.valor) || 0),
                                        )}`}
                                  </span>
                                </div>
                                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--text-muted)]">
                                  <span className="tabular-nums">
                                    {l.data
                                      ? formatDateBR(l.data)
                                      : l.situacao === "nao-lida" && l.linhaArquivo
                                        ? `linha ${l.linhaArquivo}`
                                        : "—"}
                                  </span>
                                  {l.documento && (
                                    <>
                                      <span aria-hidden>·</span>
                                      <span className="tabular-nums break-all">{l.documento}</span>
                                    </>
                                  )}
                                  {l.categoria && (
                                    <>
                                      <span aria-hidden>·</span>
                                      <span className="break-words">{l.categoria}</span>
                                    </>
                                  )}
                                  <Chip tone={TONE_SITUACAO[l.situacao]} legivel>
                                    {ROTULO_SITUACAO[l.situacao]}
                                  </Chip>
                                </div>
                                <DetalhesLinha l={l} format={format} diffTexto={diffTexto} inerteNoModo={inerteNoModo} />
                              </div>
                            </div>
                          </li>
                        );
                      })}
                    </ul>

                    {/* DESKTOP: tabela. */}
                    <table className="hidden w-full border-collapse text-sm sm:table">
                      <thead className="sticky top-0 z-10 bg-[var(--bg-card)] text-left text-xs text-[var(--text-muted)]">
                        <tr className="border-b border-[var(--border)]">
                          <th scope="col" className="w-9 p-2 pl-3">
                            {/* Nada selecionável neste filtro: sem caixa, em vez de caixa morta. */}
                            {selecionaveisVisiveis.length > 0 && (
                              /*
                                A tabela aparece a partir de sm — e sm inclui
                                tablet, que é dedo. O alvo cresce para 44px em
                                ponteiro grosso com margem negativa: a coluna
                                continua ocupando os mesmos 16px de layout.
                              */
                              <label className="-m-1.5 grid size-7 cursor-pointer place-items-center pointer-coarse:-m-3.5 pointer-coarse:size-11">
                                <input
                                  ref={selectAllRef}
                                  type="checkbox"
                                  className="size-4"
                                  checked={todasVisiveisMarcadas}
                                  onChange={alternarTodasVisiveis}
                                  aria-label={
                                    selecionaveisVisiveis.length === 1
                                      ? "Marcar a linha que pode entrar"
                                      : `Marcar as ${selecionaveisVisiveis.length} linhas que podem entrar`
                                  }
                                />
                              </label>
                            )}
                          </th>
                          <th scope="col" className="whitespace-nowrap p-2 font-medium">
                            Data
                          </th>
                          <th scope="col" className="p-2 font-medium">
                            Histórico
                          </th>
                          <th scope="col" className="whitespace-nowrap p-2 font-medium">
                            Documento
                          </th>
                          <th scope="col" className="whitespace-nowrap p-2 text-right font-medium">
                            Valor
                          </th>
                          <th scope="col" className="whitespace-nowrap p-2 pr-3 font-medium">
                            Situação
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {visiveis.map((l) => {
                          const podeSelecionar = selecionavelNoModo(l, modo);
                          // Só fica marcada a linha cuja marca decide alguma coisa AGORA.
                          const marcada = podeSelecionar && selecionadas.has(l.dedupKey);
                          const inerteNoModo = l.situacao === "conflito" && !podeSelecionar;
                          return (
                            <tr
                              key={`${l.idx}-${l.dedupKey}`}
                              className="border-b border-[var(--border)] align-top last:border-0"
                              style={
                                l.situacao === "conflito"
                                  ? {
                                      backgroundColor:
                                        "color-mix(in srgb, var(--amber) 6%, transparent)",
                                    }
                                  : l.situacao === "nao-lida"
                                    ? {
                                        backgroundColor:
                                          "color-mix(in srgb, var(--red) 6%, transparent)",
                                      }
                                    : l.situacao === "ignorada"
                                      ? { opacity: 0.65 }
                                      : undefined
                              }
                            >
                              <td className="p-2 pl-3">
                                <label className="-m-1.5 grid size-7 cursor-pointer place-items-center pointer-coarse:-m-3.5 pointer-coarse:size-11">
                                  <input
                                    type="checkbox"
                                    className="size-4"
                                    checked={marcada}
                                    disabled={!podeSelecionar}
                                    onChange={() => alternar(l.dedupKey)}
                                    aria-label={`Selecionar ${l.historico}`}
                                  />
                                </label>
                              </td>
                              <td className="tabular-nums whitespace-nowrap p-2 text-[var(--text)]">
                                {l.data
                                  ? formatDateBR(l.data)
                                  : l.situacao === "nao-lida" && l.linhaArquivo
                                    ? `linha ${l.linhaArquivo}`
                                    : "—"}
                              </td>
                              <td className="min-w-[14rem] p-2">
                                <p className="text-[var(--text)]">{l.historico || "—"}</p>
                                {l.categoria && (
                                  <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                                    {l.categoria}
                                  </p>
                                )}
                                <DetalhesLinha l={l} format={format} diffTexto={diffTexto} inerteNoModo={inerteNoModo} />
                              </td>
                              <td className="tabular-nums whitespace-nowrap p-2 text-xs text-[var(--text-muted)]">
                                {l.documento || "—"}
                              </td>
                              <td
                                className={`tabular-nums whitespace-nowrap p-2 text-right ${
                                  l.tipo === "C"
                                    ? "text-[var(--green)]"
                                    : l.tipo === "D"
                                      ? "text-[var(--red-text)]"
                                      : "text-[var(--text-muted)]"
                                }`}
                              >
                                {l.valor == null
                                  ? "—"
                                  : `${l.tipo === "C" ? "+" : l.tipo === "D" ? "−" : ""}${format(
                                      Math.abs(Number(l.valor) || 0),
                                    )}`}
                              </td>
                              <td className="whitespace-nowrap p-2 pr-3">
                                <Chip tone={TONE_SITUACAO[l.situacao]} legivel>
                                  {ROTULO_SITUACAO[l.situacao]}
                                </Chip>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </>
                )}
              </div>

              {/* Confirmar: modo + âncora */}
              <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
                <h3 className="mb-3 text-sm font-medium text-[var(--text)]">Como gravar</h3>

                <div className="flex flex-col gap-2">
                  <OpcaoModo
                    id="modo-novas"
                    marcada={modo === "somente-novas"}
                    onSelect={() => setModo("somente-novas")}
                    titulo="Somente novas"
                    descricao={descricaoSomenteNovas}
                  />
                  <OpcaoModo
                    id="modo-sobrescrever"
                    marcada={modo === "sobrescrever"}
                    onSelect={() => setModo("sobrescrever")}
                    titulo="Sobrescrever com o extrato"
                    destaque
                    descricao={descricaoSobrescrever}
                  />
                </div>

                {modo === "sobrescrever" && totalVinculosDivergentes > 0 && (
                  <label
                    htmlFor="extrato-aplicar-vinculos"
                    className="mt-3 flex min-h-11 cursor-pointer items-start gap-2 text-sm text-[var(--text)] pointer-fine:min-h-0"
                  >
                    <input
                      id="extrato-aplicar-vinculos"
                      name="extrato-aplicar-vinculos"
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 pointer-coarse:size-5"
                      checked={aplicarVinculos}
                      onChange={(e) => setAplicarVinculos(e.target.checked)}
                    />
                    <span>
                      Corrigir também os lançamentos manuais vinculados
                      <span className="ml-1 text-xs text-[var(--text-muted)]">
                        ({totalVinculosDivergentes} conta a pagar / receita{" "}
                        {plural(totalVinculosDivergentes, "divergente", "divergentes")} do extrato —{" "}
                        {vinculosMarcados} {plural(vinculosMarcados, "marcada", "marcadas")})
                      </span>
                    </span>
                  </label>
                )}

                <div className="mt-4 border-t border-[var(--border)] pt-3">
                  <label
                    htmlFor="extrato-usar-ancora"
                    className="flex min-h-11 cursor-pointer items-start gap-2 text-sm text-[var(--text)] pointer-fine:min-h-0"
                  >
                    <input
                      id="extrato-usar-ancora"
                      name="extrato-usar-ancora"
                      type="checkbox"
                      className="mt-0.5 size-4 shrink-0 pointer-coarse:size-5"
                      checked={usarAncora}
                      onChange={(e) => setUsarAncora(e.target.checked)}
                    />
                    <span>
                      Gravar o saldo do arquivo como âncora do saldo real
                      <span className="ml-1 text-xs text-[var(--text-muted)]">
                        (é a partir dele que o fluxo calcula o saldo de hoje)
                      </span>
                    </span>
                  </label>
                  <div className="mt-2 flex flex-wrap items-end gap-3 sm:pl-6">
                    <label
                      htmlFor="extrato-ancora-data"
                      className="flex flex-col gap-1 text-xs text-[var(--text-muted)]"
                    >
                      Data do saldo
                      <input
                        id="extrato-ancora-data"
                        name="extrato-ancora-data"
                        type="date"
                        disabled={!usarAncora}
                        value={ancora.data}
                        onChange={(e) => setAncora((a) => ({ ...a, data: e.target.value }))}
                        className="min-h-11 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)] focus:border-[var(--accent-strong)] disabled:opacity-50 sm:pointer-fine:min-h-0"
                      />
                    </label>
                    <label
                      htmlFor="extrato-ancora-valor"
                      className="flex flex-col gap-1 text-xs text-[var(--text-muted)]"
                    >
                      Valor do saldo (R$)
                      <InputDecimalBr
                        id="extrato-ancora-valor"
                        name="extrato-ancora-valor"
                        placeholder="Ex.: 1.234,56"
                        aria-describedby="extrato-ancora-valor-erro"
                        aria-invalid={!!erroAncora}
                        disabled={!usarAncora}
                        value={ancora.valor}
                        onChange={(valor) => setAncora((a) => ({ ...a, valor }))}
                        className="tabular-nums min-h-11 w-36 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-2 py-1.5 text-sm text-[var(--text)] focus:border-[var(--accent-strong)] disabled:opacity-50 sm:pointer-fine:min-h-0"
                      />
                    </label>
                  </div>
                  {erroAncora && (
                    <p
                      id="extrato-ancora-valor-erro"
                      className="mt-2 text-xs text-[var(--red-text)] sm:pl-6"
                    >
                      {erroAncora}
                    </p>
                  )}
                  <p className="mt-2 text-xs text-[var(--text-muted)] sm:pl-6">
                    {!usarAncora
                      ? "O saldo de referência da conta fica como está."
                      : ancoraValida
                        ? totalLinhas === 0
                          ? `Grava sozinho: o saldo vira ${format(valorAncoraNum)} em ${formatDateBR(ancora.data)}, mesmo sem nenhuma linha a inserir.`
                          : `Junto com as linhas, o saldo vira ${format(valorAncoraNum)} em ${formatDateBR(ancora.data)}.`
                        : "Informe data e valor para gravar a âncora."}
                  </p>
                </div>
              </div>

              {erro && <CaixaErro texto={erro} />}
            </div>
          )}

          {/* PASSO 5 — resultado */}
          {passo === "resultado" && resultado && (
            <div className="flex flex-col gap-4">
              <div className="flex items-center gap-3">
                <span
                  className="grid size-10 shrink-0 place-items-center rounded-full text-[var(--accent-text)]"
                  style={{ backgroundColor: "color-mix(in srgb, var(--accent) 12%, transparent)" }}
                  aria-hidden
                >
                  <Check size={20} />
                </span>
                <div>
                  <p className="text-sm font-medium text-[var(--text)]">
                    {resultado.inseridas + resultado.atualizadas + resultado.vinculosAtualizados ===
                    0
                      ? "Saldo gravado"
                      : "Extrato importado"}
                  </p>
                  <p className="text-xs text-[var(--text-muted)]">
                    {/* O nome sugerido já costuma começar com "Conta 21865663": nada de "Conta Conta". */}
                    {resultado.conta?.nome
                      ? `${/^conta\b/i.test(resultado.conta.nome.trim()) ? "" : "Conta "}${resultado.conta.nome} · `
                      : ""}
                    {preview?.arquivo?.nome ?? arquivo?.name}
                  </p>
                </div>
              </div>

              {/*
                Uma categoria por destino da linha, com nome que não colide com
                o do preview: "Descartadas" é sempre o que o leitor pulou, e o
                que já estava gravado se chama "Já estavam no sistema".
              */}
              {balResultado && (
                <>
                  <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                    <ResultadoStat
                      icone={<Sparkles size={14} />}
                      rotulo="Inseridas"
                      valor={balResultado.inseridas}
                      tone="accent"
                      hint="Linhas novas gravadas"
                    />
                    <ResultadoStat
                      icone={<AlertTriangle size={14} />}
                      rotulo="Regravadas"
                      valor={balResultado.regravadas}
                      tone="ambar"
                      hint="Divergentes corrigidas pelo extrato"
                    />
                    <ResultadoStat
                      icone={<Copy size={14} />}
                      rotulo="Já estavam no sistema"
                      valor={balResultado.jaNoSistema}
                      hint="Nada foi gravado de novo"
                    />
                    <ResultadoStat
                      icone={<CircleSlash size={14} />}
                      rotulo="Descartadas"
                      valor={balResultado.descartadas}
                      hint="O leitor pulou: saldo anterior, não realizadas"
                    />
                    {balResultado.foraDaSelecao !== 0 && (
                      <ResultadoStat
                        icone={<CircleSlash size={14} />}
                        rotulo="Deixadas de fora"
                        valor={balResultado.foraDaSelecao}
                        hint="Linhas novas que não estavam marcadas"
                      />
                    )}
                    {balResultado.naoLidas > 0 && (
                      <ResultadoStat
                        icone={<AlertTriangle size={14} />}
                        rotulo="Não lidas"
                        valor={balResultado.naoLidas}
                        tone="vermelho"
                        hint="O sistema não entendeu — ficaram fora do extrato"
                      />
                    )}
                    {resultado.vinculosAtualizados > 0 && (
                      <ResultadoStat
                        icone={<Link2 size={14} />}
                        rotulo="Vínculos corrigidos"
                        valor={resultado.vinculosAtualizados}
                        tone="accent"
                        hint="Contas a pagar / receitas — fora do balanço de linhas"
                      />
                    )}
                  </div>

                  {/*
                    Balanço com os números QUE O SERVIDOR DEVOLVEU. Se eles não
                    fecharem contra as linhas do arquivo, `sobra` acusa em
                    vermelho — antes o cliente recalculava tudo a partir do
                    preview e a conta fechava sozinha, dissesse o servidor o que
                    dissesse.
                  */}
                  <BalancoLinhas
                    total={balResultado.linhasLidas}
                    partes={[
                      {
                        n: balResultado.inseridas,
                        rotulo: plural(balResultado.inseridas, "inserida", "inseridas"),
                      },
                      {
                        n: balResultado.regravadas,
                        rotulo: plural(balResultado.regravadas, "regravada", "regravadas"),
                      },
                      { n: balResultado.jaNoSistema, rotulo: "já no sistema" },
                      ...(balResultado.foraDaSelecao !== 0
                        ? [{ n: balResultado.foraDaSelecao, rotulo: "fora da seleção" }]
                        : []),
                      {
                        n: balResultado.descartadas,
                        rotulo: plural(balResultado.descartadas, "descartada", "descartadas"),
                      },
                      ...(balResultado.naoLidas !== 0
                        ? [
                            {
                              n: balResultado.naoLidas,
                              rotulo: plural(balResultado.naoLidas, "não lida", "não lidas"),
                              alerta: true,
                            },
                          ]
                        : []),
                    ]}
                    sobra={balResultado.naoClassificadas}
                  />
                </>
              )}

              {/*
                "Nenhum lançamento que já estava no sistema foi alterado" era
                dito mesmo quando o import havia TROCADO A CONTA ATIVA e o
                painel tinha perdido o saldo real. Verdade sobre as linhas,
                mentira sobre o sistema — a pior combinação possível: perda de
                estado com mensagem de que nada mudou. A frase agora só fala das
                linhas, e o que mudou fora delas vem listado logo abaixo.
              */}
              <p className="text-xs leading-relaxed text-[var(--text-muted)]">
                {(balResultado?.regravadas ?? 0) > 0
                  ? `${balResultado!.regravadas} ${plural(balResultado!.regravadas, "lançamento divergente foi regravado", "lançamentos divergentes foram regravados")} com a data, o valor e o histórico do extrato — o extrato tem prioridade sobre o que estava no sistema.`
                  : "Nenhuma linha que já estava no sistema foi alterada."}
              </p>

              <MudancasForaDasLinhas
                mudancas={resultado.mudancas ?? null}
                ancora={resultado.ancora ?? null}
                contaDoArquivo={resultado.conta?.nome ?? null}
                format={format}
              />
            </div>
          )}
        </div>

        {/* Rodapé */}
        <div className="flex flex-wrap items-center justify-end gap-2 border-t border-[var(--border)] px-4 py-3 sm:px-5">
          {passo === "conferencia" && (
            <p className="flex w-full flex-wrap items-center gap-x-1.5 text-xs text-[var(--text-muted)] sm:mr-auto sm:w-auto">
              <span>
                <span className="tabular-nums font-medium text-[var(--text)]">{qtdInserir}</span> a
                inserir
              </span>
              {modo === "sobrescrever" && (
                <span>
                  <span aria-hidden>·</span>{" "}
                  <span className="tabular-nums font-medium" style={{ color: "var(--amber)" }}>
                    {qtdAtualizar}
                  </span>{" "}
                  a corrigir
                </span>
              )}
              {ancoraValida && (
                <span className="inline-flex items-center gap-1">
                  <span aria-hidden>·</span>
                  <Wallet size={12} aria-hidden />
                  saldo {format(valorAncoraNum)}
                </span>
              )}
            </p>
          )}

          {passo === "resultado" ? (
            <>
              <button
                type="button"
                onClick={recomecar}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg-card)] sm:pointer-fine:min-h-0 sm:flex-none"
              >
                Importar outro arquivo
              </button>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg px-4 py-2 text-sm text-[var(--on-accent)] sm:pointer-fine:min-h-0 sm:flex-none"
                style={{ backgroundColor: "var(--accent)" }}
              >
                Concluir
              </button>
            </>
          ) : (
            <>
              <button
                type="button"
                onClick={onClose}
                className="inline-flex min-h-11 flex-1 items-center justify-center rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg-card)] sm:pointer-fine:min-h-0 sm:flex-none"
              >
                Cancelar
              </button>
              <button
                type="button"
                disabled={passo !== "conferencia" || importando || !podeConfirmar}
                onClick={() => void importar()}
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-lg px-4 py-2 text-sm text-[var(--on-accent)] disabled:opacity-50 sm:pointer-fine:min-h-0 sm:flex-none"
                style={{ backgroundColor: "var(--accent)" }}
              >
                {importando && <Loader2 size={14} aria-hidden className="animate-spin" />}
                {importando ? "Gravando…" : passo === "conferencia" ? rotuloConfirmar : "Importar"}
              </button>
            </>
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/* ------------------------------------------------------------------ */
/* Subcomponentes                                                      */
/* ------------------------------------------------------------------ */

/** Diffs de um lado: "campo: de → para". */
function ListaDiffs({
  itens,
  prefixo,
  diffTexto,
}: {
  itens: DiffCampo[];
  prefixo: string;
  diffTexto: (campo: string, v: string) => string;
}) {
  return (
    <ul className="mt-1 space-y-0.5">
      {itens.map((df, i) => (
        <li
          key={`${prefixo}-${df.campo}-${i}`}
          className="flex flex-wrap items-center gap-1 text-[13px]"
        >
          <span className="text-[var(--text-muted)]">{ROTULO_CAMPO[df.campo] ?? df.campo}:</span>
          <span className="tabular-nums text-[var(--text-muted)] line-through">
            {diffTexto(df.campo, df.de)}
          </span>
          <ArrowRight size={11} aria-hidden className="text-[var(--text-muted)]" />
          <span className="tabular-nums font-medium text-[var(--text)]">
            {diffTexto(df.campo, df.para)}
          </span>
        </li>
      ))}
    </ul>
  );
}

/**
 * Motivo + diffs de uma linha. Rótulo e conteúdo têm que bater: uma linha
 * "Duplicada" nunca mostra diff, e um conflito sem diff de movimentação diz
 * que a divergência está no lançamento vinculado.
 */
function DetalhesLinha({
  l,
  format,
  diffTexto,
  inerteNoModo,
}: {
  l: LinhaPreview;
  format: (n: number) => string;
  diffTexto: (campo: string, v: string) => string;
  /** Conflito no modo "Somente novas": a caixa está desligada e a linha diz por quê. */
  inerteNoModo?: boolean;
}) {
  const diffs = l.diffs ?? [];
  const diffsVinculo = l.vinculo?.diffs ?? [];

  return (
    <>
      {inerteNoModo && (
        <p className="mt-1 flex items-start gap-1 text-[13px] text-[var(--text-muted)]">
          <CircleSlash size={13} aria-hidden className="mt-0.5 shrink-0" />
          Não dá para marcar em “Somente novas”: esta linha fica como está no sistema. Escolha
          “Sobrescrever com o extrato”, em Como gravar, para o extrato valer por cima.
        </p>
      )}
      {l.situacao === "nao-lida" && (
        <p
          className="mt-1 flex items-start gap-1 text-[13px] leading-relaxed"
          style={{ color: "var(--red-text)" }}
        >
          <AlertTriangle size={13} aria-hidden className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">
            O sistema não conseguiu ler esta linha: {l.motivo} Ela não entra no extrato — confira o
            arquivo no aplicativo do banco antes de gravar.
          </span>
        </p>
      )}
      {l.situacao === "ignorada" && l.motivo && (
        <p className="mt-1 flex items-start gap-1 text-[13px] text-[var(--text-muted)]">
          <CircleSlash size={13} aria-hidden className="mt-0.5 shrink-0" />
          {l.motivo}
        </p>
      )}

      {l.situacao === "duplicada" && l.motivo && (
        <p className="mt-1 text-[13px] text-[var(--text-muted)]">{l.motivo}</p>
      )}

      {l.situacao === "conflito" && diffs.length > 0 && (
        <div
          className="mt-1.5 rounded-lg border px-2 py-1.5"
          style={{
            borderColor: "color-mix(in srgb, var(--amber) 35%, transparent)",
            backgroundColor: "color-mix(in srgb, var(--amber) 8%, transparent)",
          }}
        >
          <p
            className="flex items-center gap-1 text-[13px] font-medium"
            style={{ color: "var(--amber)" }}
          >
            <AlertTriangle size={13} aria-hidden />
            Já está lançado no sistema com dados diferentes
          </p>
          <ListaDiffs itens={diffs} prefixo="m" diffTexto={diffTexto} />
        </div>
      )}

      {l.situacao === "conflito" && diffs.length === 0 && l.motivo && (
        <p
          className="mt-1.5 flex items-start gap-1 text-[13px]"
          style={{ color: "var(--amber)" }}
        >
          <AlertTriangle size={13} aria-hidden className="mt-0.5 shrink-0" />
          {l.motivo}
        </p>
      )}

      {l.vinculo && (
        <div
          className="mt-1.5 rounded-lg border px-2 py-1.5"
          style={{
            borderColor: "color-mix(in srgb, var(--accent) 35%, transparent)",
            backgroundColor: "color-mix(in srgb, var(--accent) 7%, transparent)",
          }}
        >
          <p className="flex flex-wrap items-center gap-1 text-[13px] text-[var(--text)]">
            <Link2 size={13} aria-hidden className="text-[var(--accent-text)]" />
            <span className="text-[var(--text-muted)]">
              {ROTULO_VINCULO[l.vinculo.tipo] ?? l.vinculo.tipo}:
            </span>
            <span className="break-words">{l.vinculo.descricao}</span>
            <span className="tabular-nums text-[var(--text-muted)]">
              {format(l.vinculo.valor)}
              {l.vinculo.data ? ` · ${formatDateBR(l.vinculo.data)}` : ""}
            </span>
          </p>
          {diffsVinculo.length > 0 && (
            <>
              <p className="mt-1 text-[13px] text-[var(--text-muted)]">Corrigir para o extrato:</p>
              <ListaDiffs itens={diffsVinculo} prefixo="v" diffTexto={diffTexto} />
            </>
          )}
        </div>
      )}
    </>
  );
}

function Dado({
  rotulo,
  children,
  className = "",
}: {
  rotulo: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      <dt className="text-xs text-[var(--text-muted)]">{rotulo}</dt>
      <dd className="mt-0.5 break-words text-sm text-[var(--text)]">{children}</dd>
    </div>
  );
}

/**
 * Veredito do arquivo para a primeira dobra do celular, no lugar da grade 2x2
 * de KPIs (292px → ~58px).
 *
 * HIERARQUIA: o número que DECIDE o próximo clique — conflitos, ou novas quando
 * não há conflito — vem em 28px tabular, o mesmo par 28/12 do KpiCard do
 * desktop. Os outros três colapsam numa segunda linha de 12px muted. Quatro
 * fatos em 12px, todos com o mesmo peso, não são um veredito: são uma legenda.
 */
function FaixaVeredito({
  contagem,
  className = "",
}: {
  contagem: ContagemLinhas;
  className?: string;
}) {
  const temNaoLida = contagem.naoLida > 0;
  const temConflito = contagem.conflito > 0;
  const decide = temNaoLida
    ? {
        n: contagem.naoLida,
        palavra: plural(contagem.naoLida, "não lida", "não lidas"),
        cor: "var(--red-text)",
      }
    : temConflito
      ? {
          n: contagem.conflito,
          palavra: plural(contagem.conflito, "conflito", "conflitos"),
          cor: "var(--amber)",
        }
      : {
          n: contagem.nova,
          palavra: plural(contagem.nova, "nova", "novas"),
          cor: contagem.nova > 0 ? "var(--accent-text)" : "var(--text-muted)",
        };

  const secundarias = [
    temNaoLida || temConflito
      ? `${contagem.nova} ${plural(contagem.nova, "nova", "novas")}`
      : `${contagem.conflito} ${plural(contagem.conflito, "conflito", "conflitos")}`,
    temNaoLida && temConflito
      ? `${contagem.conflito} ${plural(contagem.conflito, "conflito", "conflitos")}`
      : `${contagem.duplicada} já no sistema`,
    `${contagem.ignorada} ${plural(contagem.ignorada, "descartada", "descartadas")}`,
  ];

  return (
    <div
      role="status"
      className={`rounded-xl border px-3 py-1.5 ${className}`}
      style={{
        borderColor: temNaoLida
          ? "color-mix(in srgb, var(--red) 45%, var(--border))"
          : temConflito
            ? "color-mix(in srgb, var(--amber) 40%, var(--border))"
            : "var(--border)",
        backgroundColor: temNaoLida
          ? "color-mix(in srgb, var(--red) 7%, var(--bg-card))"
          : temConflito
            ? "color-mix(in srgb, var(--amber) 7%, var(--bg-card))"
            : "var(--bg-card)",
      }}
    >
      <p className="flex items-center gap-1.5">
        {temNaoLida || temConflito ? (
          <AlertTriangle
            size={15}
            aria-hidden
            className="shrink-0"
            style={{ color: temNaoLida ? "var(--red-text)" : "var(--amber)" }}
          />
        ) : (
          <Check size={15} aria-hidden className="shrink-0" style={{ color: "var(--accent-text)" }} />
        )}
        <span
          className="tabular-nums text-[28px] leading-none font-medium"
          style={{ color: decide.cor }}
        >
          {decide.n}
        </span>
        <span className="text-[13px] leading-none" style={{ color: decide.cor }}>
          {decide.palavra}
        </span>
      </p>
      <p className="tabular-nums mt-0.5 text-xs leading-tight text-[var(--text-muted)]">
        {secundarias.join(" · ")}
      </p>
    </div>
  );
}

/**
 * "N linhas lidas = a + b + c + d", com a conta à vista. Se sobrar linha fora
 * das categorias, isso vira erro na tela em vez de desaparecer da soma.
 */
function BalancoLinhas({
  total,
  partes,
  sobra,
}: {
  total: number;
  /** `alerta` pinta a parcela de vermelho: categoria que não deveria existir. */
  partes: { n: number; rotulo: string; alerta?: boolean }[];
  sobra: number;
}) {
  return (
    <>
      <p className="text-xs leading-relaxed text-[var(--text-muted)]">
        <span className="tabular-nums font-medium text-[var(--text)]">{total}</span>{" "}
        {plural(total, "linha do arquivo", "linhas do arquivo")} ={" "}
        {partes.map((p, i) => (
          <span key={p.rotulo} style={p.alerta && p.n > 0 ? { color: "var(--red-text)" } : undefined}>
            {i > 0 && " + "}
            <span
              className="tabular-nums font-medium"
              style={{ color: p.alerta && p.n > 0 ? "var(--red-text)" : "var(--text)" }}
            >
              {p.n}
            </span>{" "}
            {p.rotulo}
          </span>
        ))}
        .
      </p>
      {sobra !== 0 && (
        <p className="mt-0.5 text-xs leading-relaxed" style={{ color: "var(--red-text)" }}>
          {sobra > 0 ? (
            <>
              <span className="tabular-nums">{sobra}</span>{" "}
              {plural(sobra, "linha do arquivo não entrou", "linhas do arquivo não entraram")} em
              categoria nenhuma — a conta não fecha. Confira o arquivo antes de gravar.
            </>
          ) : (
            <>
              As categorias somam <span className="tabular-nums">{Math.abs(sobra)}</span> a mais do
              que o arquivo tem de linhas — a conta não fecha. Confira o arquivo antes de gravar.
            </>
          )}
        </p>
      )}
    </>
  );
}

/**
 * Fechamento que não bate. Nenhum concorrente confere isso no preview, e é o
 * controle mais valioso que existe para extrato: se creditos − debitos não dá a
 * variação de saldo do próprio arquivo, o arquivo está truncado ou tem linha que
 * o leitor não entendeu. O usuário precisa saber ANTES de gravar.
 */
function AvisoFechamento({
  f,
  format,
}: {
  f: NonNullable<ReturnType<typeof conferirFechamento>>;
  format: (n: number) => string;
}) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs leading-relaxed"
      style={{
        borderColor: "color-mix(in srgb, var(--red) 40%, transparent)",
        backgroundColor: "color-mix(in srgb, var(--red) 7%, transparent)",
        color: "var(--red-text)",
      }}
    >
      <AlertTriangle size={14} aria-hidden className="mt-0.5 shrink-0" />
      <div className="min-w-0">
        <strong className="font-medium">
          O arquivo não fecha: faltam{" "}
          <span className="tabular-nums">{format(Math.abs(f.diferenca))}</span>.
        </strong>
        {/*
          Uma frase na dobra, o resto sob demanda. Eram 292 caracteres de prosa
          ocupando 26% do corpo do celular antes da primeira linha de dado —
          e a linha de dado é a coisa pela qual esta tela existe.
        */}
        <details className="group mt-0.5">
          {/*
            Alvo de 44px (WCAG 2.5.5) sem inchar o alerta: a caixa cresce para
            44 e a margem negativa devolve os 24px ao layout. Era um link de
            20px de altura na dobra do celular.
          */}
          <summary className="-my-3 inline-flex min-h-11 cursor-pointer list-none items-center gap-1 underline underline-offset-2 pointer-fine:my-0 pointer-fine:min-h-0 [&::-webkit-details-marker]:hidden">
            Ver a conta
            <ChevronDown size={12} aria-hidden className="transition-transform group-open:rotate-180" />
          </summary>
          <p className="mt-1 leading-relaxed">
            As linhas somam <span className="tabular-nums">{format(f.movimento)}</span>, mas o saldo
            do próprio arquivo variou <span className="tabular-nums">{format(f.variacao)}</span> (de{" "}
            <span className="tabular-nums">{format(f.saldoInicial)}</span> para{" "}
            <span className="tabular-nums">{format(f.saldoFinal)}</span>). Ou o extrato veio cortado,
            ou uma linha não foi entendida. Baixe o período inteiro de novo pelo aplicativo do
            banco, ou confira a lista abaixo antes de gravar.
          </p>
        </details>
      </div>
    </div>
  );
}

/**
 * O QUE MUDOU FORA DAS LINHAS.
 *
 * Um import mexe em mais coisa do que em movimentações: cria conta, troca qual
 * conta está ativa (e com ela o saldo real do painel), regrava a âncora de
 * saldo, renomeia a conta. Nada disso aparecia na tela de resultado, que ainda
 * afirmava "Nenhum lançamento que já estava no sistema foi alterado" — enquanto
 * o painel ia de "Saldo real hoje R$ 223,95" para "Defina o saldo inicial".
 * Aqui cada mudança sai escrita, com o antes e o depois.
 */
function MudancasForaDasLinhas({
  mudancas,
  ancora,
  contaDoArquivo,
  format,
}: {
  mudancas: MudancasFora | null;
  ancora: { data: string; valor: number } | null;
  /** Nome da conta DESTE extrato — não confundir com a que ficou ativa. */
  contaDoArquivo: string | null;
  format: (n: number) => string;
}) {
  const itens: { texto: React.ReactNode; grave?: boolean }[] = [];
  if (mudancas?.contaAtivaTrocada) {
    itens.push({
      grave: true,
      texto: (
        <>
          A <strong className="font-medium">conta ativa mudou</strong>
          {mudancas.contaAtivaAntes ? <> de {mudancas.contaAtivaAntes.nome}</> : null}
          {mudancas.contaAtivaAgora ? <> para {mudancas.contaAtivaAgora.nome}</> : null}. O saldo
          real do painel passa a ser o desta conta.
        </>
      ),
    });
  }
  if (mudancas?.contaCriada) {
    itens.push({
      texto: (
        <>
          Uma <strong className="font-medium">conta nova</strong> foi criada para este extrato
          {contaDoArquivo ? <> ({contaDoArquivo})</> : null}
          {mudancas.contaAtivaTrocada ? null : ", e ela não é a conta ativa"}.
        </>
      ),
    });
  }
  if (mudancas?.nomeAlterado) {
    itens.push({
      texto: (
        <>
          A conta foi renomeada de “{mudancas.nomeAlterado.de}” para “{mudancas.nomeAlterado.para}”.
        </>
      ),
    });
  }
  const ancoraNova = mudancas?.ancoraGravada ?? (ancora ? { data: ancora.data, valor: ancora.valor } : null);
  if (ancoraNova) {
    const antes = mudancas?.ancoraAnterior;
    itens.push({
      texto: (
        <>
          O <strong className="font-medium">saldo de referência</strong> passou a ser{" "}
          <span className="tabular-nums text-[var(--text)]">
            {ancoraNova.valor != null ? format(ancoraNova.valor) : "—"}
          </span>
          {ancoraNova.data ? <> em {formatDateBR(ancoraNova.data)}</> : null}
          {antes && (antes.valor != null || antes.data) ? (
            <>
              {" "}
              (antes era{" "}
              <span className="tabular-nums">
                {antes.valor != null ? format(antes.valor) : "—"}
              </span>
              {antes.data ? <> em {formatDateBR(antes.data)}</> : null})
            </>
          ) : null}
          . É a partir dele que o fluxo calcula o saldo de hoje.
        </>
      ),
    });
  }

  if (itens.length === 0) {
    return (
      <p className="text-xs leading-relaxed text-[var(--text-muted)]">
        Fora as linhas, nada mudou: a conta ativa e o saldo de referência continuam como estavam.
      </p>
    );
  }

  const temGrave = itens.some((i) => i.grave);
  return (
    <div
      className="rounded-xl border px-3 py-2.5 text-xs leading-relaxed"
      style={{
        borderColor: temGrave
          ? "color-mix(in srgb, var(--amber) 45%, transparent)"
          : "var(--border)",
        backgroundColor: temGrave
          ? "color-mix(in srgb, var(--amber) 7%, transparent)"
          : "var(--bg-card)",
      }}
    >
      <p className="font-medium text-[var(--text)]">O que mudou além das linhas</p>
      <ul className="mt-1 space-y-1 text-[var(--text-muted)]">
        {itens.map((i, n) => (
          <li key={n} className="flex items-start gap-1.5">
            <span aria-hidden className="mt-1.5 size-1 shrink-0 rounded-full bg-[var(--text-muted)]" />
            <span>{i.texto}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Arquivo sem nenhuma transação (só cabeçalho, ou download vazio de linhas).
 * O balanço fechava em "0 = 0 + 0 + 0" e a tela vestia isso de sucesso. Não é:
 * é um arquivo do qual não há o que importar, e o usuário precisa saber ANTES
 * de procurar o botão que não vai acender.
 */
function AvisoSemTransacoes({ ancoraValida }: { ancoraValida: boolean }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs leading-relaxed"
      style={{
        borderColor: "color-mix(in srgb, var(--amber) 45%, transparent)",
        backgroundColor: "color-mix(in srgb, var(--amber) 8%, transparent)",
        color: "var(--text)",
      }}
    >
      <AlertTriangle size={14} aria-hidden className="mt-0.5 shrink-0" style={{ color: "var(--amber)" }} />
      <div className="min-w-0 flex-1">
        <strong className="font-medium">Este arquivo não tem nenhuma transação.</strong>{" "}
        O leitor achou o cabeçalho, mas nenhuma linha de movimento —{" "}
        {ancoraValida
          ? "dá para gravar só o saldo do arquivo, se for isso que você quer."
          : "não há nada para importar."}{" "}
        Confira se você baixou o período certo no aplicativo do banco.
      </div>
    </div>
  );
}

/**
 * O extrato é de uma conta diferente da ativa. ISTO É UMA PERGUNTA, não um
 * aviso: o import trocava a conta ativa sozinho, o painel ia de "Saldo real
 * hoje R$ 223,95" para "Defina o saldo inicial", e a tela de resultado dizia
 * que nada tinha mudado. A opção segura — manter — vem marcada.
 */
function EscolhaContaAtiva({
  contaAtiva,
  contaArquivo,
  decisao,
  onDecidir,
}: {
  contaAtiva: { nome: string; agencia: string; conta: string };
  contaArquivo: { nome: string; agencia: string; conta: string; existe: boolean };
  decisao: DecisaoContaAtiva | null;
  onDecidir: (d: DecisaoContaAtiva) => void;
}) {
  const escolhida = decisao ?? "manter";
  return (
    <div
      className="rounded-xl border px-3 py-2.5 text-xs leading-relaxed"
      style={{
        borderColor: "color-mix(in srgb, var(--amber) 45%, transparent)",
        backgroundColor: "color-mix(in srgb, var(--amber) 7%, transparent)",
      }}
    >
      <p className="flex items-start gap-2 text-[var(--text)]">
        <Wallet size={14} aria-hidden className="mt-0.5 shrink-0" style={{ color: "var(--amber)" }} />
        <span>
          <strong className="font-medium">Este extrato é de outra conta.</strong> O arquivo é da
          conta <span className="tabular-nums">{contaArquivo.agencia}/{contaArquivo.conta}</span>
          {contaArquivo.existe ? "" : " (que ainda não existe aqui)"} e a sua conta ativa é{" "}
          <strong className="font-medium">{contaAtiva.nome}</strong>. O saldo real do painel vem da
          conta ativa — por isso quem decide é você.
        </span>
      </p>
      <div className="mt-2 flex flex-col gap-1.5 sm:pl-6">
        <label
          htmlFor="conta-ativa-manter"
          className="flex min-h-11 cursor-pointer items-start gap-2 text-[var(--text)] pointer-fine:min-h-0"
        >
          <input
            id="conta-ativa-manter"
            name="conta-ativa"
            type="radio"
            className="mt-0.5 size-4 shrink-0 pointer-coarse:size-5"
            checked={escolhida === "manter"}
            onChange={() => onDecidir("manter")}
          />
          <span>
            Importar e <strong className="font-medium">manter {contaAtiva.nome} ativa</strong>
            <span className="ml-1 text-[var(--text-muted)]">
              (o painel e o saldo real continuam como estão)
            </span>
          </span>
        </label>
        <label
          htmlFor="conta-ativa-trocar"
          className="flex min-h-11 cursor-pointer items-start gap-2 text-[var(--text)] pointer-fine:min-h-0"
        >
          <input
            id="conta-ativa-trocar"
            name="conta-ativa"
            type="radio"
            className="mt-0.5 size-4 shrink-0 pointer-coarse:size-5"
            checked={escolhida === "trocar"}
            onChange={() => onDecidir("trocar")}
          />
          <span>
            Importar e <strong className="font-medium">ativar a conta do arquivo</strong>
            <span className="ml-1 text-[var(--text-muted)]">
              (o painel passa a mostrar o saldo desta outra conta)
            </span>
          </span>
        </label>
      </div>
    </div>
  );
}

/** A mesma pergunta, quando quem a fez foi o servidor (409). Nada foi gravado. */
function PerguntaContaAtiva({
  pergunta,
  onResponder,
}: {
  pergunta: PerguntaContaDiferente;
  onResponder: (d: DecisaoContaAtiva) => void;
}) {
  return (
    <div
      role="alert"
      className="rounded-xl border px-3 py-2.5 text-xs leading-relaxed"
      style={{
        borderColor: "color-mix(in srgb, var(--amber) 50%, transparent)",
        backgroundColor: "color-mix(in srgb, var(--amber) 9%, transparent)",
      }}
    >
      <p className="text-[var(--text)]">
        <strong className="font-medium">Este extrato é de outra conta.</strong> Ele é da conta{" "}
        <span className="tabular-nums">
          {pergunta.contaExtrato.agencia}/{pergunta.contaExtrato.conta}
        </span>{" "}
        e a sua conta ativa é <strong className="font-medium">{pergunta.contaAtiva.nome}</strong>.
        Nada foi gravado ainda — escolha e confirme de novo.
      </p>
      <div className="mt-2 flex flex-wrap gap-2">
        {pergunta.opcoes.map((o) => (
          <button
            key={o.id}
            type="button"
            onClick={() => onResponder(o.id)}
            className="inline-flex min-h-11 items-center rounded-lg border border-[var(--border)] bg-[var(--bg-card)] px-3 py-1.5 text-xs text-[var(--text)] hover:bg-[var(--bg-elevated)] sm:pointer-fine:min-h-0"
          >
            {o.rotulo}
          </button>
        ))}
      </div>
    </div>
  );
}

/**
 * Linha do arquivo que não virou nada: o sistema não a leu, ou o balanço não
 * fecha. É o alerta mais grave desta tela — o número na tela deixa de descrever
 * o arquivo, e nenhum outro aviso aqui tem esse alcance. Uma frase na dobra,
 * com o botão que leva direto às linhas; a explicação fica sob demanda.
 */
function AvisoLinhasPerdidas({
  bal,
  fechamento,
  format,
  aoVerLinhas,
}: {
  bal: BalancoPreview;
  /** Fechamento do arquivo, para dizer de quanto é o buraco que a linha abriu. */
  fechamento: ReturnType<typeof conferirFechamento>;
  format: (n: number) => string;
  aoVerLinhas: () => void;
}) {
  const n = bal.naoLidas;
  const sobra = bal.naoClassificadas;
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border px-3 py-2.5 text-xs leading-relaxed"
      style={{
        borderColor: "color-mix(in srgb, var(--red) 45%, transparent)",
        backgroundColor: "color-mix(in srgb, var(--red) 8%, transparent)",
        color: "var(--red-text)",
      }}
    >
      <AlertTriangle size={14} aria-hidden className="mt-0.5 shrink-0" />
      <div className="min-w-0 flex-1">
        <strong className="font-medium">
          {n > 0 ? (
            <>
              O sistema não leu <span className="tabular-nums">{n}</span>{" "}
              {plural(n, "linha", "linhas")} deste arquivo.
            </>
          ) : (
            <>
              A conta das linhas não fecha:{" "}
              <span className="tabular-nums">{Math.abs(sobra)}</span>{" "}
              {plural(Math.abs(sobra), "linha", "linhas")} de diferença.
            </>
          )}
        </strong>
        {/*
          Em linha, no meio da frase, isto era um alvo de 20px de altura. Em
          linha própria vira um alvo de 44px de verdade (WCAG 2.5.5) sem passar
          por cima do texto: no ponteiro fino volta a ser o link compacto.
        */}
        {n > 0 && (
          <div className="mt-1.5 pointer-fine:mt-0.5">
            <button
              type="button"
              onClick={aoVerLinhas}
              className="inline-flex min-h-11 items-center rounded-lg border border-[var(--red)]/45 px-3 underline underline-offset-2 pointer-fine:min-h-0 pointer-fine:border-transparent pointer-fine:px-0"
              style={{ color: "var(--red-text)" }}
            >
              Ver {plural(n, "a linha", "as linhas")}
            </button>
          </div>
        )}
        {/* mt-3 paga os 12px que o alvo de 44px do "Ver detalhes" sobe. */}
        <details className="group mt-3 pointer-fine:mt-0.5">
          <summary className="-my-3 inline-flex min-h-11 cursor-pointer list-none items-center gap-1 underline underline-offset-2 pointer-fine:my-0 pointer-fine:min-h-0 [&::-webkit-details-marker]:hidden">
            Ver detalhes
            <ChevronDown size={12} aria-hidden className="transition-transform group-open:rotate-180" />
          </summary>
          <p className="mt-1 leading-relaxed">
            O arquivo tem <span className="tabular-nums">{bal.linhasLidas}</span>{" "}
            {plural(bal.linhasLidas, "linha de dados", "linhas de dados")} e o sistema classificou{" "}
            <span className="tabular-nums">
              {bal.novas + bal.conflitos + bal.jaNoSistema + bal.descartadas}
            </span>
            . {n > 0 ? "As não lidas não entram no extrato, " : "As que faltam não aparecem em lugar nenhum, "}
            e por isso o total desta tela não descreve mais o arquivo inteiro.
            {fechamento && !fechamento.bate && (
              <>
                {" "}
                É também por isso que o arquivo não fecha: as linhas somam{" "}
                <span className="tabular-nums">{format(fechamento.movimento)}</span> e o saldo do
                próprio arquivo variou{" "}
                <span className="tabular-nums">{format(fechamento.variacao)}</span> —{" "}
                <span className="tabular-nums">{format(Math.abs(fechamento.diferenca))}</span> de
                diferença.
              </>
            )}{" "}
            Baixe o extrato de novo pelo aplicativo do banco, sem abrir no Excel, antes de gravar.
          </p>
        </details>
      </div>
    </div>
  );
}

function OpcaoModo({
  id,
  marcada,
  onSelect,
  titulo,
  descricao,
  destaque,
}: {
  id: string;
  marcada: boolean;
  onSelect: () => void;
  titulo: string;
  descricao: string;
  destaque?: boolean;
}) {
  return (
    <label
      htmlFor={id}
      className="flex cursor-pointer items-start gap-3 rounded-lg border p-3"
      style={{
        borderColor: marcada
          ? destaque
            ? "color-mix(in srgb, var(--amber) 45%, var(--border))"
            : "var(--accent)"
          : "var(--border)",
        backgroundColor: marcada
          ? destaque
            ? "color-mix(in srgb, var(--amber) 7%, transparent)"
            : "color-mix(in srgb, var(--accent) 7%, transparent)"
          : "var(--bg)",
      }}
    >
      <input
        id={id}
        type="radio"
        name="modo-import-extrato"
        className="mt-0.5 size-4 shrink-0 pointer-coarse:size-5"
        checked={marcada}
        onChange={onSelect}
      />
      <span className="min-w-0">
        <span className="block text-sm font-medium text-[var(--text)]">{titulo}</span>
        <span className="mt-0.5 block text-[13px] leading-relaxed text-[var(--text-muted)]">
          {descricao}
        </span>
      </span>
    </label>
  );
}

function ResultadoStat({
  icone,
  rotulo,
  valor,
  tone,
  hint,
}: {
  icone: React.ReactNode;
  rotulo: string;
  valor: number;
  tone?: "accent" | "ambar" | "vermelho";
  hint?: string;
}) {
  const cor =
    tone === "accent"
      ? "var(--accent-text)"
      : tone === "ambar"
        ? "var(--amber)"
        : tone === "vermelho"
          ? "var(--red-text)"
          : "var(--text)";
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <p className="tabular-nums text-3xl leading-none font-medium" style={{ color: cor }}>
        {valor}
      </p>
      <p className="mt-2 flex items-center gap-1 text-xs text-[var(--text-muted)]">
        <span aria-hidden className="shrink-0">
          {icone}
        </span>
        {rotulo}
      </p>
      {hint && <p className="mt-1 text-xs text-[var(--text-muted)]">{hint}</p>}
    </div>
  );
}

function CaixaErro({ texto }: { texto: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border px-3 py-2.5 text-sm"
      style={{
        borderColor: "color-mix(in srgb, var(--red) 40%, transparent)",
        backgroundColor: "color-mix(in srgb, var(--red) 7%, transparent)",
        color: "var(--red-text)",
      }}
    >
      <AlertTriangle size={15} aria-hidden className="mt-0.5 shrink-0" />
      {/* A mensagem do servidor vem em dois parágrafos: manchete e, depois, o
          detalhe do leitor. Sem whitespace-pre-line os dois viravam um bloco só. */}
      <span className="min-w-0 whitespace-pre-line break-words">{texto}</span>
    </div>
  );
}

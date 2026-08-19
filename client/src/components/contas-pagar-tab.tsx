import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, Pencil, Plus, Repeat, SlidersHorizontal, Tags, Trash2, Wallet } from "lucide-react";
import { api } from "@/lib/api";
import { useMoney } from "@/lib/hide-values";
import { formatDateBR } from "@/lib/formatters";
import { hojeBrasil } from "@/lib/date";
import { nomesCategorias, useCategorias } from "@/lib/use-categorias";
import { contemBusca } from "@shared/texto";
import { parseValorPositivoDigitado } from "@shared/valor";
import { InputDecimalBr, paraCampoDecimalBr } from "@/components/ui/input-decimal-br";
import { agruparRecortes, ordenarContas, type OrdemLista } from "@shared/contas-recorte";
import GerenciarCategoriasModal from "@/components/gerenciar-categorias-modal";
import Chip from "@/components/ui/chip";
import KpiChips, { type KpiChipOpcao } from "@/components/ui/kpi-chips";
import type { KpiTone } from "@/components/ui/kpi";
import Sheet from "@/components/ui/sheet";
import EmptyState from "@/components/ui/empty-state";
import Busca from "@/components/ui/busca";
import { useConfirmar } from "@/components/ui/confirmar";

type FiltroAba = "aberto" | "pagas";
type FiltroChip = "todas" | "vencidas" | "prox7" | "urgentes" | "mes" | "sem-categoria";
type Ordem = OrdemLista;

const emptyForm = () => ({
  descricao: "",
  valor: "",
  dataVencimento: hojeBrasil(),
  categoria: "Outros",
  recorrencia: "" as "" | "mensal" | "parcelado",
  totalParcelas: "2",
  observacoes: "",
});

/** Soma "valor" (string decimal do Postgres) de uma lista de contas. */
function soma(rows: any[]): number {
  return rows.reduce((acc, r) => acc + Number(r.valor || 0), 0);
}

/** Soma dias a uma data ISO (YYYY-MM-DD) sem sair do fuso local. */
function addDiasISO(iso: string, dias: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + dias);
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${dt.getFullYear()}-${mm}-${dd}`;
}

const RECORTES: { id: FiltroChip; label: string; tone: KpiTone }[] = [
  { id: "todas", label: "Todas", tone: "neutro" },
  { id: "vencidas", label: "Vencidas", tone: "vermelho" },
  { id: "prox7", label: "Vence em 7 dias", tone: "accent" },
  { id: "urgentes", label: "Urgentes", tone: "vermelho" },
  { id: "mes", label: "Este mês", tone: "neutro" },
  { id: "sem-categoria", label: "Sem categoria", tone: "neutro" },
];

/**
 * Uma fileira só de filtros no lugar de duas.
 *
 * Antes havia abas (Em aberto / Pagas) E uma faixa de chips logo abaixo,
 * 92px de altura fazendo o MESMO trabalho: filtrar a mesma lista mostrando a
 * contagem. Aqui as duas viram uma coisa só — cada item já é o par
 * (aba, recorte). Os recortes secundários vivem na folha "Filtrar e ordenar"
 * para esta fileira caber numa linha só num celular de 390px.
 */
const FILEIRA: { id: string; aba: FiltroAba; filtro: FiltroChip; label: string; tone: KpiTone }[] = [
  { id: "aberto:todas", aba: "aberto", filtro: "todas", label: "Em aberto", tone: "neutro" },
  { id: "aberto:vencidas", aba: "aberto", filtro: "vencidas", label: "Vencidas", tone: "vermelho" },
  { id: "aberto:prox7", aba: "aberto", filtro: "prox7", label: "Vence em 7 dias", tone: "accent" },
  // Ocupa a vaga quando os DOIS existem: nenhum dos dois recortes some da tela.
  { id: "aberto:urgentes", aba: "aberto", filtro: "urgentes", label: "Urgentes", tone: "vermelho" },
  { id: "pagas:todas", aba: "pagas", filtro: "todas", label: "Pagas", tone: "verde" },
];

/** Recortes que cada pólo admite, na ordem em que aparecem na folha. */
const RECORTES_POR_ABA: Record<FiltroAba, FiltroChip[]> = {
  aberto: ["vencidas", "prox7", "mes", "sem-categoria"],
  pagas: ["mes", "sem-categoria"],
};

/**
 * A fileira precisa caber em UMA linha num celular de 390px (358px úteis).
 * Os quatro chips juntos pedem 435px e quebram em duas linhas — que é
 * exatamente a altura que a fusão veio economizar. Então a fileira leva no
 * máximo três: os dois pólos, que são a navegação, e UMA vaga de urgência.
 *
 * A vaga era do recorte mais urgente que existisse, e com isso o OUTRO sumia
 * da tela sem deixar rastro: com 1 vencida a fileira dizia "Em aberto 15 |
 * Vencidas 1 | Pagas 143" e as 5 contas que venciam na semana só existiam
 * dentro da folha, a dois toques de distância. Agora, quando os dois recortes
 * têm conta, a vaga é de "Urgentes", que é a UNIÃO deles — um chip só, mesma
 * largura, e nada de urgente fora da tela. A separação fina (só as vencidas,
 * só as da semana) continua na folha, agora como refinamento e não como
 * esconderijo.
 */
function vagaDeUrgencia(contagem: Record<string, number>): string | null {
  const vencidas = contagem["aberto:vencidas"] > 0;
  const prox7 = contagem["aberto:prox7"] > 0;
  if (vencidas && prox7) return "aberto:urgentes";
  if (vencidas) return "aberto:vencidas";
  if (prox7) return "aberto:prox7";
  return null;
}

/**
 * Rótulo e cor de cada recorte.
 *
 * "Este mês" é o único rótulo que muda com a aba, e de propósito: numa aba
 * chamada "Pagas", "este mês" só pode significar PAGO este mês — antes ele
 * contava por vencimento e escondia uma conta paga em agosto que vence em
 * setembro. O rótulo agora diz qual data está sendo contada.
 */
function rotuloRecorte(id: FiltroChip, aba: FiltroAba): string {
  if (id === "mes") return aba === "pagas" ? "Pagas este mês" : "Vence este mês";
  if (id === "urgentes") return "Vencidas ou vencendo em 7 dias";
  return RECORTES.find((o) => o.id === id)?.label ?? "";
}

/** Cor do número-líder por recorte — tokens do DESIGN.md, nada de vermelho decorativo. */
const CORES_VALOR: Record<KpiTone, string> = {
  neutro: "var(--text)",
  verde: "var(--green)",
  vermelho: "var(--red-text)",
  ambar: "var(--amber)",
  accent: "var(--accent-text)",
};

const ORDENS_COMUNS: { id: Ordem; label: string }[] = [
  { id: "venc-asc", label: "Vencimento (mais próximo)" },
  { id: "venc-desc", label: "Vencimento (mais distante)" },
  { id: "valor-desc", label: "Valor (maior primeiro)" },
  { id: "valor-asc", label: "Valor (menor primeiro)" },
];

/**
 * A aba Pagas ordena por PAGAMENTO, e por padrão.
 *
 * "Vencimento (mais próximo)" é a pergunta certa para o que ainda se deve e a
 * errada para o que já se pagou: com ela a conta que acabou de ser paga caía na
 * posição 142 de 143 e as 24 pagas neste mês eram as ÚLTIMAS 24 da lista.
 * Estas duas ordens só existem onde a data de pagamento existe — em "Em aberto"
 * ela é sempre vazia e a opção seria uma escolha que não faz nada.
 */
const ORDENS_PAGAS: { id: Ordem; label: string }[] = [
  { id: "pag-desc", label: "Pagamento (mais recente)" },
  { id: "pag-asc", label: "Pagamento (mais antigo)" },
  ...ORDENS_COMUNS,
];

function ordensDaAba(aba: FiltroAba): { id: Ordem; label: string }[] {
  return aba === "pagas" ? ORDENS_PAGAS : ORDENS_COMUNS;
}

/** Cada aba tem a sua pergunta padrão — e trocar de aba volta para ela. */
const ORDEM_PADRAO: Record<FiltroAba, Ordem> = {
  aberto: "venc-asc",
  pagas: "pag-desc",
};

/**
 * Quantas contas a lista desenha antes de pedir licença.
 *
 * 143 cartões são 17.724px de rolagem num iPad de 834px e 6.927 nós de DOM. O
 * teto não esconde nada: o número-líder e o resumo continuam falando da lista
 * INTEIRA, e o botão abaixo diz quantas faltam e traz mais 50. Com a ordem
 * padrão da aba Pagas (pagamento mais recente) as 50 primeiras já cobrem quase
 * cinco meses de pagamentos.
 */
const LOTE = 50;

/** ≥ 1024px: tabela. Abaixo: cartões (uma coluna, ou duas a partir de 640px). */
const CORTE_TABELA = 1024;

/**
 * Qual dos dois ramos montar — e só ele.
 *
 * Antes os DOIS existiam em toda largura (144 `<tr>` + 144 `<li>`), com o ramo
 * invisível apenas escondido por `display:none`: 6.927 nós de DOM e 784KB de
 * HTML para desenhar uma lista só. `matchMedia` é a mesma pergunta que o CSS
 * faz, respondida em JS, para o ramo escondido nem nascer.
 */
function useTabela(): boolean {
  const consulta = `(min-width: ${CORTE_TABELA}px)`;
  const [tabela, setTabela] = useState(
    () => typeof window !== "undefined" && window.matchMedia(consulta).matches,
  );
  useEffect(() => {
    const mq = window.matchMedia(consulta);
    const aplicar = () => setTabela(mq.matches);
    aplicar();
    mq.addEventListener("change", aplicar);
    return () => mq.removeEventListener("change", aplicar);
  }, [consulta]);
  return tabela;
}

export default function ContasPagarTab() {
  const { format } = useMoney();
  const qc = useQueryClient();
  const confirmar = useConfirmar();

  const [aba, setAba] = useState<FiltroAba>("aberto");
  const [filtro, setFiltro] = useState<FiltroChip>("todas");
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<Ordem>(ORDEM_PADRAO.aberto);
  const [teto, setTeto] = useState(LOTE);
  const [sheetAberto, setSheetAberto] = useState(false);
  const [folhaFiltros, setFolhaFiltros] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [gerenciarCats, setGerenciarCats] = useState(false);
  const tabela = useTabela();

  const q = useQuery({
    queryKey: ["contas-pagar"],
    queryFn: () => api.get<any[]>("/api/contas-pagar"),
  });
  const catsQ = useCategorias();
  const [form, setForm] = useState(emptyForm);
  const categoriasOpts = nomesCategorias(catsQ.data, form.categoria);

  const hoje = hojeBrasil();
  const limite7 = addDiasISO(hoje, 7);
  const mesAtual = hoje.slice(0, 7);

  const rows = q.data ?? [];
  const abertas = useMemo(
    () => rows.filter((r) => r.status === "pendente" || r.status === "vencido"),
    [rows],
  );
  const pagas = useMemo(() => rows.filter((r) => r.status === "pago"), [rows]);

  /* ── Lista visível: aba → chip → busca → ordenação ── */
  const base = aba === "aberto" ? abertas : pagas;

  /**
   * Cada recorte guarda as próprias linhas: a mesma estrutura alimenta o
   * número do chip, a soma do chip e a lista filtrada — um dado, um lugar.
   */
  const grupos = useMemo(
    // `quitadas` manda em qual data conta como "este mês": na aba Pagas é a de
    // pagamento (regra e teste em @shared/contas-recorte).
    () => agruparRecortes(base, { hoje, limite7, mesAtual, quitadas: aba === "pagas" }),
    [aba, base, hoje, limite7, mesAtual],
  ) as Record<FiltroChip, any[]>;

  /* Contagem de cada item da fileira — sempre sobre a lista inteira, não
     sobre a aba corrente: os chips são também as abas agora. */
  const contagemFileira = useMemo(() => {
    const conta = (linhas: any[], filtro: FiltroChip) => {
      switch (filtro) {
        case "vencidas":
          return linhas.filter((r) => r.status === "vencido" || r.dataVencimento < hoje).length;
        case "prox7":
          return linhas.filter((r) => r.dataVencimento >= hoje && r.dataVencimento <= limite7)
            .length;
        case "urgentes":
          // União, não soma: quem estiver nos dois recortes conta uma vez.
          return linhas.filter(
            (r) =>
              r.status === "vencido" ||
              r.dataVencimento < hoje ||
              (r.dataVencimento >= hoje && r.dataVencimento <= limite7),
          ).length;
        default:
          return linhas.length;
      }
    };
    return Object.fromEntries(
      FILEIRA.map((o) => [o.id, conta(o.aba === "aberto" ? abertas : pagas, o.filtro)]),
    ) as Record<string, number>;
  }, [abertas, pagas, hoje, limite7]);

  const urgencia = vagaDeUrgencia(contagemFileira);

  const opcoesFileira: KpiChipOpcao[] = useMemo(
    () =>
      FILEIRA.filter((o) => o.id.endsWith(":todas") || o.id === urgencia).map((o) => ({
        id: o.id,
        label: o.label,
        tone: o.tone,
        count: contagemFileira[o.id],
        // "Urgentes" é a única etiqueta que não se explica sozinha: diz por
        // extenso de que soma ela é feita, sem gastar largura na fileira.
        titulo:
          o.filtro === "urgentes"
            ? `${contagemFileira["aberto:vencidas"]} vencida${
                contagemFileira["aberto:vencidas"] === 1 ? "" : "s"
              } e ${contagemFileira["aberto:prox7"]} vencendo em 7 dias`
            : undefined,
      })),
    [contagemFileira, urgencia],
  );

  /** Recortes da folha: os desta aba que a fileira não mostra, com contagem. */
  const opcoesSecundarias = useMemo(
    () =>
      RECORTES_POR_ABA[aba]
        .filter((id) => `${aba}:${id}` !== urgencia)
        .map((id) => ({ id, label: rotuloRecorte(id, aba), count: grupos[id].length }))
        .filter((o) => o.count > 0),
    [aba, grupos, urgencia],
  );

  // Se o recorte ativo sumiu (trocou de aba, ou zerou), volta para "Todas".
  // A ORDEM volta junto: "vencimento mais próximo" é a pergunta de quem ainda
  // deve, e a aba Pagas pergunta outra coisa ("o que paguei por último?").
  // Sem este reset a ordem de uma aba vazava para a outra e a conta recém-paga
  // aparecia na posição 142 de 143.
  useEffect(() => {
    if (filtro === "todas") return;
    const naFileira = `${aba}:${filtro}` === urgencia;
    const naFolha = opcoesSecundarias.some((o) => o.id === filtro);
    if (!naFileira && !naFolha) setFiltro("todas");
  }, [aba, filtro, urgencia, opcoesSecundarias]);

  useEffect(() => {
    setOrdem(ORDEM_PADRAO[aba]);
  }, [aba]);

  const lista = useMemo(() => {
    let out = grupos[filtro] ?? base;

    // Acento não pode ser senha: "pro-labore" precisa achar "Pró-labore".
    // Os dois lados passam pela MESMA normalização (NFD + \p{Diacritic}).
    if (busca.trim()) {
      out = out.filter((r) =>
        contemBusca(`${r.descricao ?? ""} ${r.categoria ?? ""} ${r.observacoes ?? ""}`, busca),
      );
    }

    // Desempate por id em TODAS as ordens (@shared/contas-recorte).
    return ordenarContas(out, ordem);
  }, [base, grupos, filtro, busca, ordem]);

  /* ── Teto de exibição ── */
  // Qualquer mexida na pergunta (aba, recorte, busca, ordem) recomeça do
  // primeiro lote: rolar 143 cartões porque a busca de antes tinha aberto a
  // lista inteira seria o defeito de volta pela porta dos fundos.
  useEffect(() => {
    setTeto(LOTE);
  }, [aba, filtro, busca, ordem]);

  const visiveis = useMemo(() => lista.slice(0, teto), [lista, teto]);
  const ocultas = lista.length - visiveis.length;

  /* ── Número-líder: a soma do que está na tela AGORA, num lugar só ── */
  const recorteAtivo = RECORTES.find((o) => o.id === filtro);
  const totalLista = useMemo(() => soma(lista), [lista]);
  // Pagas é sempre verde; em aberto herda a semântica do recorte selecionado.
  const toneTotal: KpiTone = aba === "pagas" ? "verde" : recorteAtivo?.tone ?? "neutro";

  const resumoLista = useMemo(() => {
    const n = lista.length;
    const rotuloAba = aba === "aberto" ? "em aberto" : "pagas";
    if (filtro === "todas" && !busca.trim()) {
      return `${n} ${n === 1 ? "conta" : "contas"} ${rotuloAba}`;
    }
    const recorte = filtro === "todas" ? "" : ` · ${rotuloRecorte(filtro, aba)}`;
    return `${n} de ${base.length} ${rotuloAba}${recorte}`;
  }, [lista.length, base.length, aba, filtro, busca]);

  /** Há algo escolhido na folha que a fileira não mostra? Então ela avisa. */
  const refinado =
    ordem !== ORDEM_PADRAO[aba] || (filtro !== "todas" && `${aba}:${filtro}` !== urgencia);

  function refresh() {
    qc.invalidateQueries({ queryKey: ["contas-pagar"] });
    qc.invalidateQueries({ queryKey: ["fluxo"] });
  }

  function fecharSheet() {
    setSheetAberto(false);
    setEditingId(null);
    setForm(emptyForm());
  }

  function abrirNova() {
    setEditingId(null);
    setForm(emptyForm());
    setSheetAberto(true);
  }

  function startEdit(r: any) {
    setEditingId(r.id);
    setForm({
      descricao: r.descricao ?? "",
      valor: paraCampoDecimalBr(r.valor),
      dataVencimento: r.dataVencimento ?? hojeBrasil(),
      categoria: r.categoria || "Outros",
      recorrencia: r.recorrencia === "mensal" ? "mensal" : r.totalParcelas ? "parcelado" : "",
      totalParcelas: String(r.totalParcelas || 2),
      observacoes: r.observacoes ?? "",
    });
    setSheetAberto(true);
  }

  const save = useMutation({
    mutationFn: async () => {
      // Guarda do lado do cliente — a mesma regra do servidor, para a usuária
      // ver o erro antes de a requisição sair. Um valor negativo aqui virava
      // uma conta que DIMINUÍA o total devido e vazava para o Fluxo.
      // O texto vem em português ("99,90", "1.234,56", "R$ 1.400,00"); quem lê
      // é o mesmo parser do extrato. O servidor recebe número, como sempre.
      const vp = parseValorPositivoDigitado(form.valor);
      if (!vp.ok) throw new Error(vp.erro);
      const body: Record<string, unknown> = {
        descricao: form.descricao,
        valor: vp.valor,
        dataVencimento: form.dataVencimento,
        categoria: form.categoria,
        recorrencia: form.recorrencia === "mensal" ? "mensal" : null,
        observacoes: form.observacoes || null,
      };
      if (!editingId && form.recorrencia === "parcelado") {
        body.totalParcelas = Math.min(60, Math.max(2, Number(form.totalParcelas) || 2));
      }
      if (editingId) return api.patch(`/api/contas-pagar/${editingId}`, body);
      return api.post("/api/contas-pagar", body);
    },
    onSuccess: (res: any) => {
      if (!editingId && res?.count > 1) {
        toast.success(`${res.count} parcelas criadas`);
      } else {
        toast.success(editingId ? "Conta atualizada" : "Conta criada");
      }
      const eraNova = !editingId;
      fecharSheet();
      if (eraNova) setAba("aberto");
      refresh();
    },
    onError: (e: any) => toast.error(e.message),
  });

  async function pagar(r: any) {
    const ok = await confirmar({
      titulo: "Marcar como paga?",
      descricao: `“${r.descricao}” (${format(Number(r.valor))}) sai de Em aberto${
        r.recorrencia === "mensal" ? " e a próxima parcela do mês seguinte é criada." : "."
      }`,
      confirmar: "Marcar como paga",
    });
    if (!ok) return;
    try {
      await api.patch(`/api/contas-pagar/${r.id}`, {
        status: "pago",
        dataPagamento: hojeBrasil(),
      });
      toast.success(
        r.recorrencia === "mensal"
          ? "Marcada como paga — próxima parcela do mês seguinte criada"
          : "Marcada como paga",
      );
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function tornarMensal(r: any) {
    try {
      await api.patch(`/api/contas-pagar/${r.id}`, { recorrencia: "mensal" });
      toast.success("Agora repete todo mês (cria a próxima parcela ao marcar como paga)");
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function removerMensal(r: any) {
    try {
      await api.patch(`/api/contas-pagar/${r.id}`, { recorrencia: null });
      toast.success("Repetição mensal desligada");
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  async function excluir(r: any) {
    const ok = await confirmar({
      titulo: "Excluir conta?",
      descricao: `“${r.descricao}” (${format(Number(r.valor))}) será removida. Esta ação não pode ser desfeita.`,
      confirmar: "Excluir",
      tone: "perigo",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/contas-pagar/${r.id}`);
      toast.success("Excluída");
      if (editingId === r.id) fecharSheet();
      refresh();
    } catch (e: any) {
      toast.error(e.message);
    }
  }

  const nParcelas = Math.min(60, Math.max(2, Number(form.totalParcelas) || 2));

  /** Erro de valor mostrado embaixo do campo, enquanto se digita. */
  const erroValor = (() => {
    if (form.valor.trim() === "") return null;
    const v = parseValorPositivoDigitado(form.valor);
    return v.ok ? null : v.erro;
  })();

  /* ── Pedaços reutilizados entre tabela e cards ── */

  /**
   * Um sinal, um significado. O vermelho é alarme e só pode significar VENCIDA;
   * antes todo valor em aberto saía vermelho, inclusive uma conta que vence daqui
   * a semanas — e o alarme que toca sempre não avisa nada. Espelha statusChip().
   */
  function corValor(r: any): string {
    if (r.status === "pago") return "var(--green)";
    if (r.status === "vencido" || r.dataVencimento < hoje) return "var(--red-text)";
    if (r.dataVencimento <= limite7) return "var(--amber)";
    return "var(--text)";
  }

  function statusChip(r: any) {
    if (r.status === "pago") return <Chip tone="verde">Paga</Chip>;
    if (r.status === "vencido" || r.dataVencimento < hoje) return <Chip tone="vermelho">Vencida</Chip>;
    if (r.dataVencimento <= limite7) return <Chip tone="ambar">Vence em breve</Chip>;
    return <Chip tone="neutro">Em aberto</Chip>;
  }

  function marcadores(r: any) {
    return (
      <>
        {r.recorrencia === "mensal" && <Chip tone="accent">mensal</Chip>}
        {r.totalParcelas != null && r.parcelaAtual != null && (
          <Chip tone="neutro" className="tabular-nums">
            {r.parcelaAtual}/{r.totalParcelas}
          </Chip>
        )}
      </>
    );
  }

  function acoes(r: any, variante: "linha" | "card") {
    const emAberto = r.status === "pendente" || r.status === "vencido";
    /*
     * Quem decide o TAMANHO DO ALVO é o dedo, não a largura da janela.
     * Antes o alvo vinha da variante (card/linha), e a variante vem do
     * breakpoint: girar o celular para 844×390 continuava sendo toque, mas
     * atravessava o `md:` e derrubava os alvos de 44px para 32px.
     * Agora a base é 44px e só um ponteiro fino (mouse/trackpad) encolhe.
     * A largura continua mandando no LAYOUT — tabela ou cards.
     */
    const alvo = variante === "card" ? "size-11" : "size-11 pointer-fine:size-8";
    const iconBtn = `grid ${alvo} place-items-center rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg)]`;
    return (
      <div className={`flex items-center gap-1.5 ${variante === "linha" ? "justify-end" : ""}`}>
        {emAberto && (
          <button
            type="button"
            onClick={() => pagar(r)}
            title="Marcar como paga"
            className={`inline-flex items-center justify-center gap-1.5 rounded-lg border border-[var(--accent)] text-xs text-[var(--accent-text)] hover:bg-[var(--accent)] hover:text-[var(--on-accent)] ${
              variante === "card"
                ? // Ocupa a linha no celular; do tablet para cima ele volta ao
                  // tamanho do próprio rótulo — esticado até 625px o botão
                  // parava de parecer um botão.
                  "min-h-11 flex-1 px-3 sm:flex-none sm:px-4"
                : "min-h-11 px-3 pointer-fine:min-h-0 pointer-fine:px-2.5 pointer-fine:py-1.5"
            }`}
          >
            <Check size={14} aria-hidden />
            <span>{variante === "card" ? "Marcar como paga" : "Pagar"}</span>
          </button>
        )}
        {emAberto && r.totalParcelas == null && (
          <button
            type="button"
            onClick={() => (r.recorrencia === "mensal" ? removerMensal(r) : tornarMensal(r))}
            title={
              r.recorrencia === "mensal"
                ? "Parar repetição mensal"
                : "Repetir todo mês (cria a próxima parcela ao marcar como paga)"
            }
            aria-label={r.recorrencia === "mensal" ? "Parar repetição mensal" : "Repetir todo mês"}
            className={
              r.recorrencia === "mensal"
                ? `grid ${alvo} place-items-center rounded-lg border border-[var(--accent)] text-[var(--accent-text)] hover:bg-[var(--bg)]`
                : iconBtn
            }
          >
            <Repeat size={14} aria-hidden />
          </button>
        )}
        <button
          type="button"
          onClick={() => startEdit(r)}
          title="Editar"
          aria-label="Editar"
          className={iconBtn}
        >
          <Pencil size={14} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => excluir(r)}
          title="Excluir"
          aria-label="Excluir"
          className={`grid ${alvo} place-items-center rounded-lg border border-[var(--border)] text-[var(--red-text)] hover:bg-[var(--bg)]`}
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>
    );
  }

  const vazio = lista.length === 0;
  const semNenhuma = base.length === 0;

  return (
    <div className="space-y-3 sm:space-y-4">
      {/*
        Cabeçalho numa linha só. O <h2> "Contas a pagar" repetia, 60px abaixo,
        a aba "A Pagar" já destacada no topo do painel — dizer duas vezes a
        mesma coisa custava 52px da primeira tela do celular. Ele continua no
        DOM para leitor de tela (sr-only), e as duas ações subiram para a linha
        do número-líder.
      */}
      <div className="flex items-end justify-between gap-2">
        <div className="min-w-0">
          <h2 className="sr-only sm:not-sr-only sm:mb-1 sm:text-sm sm:font-normal sm:leading-none sm:text-[var(--text-muted)]">
            Contas a pagar
          </h2>
          {/* O maior número da tela é dinheiro, e é o dinheiro do recorte ativo
              — muda junto com chip e busca. Única aparição dessa soma.

              `overflow-wrap:anywhere`: o espaço de "R$ 1.000.000,00" é um NBSP,
              então o valor inteiro é um token indivisível. Passando de ~R$ 100
              milhões ele ficava maior que a caixa (254px) e, sem poder quebrar,
              pintava por cima de "Gerenciar categorias" a 390px. Agora quebra
              de linha em vez de invadir o botão. */}
          <p
            className="tabular-nums text-3xl sm:text-4xl font-medium leading-none [overflow-wrap:anywhere]"
            style={{ color: CORES_VALOR[toneTotal] }}
          >
            {format(totalLista)}
          </p>
          <p className="mt-1.5 truncate text-xs text-[var(--text-muted)]">{resumoLista}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={() => setGerenciarCats(true)}
            title="Gerenciar categorias"
            aria-label="Gerenciar categorias"
            className="inline-flex shrink-0 items-center justify-center gap-1.5 size-11 sm:size-auto sm:min-h-0 rounded-lg border border-[var(--border)] sm:px-3 sm:py-2 text-xs whitespace-nowrap text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card)]"
          >
            <Tags size={16} aria-hidden />
            <span className="hidden sm:inline">Gerenciar categorias</span>
          </button>
          <button
            type="button"
            onClick={abrirNova}
            title="Nova conta a pagar"
            aria-label="Nova conta a pagar"
            className="inline-flex shrink-0 items-center justify-center gap-1.5 size-11 sm:size-auto sm:min-h-0 rounded-lg bg-[var(--accent)] sm:px-4 sm:py-2 text-sm whitespace-nowrap text-[var(--on-accent)] hover:bg-[var(--accent-strong)]"
          >
            <Plus size={18} aria-hidden />
            <span className="hidden sm:inline">Nova conta</span>
          </button>
        </div>
      </div>

      {/*
        Uma fileira só: as abas (Em aberto/Pagas) e os chips-KPI eram duas
        fileiras de 44px+48px fazendo o MESMO trabalho — filtrar a mesma lista
        mostrando a contagem. Agora cada item é o par (aba, recorte).
      */}
      <KpiChips
        opcoes={opcoesFileira}
        valor={`${aba}:${`${aba}:${filtro}` === urgencia ? filtro : "todas"}`}
        onChange={(id) => {
          const o = FILEIRA.find((x) => x.id === id);
          if (!o) return;
          setAba(o.aba);
          setFiltro(o.filtro);
        }}
        ariaLabel="Filtros de contas a pagar"
      />

      {/* Busca com a largura inteira (o placeholder pede 205px e tinha 124px) +
          botão-ícone para a folha de filtro e ordenação (o <select> pedia 179px
          e tinha 114px: não dava para ler qual ordenação estava ativa). */}
      <div className="flex items-center gap-2">
        <Busca
          valor={busca}
          onChange={setBusca}
          placeholder="Buscar descrição ou categoria…"
          className="min-w-0 flex-1"
        />
        <button
          type="button"
          onClick={() => setFolhaFiltros(true)}
          title="Filtrar e ordenar"
          aria-label={`Filtrar e ordenar — ${ordensDaAba(aba).find((o) => o.id === ordem)?.label}`}
          className="relative grid size-11 shrink-0 place-items-center rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg-card)]"
          style={
            refinado
              ? { borderColor: "var(--accent)", color: "var(--accent-text)" }
              : undefined
          }
        >
          <SlidersHorizontal size={18} aria-hidden />
          {refinado && (
            <span
              aria-hidden
              className="absolute right-1.5 top-1.5 size-1.5 rounded-full"
              style={{ backgroundColor: "var(--accent)" }}
            />
          )}
        </button>
      </div>

      {/* Resultado */}
      {q.isLoading ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6 text-sm text-[var(--text-muted)]">
          Carregando contas…
        </div>
      ) : vazio ? (
        <EmptyState
          icone={<Wallet size={20} aria-hidden />}
          titulo={
            semNenhuma
              ? aba === "aberto"
                ? "Nenhuma conta em aberto"
                : "Nenhuma conta paga ainda"
              : "Nada com esses filtros"
          }
          descricao={
            semNenhuma
              ? aba === "aberto"
                ? "Cadastre a primeira conta ou importe o CSV do Gendo pela aba Fluxo."
                : "Quando você marcar uma conta como paga, ela aparece aqui."
              : "Ajuste a busca ou volte para o filtro Todas."
          }
          acao={
            semNenhuma && aba === "aberto" ? (
              <button
                type="button"
                onClick={abrirNova}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-[var(--on-accent)] hover:bg-[var(--accent-strong)]"
              >
                <Plus size={16} aria-hidden />
                Nova conta
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setFiltro("todas");
                  setBusca("");
                }}
                className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg-card)]"
              >
                Limpar filtros
              </button>
            )
          }
        />
      ) : (
        <>
          {/*
            UM ramo por vez, montado em JS.

            Os dois viviam sempre montados — 144 `<tr>` E 144 `<li>` em toda
            largura, 6.927 nós de DOM e 784KB de HTML — porque `hidden`/`block`
            só apaga o que já nasceu. `useTabela()` faz a MESMA pergunta do CSS
            (`min-width: 1024px`) antes de renderizar, e o ramo escondido deixa
            de existir.

            Tabela só a partir de 1024px, e não de 900px (nem de 768px, o `md:`
            original).

            O `md:` era uma promessa que a tabela não cumpria: com alvo de 44px
            (todo aparelho de toque) a coluna de ações sozinha pede 251px e a
            tabela inteira pede 896px de janela. Entre 768 e 895px ela ligava e
            então empurrava "Editar" e "Excluir" para FORA da tela — 0px
            visíveis a 768px — com um único aviso, uma barra de rolagem de 10px
            dentro do cartão, que no toque não existe.

            900px consertava o alcance e herdava outro problema: era exatamente
            onde a tabela tinha o PIOR ritmo. Medido a 900px, com 866px úteis,
            as colunas fixas (vencimento 105 + status 128 + categoria 88 + valor
            103 + ações 211) comem 635px e sobram 230px para a Descrição —
            contra 610px a 1280. Aí toda descrição quebra em duas linhas e as
            linhas variam de 59px a 123px (2,08x) na mesma tabela. A troca
            cartão→tabela acontecia justo onde a tabela estava pior.

            A 1024px sobram 394px para a Descrição e a variação cai para 1,03x.
            E a faixa de 768 a 1023px, que perdeu a tabela, ganhou o cartão em
            DUAS colunas (abaixo): a 900px são 8 contas em 624px de altura,
            contra 656px que a tabela gastava nas mesmas 8 — mais conta por tela
            E sem o ritmo quebrado.

            Ficou a saída (a) — cartões até 1023px — e não a (b), tirar as ações
            da linha para um menu por linha, porque (b) troca uma zona morta por
            um custo permanente: as quatro ações, em TODA largura, passariam a
            custar dois toques, que é exatamente a doença do defeito 3 (estado
            atrás de toques). Fora que um menu flutuante nasceria dentro deste
            `overflow-x-auto` e seria recortado por ele. Aqui cada ação continua
            sendo um alvo direto de 44px em qualquer largura: abaixo de 1024px
            no cartão, acima na linha.

            A largura intrínseca da tabela não depende do texto das contas: a
            coluna Descrição é limitada (line-clamp + quebra em qualquer ponto),
            então nenhuma descrição comprida pode inflá-la.
          */}
          {tabela ? (
            <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-[var(--text-muted)]">
                {/* `px-2` até 1279px, `px-3` a partir daí: os 7 pares de
                    respiro custam 168px de largura, e abaixo de 1280 essa
                    largura vale mais na Descrição do que nas beiradas — são
                    56px que saem das colunas fixas e entram na única elástica. */}
                <tr className="border-b border-[var(--border)]">
                  <th className="px-2 min-[1280px]:px-3 py-2.5 font-normal">Vencimento</th>
                  <th className="px-2 min-[1280px]:px-3 py-2.5 font-normal">Status</th>
                  {/* `w-full`: a Descrição é a coluna elástica — fica com toda a
                      sobra em vez de ser espremida ao mínimo. */}
                  <th className="w-full px-2 min-[1280px]:px-3 py-2.5 font-normal">Descrição</th>
                  <th className="px-2 min-[1280px]:px-3 py-2.5 font-normal">Categoria</th>
                  {aba === "pagas" && (
                    <th className="px-2 min-[1280px]:px-3 py-2.5 font-normal">Pagamento</th>
                  )}
                  <th className="px-2 min-[1280px]:px-3 py-2.5 font-normal text-right">Valor</th>
                  <th className="px-2 min-[1280px]:px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {visiveis.map((r) => {
                  const vencida = r.status !== "pago" && (r.status === "vencido" || r.dataVencimento < hoje);
                  return (
                    <tr
                      key={r.id}
                      className="border-t border-[var(--border)] align-middle"
                      style={
                        vencida
                          ? { backgroundColor: "color-mix(in srgb, var(--red) 6%, transparent)" }
                          : undefined
                      }
                    >
                      <td
                        className="px-2 min-[1280px]:px-3 py-2.5 tabular-nums whitespace-nowrap border-l-2"
                        style={{
                          borderLeftColor: vencida ? "var(--red)" : "transparent",
                          color: vencida ? "var(--red-text)" : undefined,
                        }}
                      >
                        {formatDateBR(r.dataVencimento)}
                      </td>
                      <td className="px-2 min-[1280px]:px-3 py-2.5">{statusChip(r)}</td>
                      {/*
                        Descrição limitada a 2 linhas. Sem limite, uma descrição
                        de 300 caracteres esticava esta linha para 501px de
                        altura (a linha normal tem 65px) e, como a célula é a
                        única elástica da tabela, era ela quem definia a largura
                        intrínseca da tabela inteira. O texto completo continua
                        acessível: `title` no ponteiro e, no toque, o campo
                        Descrição da folha de edição.
                      */}
                      <td className="px-2 min-[1280px]:px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span
                            className="line-clamp-2 [overflow-wrap:anywhere] text-[var(--text)]"
                            title={r.descricao}
                          >
                            {r.descricao}
                          </span>
                          {marcadores(r)}
                        </div>
                        {/*
                          A observação vale UMA linha abaixo de 1280px e duas a
                          partir daí. Medido a 1024px com as 143 contas: 121
                          linhas de 59px, e 18 de 75 a 79px — todas as altas são
                          uma observação importada que quebra em duas linhas.
                          Uma nota de rodapé decidindo o ritmo da tabela inteira
                          é a nota mandando na conta; o texto completo continua
                          no `title` e na folha de edição. */}
                        {r.observacoes && (
                          <p
                            className="mt-0.5 line-clamp-1 min-[1280px]:line-clamp-2 [overflow-wrap:anywhere] text-xs text-[var(--text-muted)]"
                            title={r.observacoes}
                          >
                            {r.observacoes}
                          </p>
                        )}
                      </td>
                      <td className="px-2 min-[1280px]:px-3 py-2.5 text-[var(--text-muted)]">
                        {r.categoria || "—"}
                      </td>
                      {aba === "pagas" && (
                        <td className="px-2 min-[1280px]:px-3 py-2.5 tabular-nums whitespace-nowrap text-[var(--text-muted)]">
                          {r.dataPagamento ? formatDateBR(r.dataPagamento) : "—"}
                        </td>
                      )}
                      <td
                        className="px-2 min-[1280px]:px-3 py-2.5 text-right tabular-nums whitespace-nowrap font-semibold"
                        style={{ color: corValor(r) }}
                      >
                        {format(Number(r.valor))}
                      </td>
                      <td className="px-2 min-[1280px]:px-3 py-2.5">{acoes(r, "linha")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
          ) : (
          /*
            Toque e janelas estreitas (< 1024px): lista de cartões.

            DUAS colunas a partir de 768px. Em uma coluna só, o mesmo cartão que
            está certo a 390px (358px de largura, vão de tinta nome→valor de
            195px na mediana, 54% do cartão) esticava até 802px num iPad de 834
            e o vão virava 639px — 80% do cartão de tinta nenhuma entre o nome
            da conta e o seu valor, e 362px entre o estado e os botões. O olho
            perdia a ligação que a tabela mostra sozinha. Em duas colunas o
            cartão volta para 397px a 834 e 364px a 768, que é a proporção do
            celular, e a largura que sobrava vira uma SEGUNDA conta na tela em
            vez de vão.

            768 e não 640: as ações do cartão são 309px fixos (alvos de 44px em
            qualquer ponteiro, de propósito) mais 24px de respiro, então nenhum
            cartão desta grade pode ter menos que 333px. A 640px cada coluna
            teria 300px e o botão Excluir sairia para fora da borda; a 768px
            cada uma tem 364px.
          */
          <ul className="grid grid-cols-1 min-[768px]:grid-cols-2 gap-2">
            {visiveis.map((r) => {
              const vencida = r.status !== "pago" && (r.status === "vencido" || r.dataVencimento < hoje);
              return (
                <li
                  key={r.id}
                  className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3 border-l-2"
                  style={{
                    borderLeftColor: vencida ? "var(--red)" : "var(--border)",
                    backgroundColor: vencida
                      ? "color-mix(in srgb, var(--red) 5%, var(--bg-card))"
                      : undefined,
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      {/*
                        Duas linhas, no máximo. Sem limite, uma descrição de 300
                        caracteres virava um cartão de 330px num celular de
                        390×844 (o cartão normal tem 150px): quase 40% da tela
                        para UMA conta, e a data, o status e o valor eram
                        empurrados para longe do nome que descrevem. O texto
                        inteiro fica no `title` e na folha de edição.
                      */}
                      <p
                        className="line-clamp-2 [overflow-wrap:anywhere] text-sm text-[var(--text)]"
                        title={r.descricao}
                      >
                        {r.descricao}
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                        <span className="tabular-nums" style={vencida ? { color: "var(--red-text)" } : undefined}>
                          Vence {formatDateBR(r.dataVencimento)}
                        </span>
                        {" · "}
                        {r.categoria || "sem categoria"}
                      </p>
                    </div>
                    {/* O dinheiro é o maior texto do card — maior que a descrição e
                        muito maior que o rótulo do botão. */}
                    <p
                      className="tabular-nums text-xl font-semibold leading-tight whitespace-nowrap"
                      style={{ color: corValor(r) }}
                    >
                      {format(Number(r.valor))}
                    </p>
                  </div>
                  {/*
                    Estado e ações empilham SEMPRE — é a única forma que cabe em
                    todo cartão desta grade.

                    Eles dividiam uma linha a partir de 640px, regra herdada de
                    quando o cartão ocupava a janela inteira e tinha 736px para
                    gastar. Numa grade de duas colunas a mesma janela dá 364px
                    por cartão, e as ações do cartão são 309px fixos (os alvos
                    são de 44px em qualquer ponteiro, de propósito): sobram 31px
                    para o chip de estado, que sozinho pede 74px, e com o chip
                    "mensal" junto pede 104px. Medido a 900px, lado a lado, o
                    botão Excluir saía 9px para FORA da borda do cartão.
                    Empilhado cabe folgado em qualquer largura, e a altura que
                    isso custa a segunda coluna devolve dobrada.
                  */}
                  <div className="mt-2 flex flex-col gap-3">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {statusChip(r)}
                      {marcadores(r)}
                      {aba === "pagas" && r.dataPagamento && (
                        <span className="text-xs text-[var(--text-muted)] tabular-nums">
                          pago em {formatDateBR(r.dataPagamento)}
                        </span>
                      )}
                    </div>
                    <div>{acoes(r, "card")}</div>
                  </div>
                </li>
              );
            })}
          </ul>
          )}

          {/*
            O teto da lista, dito por extenso.

            A aba Pagas tem 143 contas: desenhadas de uma vez são 17.724px de
            rolagem num iPad de 834px — a conta paga hoje ficava a 17.229px do
            topo. O teto não é um filtro escondido: o número-líder e o resumo
            acima continuam somando e contando a lista INTEIRA, e esta linha diz
            quantas estão na tela, quantas faltam e traz o próximo lote no
            mesmo toque. Quando falta menos de um lote, o botão promete o número
            exato e acaba com a lista.
          */}
          {ocultas > 0 && (
            <div className="flex flex-col items-center gap-2 pt-1">
              <p className="text-xs text-[var(--text-muted)] tabular-nums">
                Mostrando {visiveis.length} de {lista.length}
              </p>
              <button
                type="button"
                onClick={() => setTeto((t) => t + LOTE)}
                className="min-h-11 w-full rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg-card)] sm:w-auto"
              >
                {ocultas <= LOTE
                  ? `Mostrar as últimas ${ocultas}`
                  : `Mostrar mais ${LOTE} (faltam ${ocultas})`}
              </button>
            </div>
          )}
        </>
      )}

      {/* Folha de filtro e ordenação — herdou o que não cabia na fileira */}
      <Sheet
        open={folhaFiltros}
        onClose={() => setFolhaFiltros(false)}
        titulo="Filtrar e ordenar"
        descricao={aba === "aberto" ? "Contas em aberto" : "Contas pagas"}
        footer={
          <div className="flex justify-between gap-2">
            <button
              type="button"
              onClick={() => {
                setFiltro("todas");
                setOrdem(ORDEM_PADRAO[aba]);
              }}
              disabled={!refinado}
              className="min-h-11 rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg-card)] disabled:opacity-40"
            >
              Limpar
            </button>
            <button
              type="button"
              onClick={() => setFolhaFiltros(false)}
              className="min-h-11 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-[var(--on-accent)] hover:bg-[var(--accent-strong)]"
            >
              Ver {lista.length} {lista.length === 1 ? "conta" : "contas"}
            </button>
          </div>
        }
      >
        <div className="space-y-5">
          {opcoesSecundarias.length > 0 && (
            <fieldset>
              <legend className="text-xs text-[var(--text-muted)]">Recorte</legend>
              <div className="mt-2 space-y-1">
                {[{ id: "todas" as FiltroChip, label: "Todas", count: base.length }]
                  .concat(opcoesSecundarias)
                  .map((o) => (
                    <label
                      key={o.id}
                      className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm text-[var(--text)] hover:bg-[var(--bg-card)]"
                    >
                      <input
                        type="radio"
                        name="recorte-contas-pagar"
                        className="accent-[var(--accent)]"
                        checked={filtro === o.id}
                        onChange={() => setFiltro(o.id as FiltroChip)}
                      />
                      <span className="flex-1">{o.label}</span>
                      <span className="tabular-nums text-xs text-[var(--text-muted)]">
                        {o.count}
                      </span>
                    </label>
                  ))}
              </div>
            </fieldset>
          )}

          <fieldset>
            <legend className="text-xs text-[var(--text-muted)]">Ordenar por</legend>
            <div className="mt-2 space-y-1">
              {ordensDaAba(aba).map((o) => (
                <label
                  key={o.id}
                  className="flex min-h-11 cursor-pointer items-center gap-3 rounded-lg px-2 text-sm text-[var(--text)] hover:bg-[var(--bg-card)]"
                >
                  <input
                    type="radio"
                    name="ordem-contas-pagar"
                    className="accent-[var(--accent)]"
                    checked={ordem === o.id}
                    onChange={() => setOrdem(o.id)}
                  />
                  <span>{o.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
        </div>
      </Sheet>

      {/* Sheet de criar/editar */}
      <Sheet
        open={sheetAberto}
        onClose={fecharSheet}
        titulo={editingId ? "Editar conta a pagar" : "Nova conta a pagar"}
        descricao={
          editingId
            ? "As alterações valem só para esta conta."
            : "Uma vez, todo mês ou parcelado — você escolhe abaixo."
        }
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={fecharSheet}
              className="min-h-11 rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg-card)]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="form-conta-pagar"
              disabled={save.isPending || !!erroValor}
              className="min-h-11 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-[var(--on-accent)] hover:bg-[var(--accent-strong)] disabled:opacity-50"
            >
              {save.isPending ? "Salvando…" : editingId ? "Salvar" : "Adicionar"}
            </button>
          </div>
        }
      >
        <form
          id="form-conta-pagar"
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div>
            <label className="text-xs text-[var(--text-muted)]" htmlFor="cp-descricao">
              Descrição
            </label>
            <input
              id="cp-descricao"
              required
              className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              placeholder="Ex.: Aluguel sala"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-muted)]" htmlFor="cp-valor">
                Valor
              </label>
              {/* Campo de texto, não `type="number"`: quem digita "99,90" num
                  teclado brasileiro gravava R$ 9.990,00. Zero e negativo
                  continuam recusados aqui e no servidor — o que mudou é só
                  quem sabe LER o que foi escrito. */}
              <InputDecimalBr
                id="cp-valor"
                required
                placeholder="Ex.: 99,90"
                aria-describedby="cp-valor-erro"
                aria-invalid={!!erroValor}
                className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm tabular-nums"
                value={form.valor}
                onChange={(valor) => setForm({ ...form, valor })}
              />
              {erroValor && (
                <p id="cp-valor-erro" className="mt-1 text-xs text-[var(--red-text)]">
                  {erroValor}
                </p>
              )}
            </div>
            <div>
              <label className="text-xs text-[var(--text-muted)]" htmlFor="cp-venc">
                Vencimento
              </label>
              <input
                id="cp-venc"
                type="date"
                required
                className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
                value={form.dataVencimento}
                onChange={(e) => setForm({ ...form, dataVencimento: e.target.value })}
              />
            </div>
          </div>

          <div>
            <label className="text-xs text-[var(--text-muted)]" htmlFor="cp-categoria">
              Categoria
            </label>
            <select
              id="cp-categoria"
              className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              value={form.categoria}
              onChange={(e) => setForm({ ...form, categoria: e.target.value })}
            >
              {categoriasOpts.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-muted)]" htmlFor="cp-recorrencia">
                Recorrência
              </label>
              <select
                id="cp-recorrencia"
                className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm disabled:opacity-50"
                value={form.recorrencia}
                onChange={(e) =>
                  setForm({ ...form, recorrencia: e.target.value as "" | "mensal" | "parcelado" })
                }
                disabled={!!editingId && form.recorrencia === "parcelado"}
              >
                <option value="">Única vez</option>
                <option value="mensal">Todo mês</option>
                {(!editingId || form.recorrencia === "parcelado") && (
                  <option value="parcelado">Parcelado</option>
                )}
              </select>
            </div>
            {form.recorrencia === "parcelado" && !editingId && (
              <div>
                <label className="text-xs text-[var(--text-muted)]" htmlFor="cp-parcelas">
                  Nº de parcelas
                </label>
                <input
                  id="cp-parcelas"
                  type="number"
                  min={2}
                  max={60}
                  required
                  className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm tabular-nums"
                  value={form.totalParcelas}
                  onChange={(e) => setForm({ ...form, totalParcelas: e.target.value })}
                />
              </div>
            )}
          </div>

          {form.recorrencia === "mensal" && (
            <p className="text-xs text-[var(--text-muted)]">
              Mensal: ao marcar como paga, o sistema cria automaticamente a próxima parcela no mês
              seguinte (ex.: aluguel).
            </p>
          )}
          {form.recorrencia === "parcelado" && !editingId && (
            <p className="text-xs text-[var(--text-muted)]">
              Parcelado: cria {nParcelas} contas com o mesmo valor, vencendo a cada mês a partir da
              data informada (ex.: 1/{nParcelas}, 2/{nParcelas}…).
            </p>
          )}

          <div>
            <label className="text-xs text-[var(--text-muted)]" htmlFor="cp-obs">
              Observações
            </label>
            <input
              id="cp-obs"
              className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              value={form.observacoes}
              onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              placeholder="Opcional"
            />
          </div>
        </form>
      </Sheet>

      {gerenciarCats && <GerenciarCategoriasModal onClose={() => setGerenciarCats(false)} />}
    </div>
  );
}

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, HandCoins, Pencil, Plus, Repeat, Trash2, User } from "lucide-react";
import { api } from "@/lib/api";
import { useMoney } from "@/lib/hide-values";
import { formatDateBR } from "@/lib/formatters";
import { hojeBrasil } from "@/lib/date";
import { estadoVencimento, rotuloAtraso } from "@shared/vencimento";
import { contemBusca } from "@shared/texto";
import { ordenarContas } from "@shared/contas-recorte";
import { parseValorPositivoDigitado } from "@shared/valor";
import { InputDecimalBr, paraCampoDecimalBr } from "@/components/ui/input-decimal-br";
import Chip from "@/components/ui/chip";
import FilterChips, { type FiltroOpcao } from "@/components/ui/filter-chips";
import KpiCard from "@/components/ui/kpi";
import Sheet from "@/components/ui/sheet";
import EmptyState from "@/components/ui/empty-state";
import Busca from "@/components/ui/busca";
import { useConfirmar } from "@/components/ui/confirmar";

type FiltroAba = "aberto" | "recebidos";
type FiltroChip = "todos" | "vencidos" | "prox7" | "mes";
type Ordem = "venc-asc" | "venc-desc" | "valor-desc" | "valor-asc";

const emptyForm = () => ({
  clienteNome: "",
  descricao: "",
  valor: "",
  dataVencimento: hojeBrasil(),
  recorrencia: "" as "" | "mensal" | "parcelado",
  totalParcelas: "3",
  observacoes: "",
  dataPagamento: "",
  valorPago: "",
});

/** Soma "valor" (string decimal do Postgres) de uma lista de recebíveis. */
function soma(rows: any[]): number {
  return rows.reduce((acc, r) => acc + Number(r.valor || 0), 0);
}

/** Soma o que efetivamente entrou no caixa (valorPago quando existir). */
function somaRecebida(rows: any[]): number {
  return rows.reduce(
    (acc, r) => acc + (r.status === "paga" ? Number(r.valorPago ?? r.valor ?? 0) : 0),
    0,
  );
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

const ORDENS: { id: Ordem; label: string }[] = [
  { id: "venc-asc", label: "Vencimento (mais próximo)" },
  { id: "venc-desc", label: "Vencimento (mais distante)" },
  { id: "valor-desc", label: "Valor (maior primeiro)" },
  { id: "valor-asc", label: "Valor (menor primeiro)" },
];

export default function ContasReceberTab() {
  const { format } = useMoney();
  const qc = useQueryClient();
  const confirmar = useConfirmar();

  const [aba, setAba] = useState<FiltroAba>("aberto");
  const [filtro, setFiltro] = useState<FiltroChip>("todos");
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<Ordem>("venc-asc");
  const [sheetAberto, setSheetAberto] = useState(false);
  const [editando, setEditando] = useState<any | null>(null);
  const [form, setForm] = useState(emptyForm);

  const q = useQuery({
    queryKey: ["recebiveis"],
    queryFn: () => api.get<any[]>("/api/recebiveis"),
  });

  const hoje = hojeBrasil();
  const limite7 = addDiasISO(hoje, 7);
  const mesAtual = hoje.slice(0, 7);

  const rows = q.data ?? [];
  const abertos = useMemo(() => rows.filter((r) => r.status === "aberta"), [rows]);
  const recebidos = useMemo(() => rows.filter((r) => r.status !== "aberta"), [rows]);

  /* ── KPIs (sempre sobre o universo em aberto, não sobre o filtro) ── */
  const vencidos = useMemo(
    () => abertos.filter((r) => r.dataVencimento < hoje),
    [abertos, hoje],
  );
  const prox7 = useMemo(
    () => abertos.filter((r) => r.dataVencimento >= hoje && r.dataVencimento <= limite7),
    [abertos, hoje, limite7],
  );

  /* ── Lista visível: aba → chip → busca → ordenação ── */
  const base = aba === "aberto" ? abertos : recebidos;

  const contagemChips = useMemo(() => {
    return {
      todos: base.length,
      vencidos: base.filter((r) => r.dataVencimento < hoje).length,
      prox7: base.filter((r) => r.dataVencimento >= hoje && r.dataVencimento <= limite7).length,
      // Na aba "Recebidos", "este mês" é RECEBIDO este mês. Mesmo defeito da
      // aba Pagas de contas a pagar, fechado aqui também.
      mes: base.filter((r) =>
        String((aba === "recebidos" ? r.dataPagamento : r.dataVencimento) ?? "").startsWith(
          mesAtual,
        ),
      ).length,
    } as Record<FiltroChip, number>;
  }, [aba, base, hoje, limite7, mesAtual]);

  const opcoesChips: FiltroOpcao[] = useMemo(() => {
    const todos: { id: FiltroChip; label: string }[] = [
      { id: "todos", label: "Todos" },
      { id: "vencidos", label: "Vencidos" },
      { id: "prox7", label: "Recebe em 7 dias" },
      { id: "mes", label: aba === "recebidos" ? "Recebido este mês" : "Vence este mês" },
    ];
    // Vencido/próximos 7 dias não fazem sentido na aba Recebidos.
    const visiveis =
      aba === "recebidos" ? todos.filter((o) => o.id !== "vencidos" && o.id !== "prox7") : todos;
    return visiveis.map((o) => ({ ...o, count: contagemChips[o.id] }));
  }, [aba, contagemChips]);

  // Se o chip ativo sumiu ao trocar de aba, volta para "Todos".
  useEffect(() => {
    if (!opcoesChips.some((o) => o.id === filtro)) setFiltro("todos");
  }, [opcoesChips, filtro]);

  const lista = useMemo(() => {
    let out = base;
    if (filtro === "vencidos") {
      out = out.filter((r) => r.dataVencimento < hoje);
    } else if (filtro === "prox7") {
      out = out.filter((r) => r.dataVencimento >= hoje && r.dataVencimento <= limite7);
    } else if (filtro === "mes") {
      out = out.filter((r) =>
        String((aba === "recebidos" ? r.dataPagamento : r.dataVencimento) ?? "").startsWith(
          mesAtual,
        ),
      );
    }

    // Mesma normalização de acento do resto do app (@shared/texto).
    if (busca.trim()) {
      out = out.filter((r) =>
        contemBusca(`${r.clienteNome ?? ""} ${r.descricao ?? ""} ${r.observacoes ?? ""}`, busca),
      );
    }

    // Desempate por id em todas as ordens (@shared/contas-recorte).
    return ordenarContas(out, ordem);
  }, [aba, base, filtro, busca, ordem, hoje, limite7, mesAtual]);

  function refresh() {
    qc.invalidateQueries({ queryKey: ["recebiveis"] });
    qc.invalidateQueries({ queryKey: ["fluxo"] });
  }

  function fecharSheet() {
    setSheetAberto(false);
    setEditando(null);
    setForm(emptyForm());
  }

  function abrirNovo() {
    setEditando(null);
    setForm(emptyForm());
    setSheetAberto(true);
  }

  function startEdit(r: any) {
    setEditando(r);
    setForm({
      clienteNome: r.clienteNome ?? "",
      descricao: r.descricao ?? "",
      valor: paraCampoDecimalBr(r.valor),
      dataVencimento: r.dataVencimento ?? hojeBrasil(),
      recorrencia: r.recorrencia === "mensal" ? "mensal" : r.totalParcelas ? "parcelado" : "",
      totalParcelas: String(r.totalParcelas || 3),
      observacoes: r.observacoes ?? "",
      dataPagamento: r.dataPagamento ?? "",
      valorPago: paraCampoDecimalBr(r.valorPago),
    });
    setSheetAberto(true);
  }

  /** Nº de parcelas efetivo do formulário (2..60). */
  const nParcelas = Math.min(60, Math.max(2, Number(form.totalParcelas) || 2));

  /**
   * Erro de valor mostrado embaixo do campo, enquanto se digita — igual a
   * A Pagar. Antes o único aviso vinha depois de o formulário ser enviado.
   */
  const valorLido = parseValorPositivoDigitado(form.valor);
  const erroValor = form.valor.trim() === "" || valorLido.ok ? null : valorLido.erro;
  const erroValorPago = (() => {
    if (form.valorPago.trim() === "") return null;
    const v = parseValorPositivoDigitado(form.valorPago);
    return v.ok ? null : v.erro;
  })();

  const save = useMutation({
    mutationFn: async () => {
      // Mesma guarda de contas a pagar: recebível negativo inflaria o saldo
      // projetado do Fluxo para o lado errado.
      // Texto em português ("99,90", "1.234,56"): lido pelo mesmo parser do
      // extrato. O corpo da requisição continua saindo com número.
      const vp = parseValorPositivoDigitado(form.valor);
      if (!vp.ok) throw new Error(vp.erro);
      let valorPagoNum: number | null = null;
      if (form.valorPago.trim() !== "") {
        const vpg = parseValorPositivoDigitado(form.valorPago);
        if (!vpg.ok) throw new Error(`Valor recebido: ${vpg.erro.toLowerCase()}`);
        valorPagoNum = vpg.valor;
      }
      const body: Record<string, unknown> = {
        clienteNome: form.clienteNome.trim(),
        descricao: form.descricao.trim() || null,
        valor: vp.valor,
        dataVencimento: form.dataVencimento,
        recorrencia: form.recorrencia === "mensal" ? "mensal" : null,
        observacoes: form.observacoes.trim() || null,
      };
      if (!editando && form.recorrencia === "parcelado") {
        body.totalParcelas = nParcelas;
      }
      if (editando) {
        // Só quando já foi recebido: o Sheet expõe o que entrou no caixa.
        if (editando.status === "paga") {
          body.dataPagamento = form.dataPagamento || null;
          body.valorPago = valorPagoNum;
        }
        return api.patch(`/api/recebiveis/${editando.id}`, body);
      }
      return api.post("/api/recebiveis", body);
    },
    onSuccess: (res: any) => {
      if (!editando && res?.count > 1) {
        toast.success(`${res.count} parcelas criadas`);
      } else {
        toast.success(editando ? "A receber atualizado" : "A receber criado");
      }
      const eraNovo = !editando;
      fecharSheet();
      if (eraNovo) setAba("aberto");
      refresh();
    },
    onError: (e: any) => toast.error(e.message),
  });

  async function receber(r: any) {
    const ok = await confirmar({
      titulo: "Marcar como recebido?",
      descricao: `“${r.clienteNome}” (${format(Number(r.valor))}) sai de Em aberto e entra no caixa${
        r.recorrencia === "mensal" ? " e o recebimento do mês seguinte é criado." : "."
      }`,
      confirmar: "Marcar como recebido",
    });
    if (!ok) return;
    try {
      await api.patch(`/api/recebiveis/${r.id}`, {
        status: "paga",
        dataPagamento: hojeBrasil(),
        valorPago: r.valor,
      });
      toast.success(
        r.recorrencia === "mensal"
          ? "Marcado como recebido — recebimento do mês seguinte criado"
          : "Marcado como recebido",
      );
      refresh();
    } catch (e: any) {
      toast.error(e.message || "Não foi possível marcar como recebido");
    }
  }

  async function tornarMensal(r: any) {
    try {
      await api.patch(`/api/recebiveis/${r.id}`, { recorrencia: "mensal" });
      toast.success("Agora repete todo mês (cria o próximo ao marcar como recebido)");
      refresh();
    } catch (e: any) {
      toast.error(e.message || "Não foi possível ligar a repetição");
    }
  }

  async function removerMensal(r: any) {
    try {
      await api.patch(`/api/recebiveis/${r.id}`, { recorrencia: null });
      toast.success("Repetição mensal desligada");
      refresh();
    } catch (e: any) {
      toast.error(e.message || "Não foi possível desligar a repetição");
    }
  }

  async function excluir(r: any) {
    const ok = await confirmar({
      titulo: "Excluir a receber?",
      descricao: `“${r.clienteNome}” (${format(Number(r.valor))}) será removido. Esta ação não pode ser desfeita.`,
      confirmar: "Excluir",
      tone: "perigo",
    });
    if (!ok) return;
    try {
      await api.delete(`/api/recebiveis/${r.id}`);
      toast.success("Excluído");
      if (editando?.id === r.id) fecharSheet();
      refresh();
    } catch (e: any) {
      toast.error(e.message || "Não foi possível excluir");
    }
  }

  /* ── Pedaços reutilizados entre tabela e cards ── */

  function statusChip(r: any) {
    if (r.status === "paga") return <Chip tone="verde">Recebido</Chip>;
    if (r.status !== "aberta") return <Chip tone="neutro">{String(r.status)}</Chip>;
    switch (estadoVencimento(r.dataVencimento, hoje)) {
      case "vencido":
        return <Chip tone="vermelho">Vencido</Chip>;
      case "hoje":
        return (
          <Chip tone="ambar" forte>
            Recebe hoje
          </Chip>
        );
      case "breve":
        return <Chip tone="ambar">Recebe em breve</Chip>;
      default:
        return <Chip tone="neutro">Em aberto</Chip>;
    }
  }

  /** Chips de recorrência/parcela — mesma leitura de Contas a pagar. */
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
    const emAberto = r.status === "aberta";
    const iconBtn =
      "grid size-8 place-items-center rounded-lg border border-[var(--border)] text-[var(--text-muted)] hover:text-[var(--text)] hover:bg-[var(--bg)]";
    return (
      <div className={`flex items-center gap-1.5 ${variante === "linha" ? "justify-end" : ""}`}>
        {emAberto && (
          <button
            type="button"
            onClick={() => receber(r)}
            title="Marcar como recebido"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--accent)] px-2.5 py-1.5 text-xs text-[var(--accent-text)] hover:bg-[var(--accent)] hover:text-[var(--on-accent)]"
          >
            <Check size={14} aria-hidden />
            <span>{variante === "card" ? "Marcar como recebido" : "Receber"}</span>
          </button>
        )}
        {emAberto && r.totalParcelas == null && (
          <button
            type="button"
            onClick={() => (r.recorrencia === "mensal" ? removerMensal(r) : tornarMensal(r))}
            title={
              r.recorrencia === "mensal"
                ? "Parar repetição mensal"
                : "Repetir todo mês (cria o próximo ao marcar como recebido)"
            }
            aria-label={r.recorrencia === "mensal" ? "Parar repetição" : "Repetir todo mês"}
            className={
              r.recorrencia === "mensal"
                ? "grid size-8 place-items-center rounded-lg border border-[var(--accent)] text-[var(--accent-text)] hover:bg-[var(--bg)]"
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
          className="grid size-8 place-items-center rounded-lg border border-[var(--border)] text-[var(--red-text)] hover:bg-[var(--bg)]"
        >
          <Trash2 size={14} aria-hidden />
        </button>
      </div>
    );
  }

  const vazio = lista.length === 0;
  const semNenhum = base.length === 0;

  return (
    <div className="space-y-4">
      {/* Cabeçalho: título curto + uma ação primária */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-medium text-[var(--text)]">Contas a receber</h2>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={abrirNovo}
            className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-[var(--on-accent)] hover:bg-[var(--accent-strong)]"
          >
            <Plus size={16} aria-hidden />
            Novo a receber
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-3 sm:grid-cols-3">
        <KpiCard count={abertos.length} label="Total a receber" valor={format(soma(abertos))} />
        <KpiCard
          count={vencidos.length}
          label="Vencidos"
          valor={format(soma(vencidos))}
          tone={vencidos.length > 0 ? "vermelho" : "neutro"}
        />
        <KpiCard
          count={prox7.length}
          label="Recebe em 7 dias"
          valor={format(soma(prox7))}
          tone={prox7.length > 0 ? "accent" : "neutro"}
        />
      </div>

      {/* Abas com contagem e soma */}
      <div className="flex flex-wrap gap-1 border-b border-[var(--border)]">
        {(
          [
            { id: "aberto" as const, label: "Em aberto", total: soma(abertos), n: abertos.length },
            {
              id: "recebidos" as const,
              label: "Recebidos",
              total: somaRecebida(recebidos),
              n: recebidos.length,
            },
          ]
        ).map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setAba(t.id)}
            aria-current={aba === t.id ? "true" : undefined}
            className={`px-4 py-2 text-sm whitespace-nowrap border-b-2 -mb-px transition-colors ${
              aba === t.id
                ? "border-[var(--accent)] text-[var(--text)]"
                : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
            }`}
          >
            {t.label}
            <span className="ml-1.5 text-xs tabular-nums text-[var(--text-muted)]">
              {t.n} · {format(t.total)}
            </span>
          </button>
        ))}
      </div>

      {/* Filtros + busca + ordenação */}
      <div className="space-y-3">
        <FilterChips
          opcoes={opcoesChips}
          valor={filtro}
          onChange={(id) => setFiltro(id as FiltroChip)}
          ariaLabel="Filtros de contas a receber"
        />
        <div className="flex items-center gap-2">
          <Busca
            valor={busca}
            onChange={setBusca}
            placeholder="Buscar por cliente ou descrição…"
            className="flex-1 sm:max-w-md"
          />
          <label className="sr-only" htmlFor="ordem-contas-receber">
            Ordenar por
          </label>
          <select
            id="ordem-contas-receber"
            value={ordem}
            onChange={(e) => setOrdem(e.target.value as Ordem)}
            className="shrink-0 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm text-[var(--text)]"
          >
            {ORDENS.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Resultado */}
      {q.isLoading ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-6 text-sm text-[var(--text-muted)]">
          Carregando valores a receber…
        </div>
      ) : vazio ? (
        <EmptyState
          icone={<HandCoins size={20} aria-hidden />}
          titulo={
            semNenhum
              ? aba === "aberto"
                ? "Nenhum valor a receber em aberto"
                : "Nada recebido ainda"
              : "Nada com esses filtros"
          }
          descricao={
            semNenhum
              ? aba === "aberto"
                ? "Cadastre o primeiro valor que um cliente ou convênio ainda vai pagar."
                : "Quando você marcar um valor como recebido, ele aparece aqui."
              : "Ajuste a busca ou volte para o filtro Todos."
          }
          acao={
            semNenhum && aba === "aberto" ? (
              <button
                type="button"
                onClick={abrirNovo}
                className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-[var(--on-accent)] hover:bg-[var(--accent-strong)]"
              >
                <Plus size={16} aria-hidden />
                Novo a receber
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setFiltro("todos");
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
          {/* Desktop: tabela enxuta */}
          <div className="hidden md:block rounded-xl border border-[var(--border)] bg-[var(--bg-card)] overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-[var(--text-muted)]">
                <tr className="border-b border-[var(--border)]">
                  <th className="px-3 py-2.5 font-normal">Vencimento</th>
                  <th className="px-3 py-2.5 font-normal">Status</th>
                  <th className="px-3 py-2.5 font-normal">Cliente</th>
                  <th className="px-3 py-2.5 font-normal">Descrição</th>
                  {aba === "recebidos" && (
                    <th className="px-3 py-2.5 font-normal">Recebimento</th>
                  )}
                  <th className="px-3 py-2.5 font-normal text-right">Valor</th>
                  <th className="px-3 py-2.5" />
                </tr>
              </thead>
              <tbody>
                {lista.map((r) => {
                  const vencido = r.status === "aberta" && r.dataVencimento < hoje;
                  const atraso = vencido ? rotuloAtraso(r.dataVencimento, hoje) : null;
                  return (
                    <tr
                      key={r.id}
                      className="border-t border-[var(--border)] align-middle"
                      style={
                        vencido
                          ? { backgroundColor: "color-mix(in srgb, var(--red) 6%, transparent)" }
                          : undefined
                      }
                    >
                      <td
                        className="px-3 py-2.5 tabular-nums whitespace-nowrap border-l-2"
                        style={{
                          borderLeftColor: vencido ? "var(--red)" : "transparent",
                          color: vencido ? "var(--red-text)" : undefined,
                        }}
                      >
                        {formatDateBR(r.dataVencimento)}
                        {atraso && (
                          <span className="mt-0.5 block text-[11px] font-normal text-[var(--red-text)]">
                            {atraso}
                          </span>
                        )}
                      </td>
                      <td className="px-3 py-2.5">{statusChip(r)}</td>
                      <td className="px-3 py-2.5">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="inline-flex items-center gap-1.5 text-[var(--text)]">
                            <User size={14} aria-hidden className="text-[var(--text-muted)]" />
                            {r.clienteNome}
                          </span>
                          {marcadores(r)}
                        </div>
                        {r.observacoes && (
                          <p className="mt-0.5 text-xs text-[var(--text-muted)]">{r.observacoes}</p>
                        )}
                      </td>
                      <td className="px-3 py-2.5 text-[var(--text-muted)]">{r.descricao || "—"}</td>
                      {aba === "recebidos" && (
                        <td className="px-3 py-2.5 tabular-nums whitespace-nowrap text-[var(--text-muted)]">
                          {r.dataPagamento ? formatDateBR(r.dataPagamento) : "—"}
                        </td>
                      )}
                      <td
                        className="px-3 py-2.5 text-right tabular-nums whitespace-nowrap font-medium"
                        style={{ color: r.status === "paga" ? "var(--green)" : undefined }}
                      >
                        {format(
                          r.status === "paga"
                            ? Number(r.valorPago ?? r.valor)
                            : Number(r.valor),
                        )}
                      </td>
                      <td className="px-3 py-2.5">{acoes(r, "linha")}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {/* Mobile: lista de cards */}
          <ul className="md:hidden space-y-2">
            {lista.map((r) => {
              const vencido = r.status === "aberta" && r.dataVencimento < hoje;
              const atraso = vencido ? rotuloAtraso(r.dataVencimento, hoje) : null;
              return (
                <li
                  key={r.id}
                  className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-3 border-l-2"
                  style={{
                    borderLeftColor: vencido ? "var(--red)" : "var(--border)",
                    backgroundColor: vencido
                      ? "color-mix(in srgb, var(--red) 5%, var(--bg-card))"
                      : undefined,
                  }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-1.5 text-sm text-[var(--text)]">
                        <User size={14} aria-hidden className="shrink-0 text-[var(--text-muted)]" />
                        <span className="truncate">{r.clienteNome}</span>
                      </p>
                      <p className="mt-0.5 text-xs text-[var(--text-muted)]">
                        <span
                          className="tabular-nums"
                          style={vencido ? { color: "var(--red-text)" } : undefined}
                        >
                          Vence {formatDateBR(r.dataVencimento)}
                        </span>
                        {atraso && (
                          <span className="tabular-nums" style={{ color: "var(--red-text)" }}>
                            {" · "}
                            {atraso}
                          </span>
                        )}
                        {" · "}
                        {r.descricao || "sem descrição"}
                      </p>
                    </div>
                    <p
                      className="tabular-nums text-sm font-medium whitespace-nowrap"
                      style={{ color: r.status === "paga" ? "var(--green)" : undefined }}
                    >
                      {format(
                        r.status === "paga" ? Number(r.valorPago ?? r.valor) : Number(r.valor),
                      )}
                    </p>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {statusChip(r)}
                    {marcadores(r)}
                    {aba === "recebidos" && r.dataPagamento && (
                      <span className="text-xs text-[var(--text-muted)] tabular-nums">
                        recebido em {formatDateBR(r.dataPagamento)}
                      </span>
                    )}
                  </div>
                  <div className="mt-3">{acoes(r, "card")}</div>
                </li>
              );
            })}
          </ul>
        </>
      )}

      {/* Sheet de criar/editar */}
      <Sheet
        open={sheetAberto}
        onClose={fecharSheet}
        titulo={editando ? "Editar a receber" : "Novo a receber"}
        descricao={
          editando
            ? "As alterações valem só para este valor a receber."
            : "Um valor que um cliente ou convênio ainda vai pagar."
        }
        footer={
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={fecharSheet}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg-card)]"
            >
              Cancelar
            </button>
            <button
              type="submit"
              form="form-a-receber"
              disabled={save.isPending || !!erroValor || !!erroValorPago}
              className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-[var(--on-accent)] hover:bg-[var(--accent-strong)] disabled:opacity-50"
            >
              {save.isPending ? "Salvando…" : editando ? "Salvar" : "Adicionar"}
            </button>
          </div>
        }
      >
        <form
          id="form-a-receber"
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div>
            <label className="text-xs text-[var(--text-muted)]" htmlFor="cr-cliente">
              Cliente
            </label>
            <input
              id="cr-cliente"
              required
              className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              value={form.clienteNome}
              onChange={(e) => setForm({ ...form, clienteNome: e.target.value })}
              placeholder="Ex.: Maria Silva"
            />
          </div>

          <div>
            <label className="text-xs text-[var(--text-muted)]" htmlFor="cr-descricao">
              Descrição
            </label>
            <input
              id="cr-descricao"
              className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              value={form.descricao}
              onChange={(e) => setForm({ ...form, descricao: e.target.value })}
              placeholder="Ex.: Pacote 5 sessões"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-muted)]" htmlFor="cr-valor">
                {form.recorrencia === "parcelado" && !editando ? "Valor da parcela" : "Valor"}
              </label>
              {/* Texto, não `type="number"`: "99,90" digitado num teclado
                  brasileiro virava R$ 9.990,00. */}
              <InputDecimalBr
                id="cr-valor"
                required
                placeholder="Ex.: 99,90"
                aria-describedby="cr-valor-erro"
                aria-invalid={!!erroValor}
                className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm tabular-nums"
                value={form.valor}
                onChange={(valor) => setForm({ ...form, valor })}
              />
              {erroValor && (
                <p id="cr-valor-erro" className="mt-1 text-xs text-[var(--red-text)]">
                  {erroValor}
                </p>
              )}
            </div>
            <div>
              <label className="text-xs text-[var(--text-muted)]" htmlFor="cr-venc">
                {form.recorrencia === "parcelado" && !editando ? "1ª parcela vence" : "Vencimento"}
              </label>
              <input
                id="cr-venc"
                type="date"
                required
                className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
                value={form.dataVencimento}
                onChange={(e) => setForm({ ...form, dataVencimento: e.target.value })}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="text-xs text-[var(--text-muted)]" htmlFor="cr-recorrencia">
                Recorrência
              </label>
              <select
                id="cr-recorrencia"
                className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm disabled:opacity-50"
                value={form.recorrencia}
                onChange={(e) =>
                  setForm({ ...form, recorrencia: e.target.value as "" | "mensal" | "parcelado" })
                }
                disabled={!!editando && form.recorrencia === "parcelado"}
              >
                <option value="">Única vez</option>
                <option value="mensal">Todo mês</option>
                {(!editando || form.recorrencia === "parcelado") && (
                  <option value="parcelado">Parcelado</option>
                )}
              </select>
            </div>
            {form.recorrencia === "parcelado" && !editando && (
              <div>
                <label className="text-xs text-[var(--text-muted)]" htmlFor="cr-parcelas">
                  Nº de parcelas
                </label>
                <input
                  id="cr-parcelas"
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
              Mensal: ao marcar como recebido, o sistema cria automaticamente o recebimento do mês
              seguinte (ex.: mensalidade).
            </p>
          )}
          {form.recorrencia === "parcelado" && !editando && (
            <p className="text-xs text-[var(--text-muted)]">
              Parcelado: cria {nParcelas} recebíveis com o valor da parcela, vencendo a cada mês a
              partir da data informada (ex.: 1/{nParcelas}, 2/{nParcelas}…). O valor acima é o de{" "}
              <strong className="font-medium text-[var(--text)]">cada parcela</strong> — total do
              pacote {format(nParcelas * (valorLido.ok ? valorLido.valor : 0))}.
            </p>
          )}

          {editando?.status === "paga" && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-[var(--text-muted)]" htmlFor="cr-valor-pago">
                  Valor recebido
                </label>
                <InputDecimalBr
                  id="cr-valor-pago"
                  placeholder="Ex.: 99,90"
                  aria-describedby="cr-valor-pago-erro"
                  aria-invalid={!!erroValorPago}
                  className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm tabular-nums"
                  value={form.valorPago}
                  onChange={(valorPago) => setForm({ ...form, valorPago })}
                />
                {erroValorPago && (
                  <p id="cr-valor-pago-erro" className="mt-1 text-xs text-[var(--red-text)]">
                    {erroValorPago}
                  </p>
                )}
              </div>
              <div>
                <label className="text-xs text-[var(--text-muted)]" htmlFor="cr-data-pago">
                  Recebido em
                </label>
                <input
                  id="cr-data-pago"
                  type="date"
                  className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
                  value={form.dataPagamento}
                  onChange={(e) => setForm({ ...form, dataPagamento: e.target.value })}
                />
              </div>
            </div>
          )}

          <div>
            <label className="text-xs text-[var(--text-muted)]" htmlFor="cr-obs">
              Observações
            </label>
            <input
              id="cr-obs"
              className="mt-1 block w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 text-sm"
              value={form.observacoes}
              onChange={(e) => setForm({ ...form, observacoes: e.target.value })}
              placeholder="Opcional"
            />
          </div>
        </form>
      </Sheet>
    </div>
  );
}

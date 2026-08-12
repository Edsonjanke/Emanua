import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { hojeBrasil } from "@/lib/date";
import { nomesCategorias, useCategorias } from "@/lib/use-categorias";

export type LancamentoTipo = "receita" | "pagar" | "receber";

export interface LancamentoEdit {
  id?: string;
  tipo: LancamentoTipo;
  data?: string;
  dataVencimento?: string;
  valor?: number | string;
  forma?: "dinheiro" | "pix" | "cartao";
  observacao?: string | null;
  observacoes?: string | null;
  descricao?: string | null;
  clienteNome?: string;
  categoria?: string | null;
  recorrencia?: "mensal" | null;
  status?: string;
}

const TITLES: Record<LancamentoTipo, string> = {
  receita: "Receita do dia",
  pagar: "Conta a pagar",
  receber: "Valor a receber",
};

export default function FluxoLancamentoModal({
  initial,
  onClose,
  onSaved,
}: {
  initial: LancamentoEdit;
  onClose: () => void;
  onSaved: () => void;
}) {
  const editing = !!initial.id;
  const tipo = initial.tipo;
  const [data, setData] = useState(initial.data || initial.dataVencimento || hojeBrasil());
  const [valor, setValor] = useState(initial.valor != null ? String(initial.valor) : "");
  const [forma, setForma] = useState<"dinheiro" | "pix" | "cartao">(initial.forma || "dinheiro");
  const [observacao, setObservacao] = useState(initial.observacao || initial.observacoes || "");
  const [descricao, setDescricao] = useState(initial.descricao || "");
  const [clienteNome, setClienteNome] = useState(initial.clienteNome || "");
  const [categoria, setCategoria] = useState(initial.categoria || "Outros");
  const [recorrencia, setRecorrencia] = useState<"" | "mensal" | "parcelado">(
    initial.recorrencia === "mensal" ? "mensal" : "",
  );
  const [totalParcelas, setTotalParcelas] = useState("2");
  const [busy, setBusy] = useState(false);
  const catsQ = useCategorias();
  const categoriasOpts = nomesCategorias(catsQ.data, categoria);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      if (tipo === "receita") {
        const body = {
          data,
          valor: Number(valor),
          forma,
          observacao: observacao || null,
        };
        if (editing) await api.patch(`/api/receitas-dia/${initial.id}`, body);
        else await api.post("/api/receitas-dia", body);
        toast.success(editing ? "Receita atualizada" : "Receita lançada");
      } else if (tipo === "pagar") {
        const body: Record<string, unknown> = {
          descricao,
          valor: Number(valor),
          dataVencimento: data,
          categoria,
          observacoes: observacao || null,
          recorrencia: recorrencia === "mensal" ? "mensal" : null,
        };
        if (!editing && recorrencia === "parcelado") {
          body.totalParcelas = Math.min(60, Math.max(2, Number(totalParcelas) || 2));
        }
        if (editing) {
          await api.patch(`/api/contas-pagar/${initial.id}`, body);
          toast.success("Despesa atualizada");
        } else {
          const res = await api.post<{ count?: number }>("/api/contas-pagar", body);
          toast.success(
            res?.count && res.count > 1 ? `${res.count} parcelas criadas` : "Despesa criada",
          );
        }
      } else {
        const body = {
          clienteNome,
          descricao: descricao || null,
          valor: Number(valor),
          dataVencimento: data,
          observacoes: observacao || null,
        };
        if (editing) await api.patch(`/api/recebiveis/${initial.id}`, body);
        else await api.post("/api/recebiveis", body);
        toast.success(editing ? "Recebível atualizado" : "Recebível criado");
      }
      onSaved();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-[var(--text)]/45 backdrop-blur-[2px] p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={save}
        className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 space-y-3"
      >
        <h3 className="text-lg text-[var(--text)]">
          {editing ? "Editar" : "Nova"} {TITLES[tipo].toLowerCase()}
        </h3>

        {tipo === "receber" && (
          <>
            <label className="block text-xs text-[var(--text-muted)]">Cliente</label>
            <input
              required
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
              value={clienteNome}
              onChange={(e) => setClienteNome(e.target.value)}
            />
          </>
        )}

        {(tipo === "pagar" || tipo === "receber") && (
          <>
            <label className="block text-xs text-[var(--text-muted)]">Descrição</label>
            <input
              required={tipo === "pagar"}
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
              value={descricao}
              onChange={(e) => setDescricao(e.target.value)}
            />
          </>
        )}

        <label className="block text-xs text-[var(--text-muted)]">
          {tipo === "receita" ? "Data" : "Vencimento"}
        </label>
        <input
          type="date"
          required
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
          value={data}
          onChange={(e) => setData(e.target.value)}
        />

        <label className="block text-xs text-[var(--text-muted)]">Valor</label>
        <input
          type="number"
          step="0.01"
          min="0"
          required
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
          value={valor}
          onChange={(e) => setValor(e.target.value)}
        />

        {tipo === "receita" && (
          <>
            <label className="block text-xs text-[var(--text-muted)]">Forma</label>
            <select
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
              value={forma}
              onChange={(e) => setForma(e.target.value as any)}
            >
              <option value="dinheiro">Dinheiro</option>
              <option value="pix">PIX</option>
              <option value="cartao">Cartão</option>
            </select>
          </>
        )}

        {tipo === "pagar" && (
          <>
            <label className="block text-xs text-[var(--text-muted)]">Categoria</label>
            <select
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
            >
              {categoriasOpts.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <label className="block text-xs text-[var(--text-muted)]">Recorrência</label>
            <select
              className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
              value={recorrencia}
              onChange={(e) => setRecorrencia(e.target.value as "" | "mensal" | "parcelado")}
            >
              <option value="">Única vez</option>
              <option value="mensal">Todo mês</option>
              {!editing && <option value="parcelado">Parcelado</option>}
            </select>
            {recorrencia === "parcelado" && !editing && (
              <>
                <label className="block text-xs text-[var(--text-muted)]">Nº de parcelas</label>
                <input
                  type="number"
                  min={2}
                  max={60}
                  required
                  className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
                  value={totalParcelas}
                  onChange={(e) => setTotalParcelas(e.target.value)}
                />
                <p className="text-xs text-[var(--text-muted)]">
                  Cria {Math.min(60, Math.max(2, Number(totalParcelas) || 2))} contas com o mesmo
                  valor, vencendo a cada mês a partir da data informada.
                </p>
              </>
            )}
          </>
        )}

        <label className="block text-xs text-[var(--text-muted)]">Observação</label>
        <input
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          placeholder="Opcional"
        />

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-[var(--text-muted)]">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-[var(--on-accent)] disabled:opacity-50"
          >
            {busy ? "Salvando…" : "Salvar"}
          </button>
        </div>
      </form>
    </div>
  );
}

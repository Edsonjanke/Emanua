import { useState } from "react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { hojeBrasil } from "@/lib/date";

export default function ReceitaDiaModal({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved: () => void;
}) {
  const [data, setData] = useState(hojeBrasil());
  const [valor, setValor] = useState("");
  const [forma, setForma] = useState<"dinheiro" | "pix" | "cartao">("dinheiro");
  const [observacao, setObservacao] = useState("");
  const [busy, setBusy] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await api.post("/api/receitas-dia", {
        data,
        valor: Number(valor),
        forma,
        observacao: observacao || null,
      });
      toast.success("Receita lançada");
      onSaved();
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4" onClick={onClose}>
      <form
        onClick={(e) => e.stopPropagation()}
        onSubmit={save}
        className="w-full max-w-md rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 space-y-3"
      >
        <h3 className="text-lg text-white">Receita do dia</h3>
        <label className="block text-xs text-[var(--text-muted)]">Data</label>
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
        <label className="block text-xs text-[var(--text-muted)]">Observação</label>
        <input
          className="w-full rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
          value={observacao}
          onChange={(e) => setObservacao(e.target.value)}
          placeholder="opcional"
        />
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" onClick={onClose} className="px-3 py-2 text-sm text-[var(--text-muted)]">
            Cancelar
          </button>
          <button
            type="submit"
            disabled={busy}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            Salvar
          </button>
        </div>
      </form>
    </div>
  );
}

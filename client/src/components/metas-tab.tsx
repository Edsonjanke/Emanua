import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useMoney } from "@/lib/hide-values";
import { hojeBrasil } from "@/lib/date";

export default function MetasTab() {
  const { format } = useMoney();
  const qc = useQueryClient();
  const metas = useQuery({ queryKey: ["metas"], queryFn: () => api.get<any>("/api/metas") });
  const fixos = useQuery({ queryKey: ["custos-fixos"], queryFn: () => api.get<any[]>("/api/custos-fixos") });

  const [metaFat, setMetaFat] = useState("");
  const [margem, setMargem] = useState("");
  const [novo, setNovo] = useState({
    descricao: "",
    categoria: "Aluguel",
    valorMensal: "",
    dataInicio: hojeBrasil(),
  });

  const saveMeta = useMutation({
    mutationFn: () =>
      api.put("/api/metas", {
        metaFaturamento: metaFat || metas.data?.metaFaturamento,
        margemContribuicaoPct: margem || metas.data?.margemContribuicaoPct,
      }),
    onSuccess: () => {
      toast.success("Metas salvas");
      qc.invalidateQueries({ queryKey: ["metas"] });
      qc.invalidateQueries({ queryKey: ["fluxo"] });
    },
  });

  const addFixo = useMutation({
    mutationFn: () =>
      api.post("/api/custos-fixos", {
        ...novo,
        valorMensal: Number(novo.valorMensal),
      }),
    onSuccess: () => {
      toast.success("Custo fixo adicionado");
      setNovo({ descricao: "", categoria: "Aluguel", valorMensal: "", dataInicio: hojeBrasil() });
      qc.invalidateQueries({ queryKey: ["custos-fixos"] });
      qc.invalidateQueries({ queryKey: ["metas"] });
    },
  });

  if (metas.isLoading) return <p className="text-[var(--text-muted)]">Carregando…</p>;
  const m = metas.data!;

  return (
    <div className="space-y-6">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Card label="Meta faturamento" value={format(m.metaFaturamento)} />
        <Card label="Realizado no mês" value={format(m.realizado)} tone="green" />
        <Card label="Mínimo sobrevivência" value={format(m.minimo)} />
        <Card
          label="Ponto de equilíbrio"
          value={m.pontoEquilibrio != null ? format(m.pontoEquilibrio) : "—"}
          tone="blue"
        />
      </div>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-3">
        <h2 className="text-sm uppercase tracking-wide text-[var(--text-muted)]">Configurar metas</h2>
        <div className="flex flex-wrap gap-3 items-end">
          <div>
            <label className="text-xs text-[var(--text-muted)]">Meta faturamento</label>
            <input
              type="number"
              className="block mt-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
              placeholder={String(m.metaFaturamento)}
              value={metaFat}
              onChange={(e) => setMetaFat(e.target.value)}
            />
          </div>
          <div>
            <label className="text-xs text-[var(--text-muted)]">Margem contribuição %</label>
            <input
              type="number"
              className="block mt-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 w-28"
              placeholder={String(m.margemContribuicaoPct)}
              value={margem}
              onChange={(e) => setMargem(e.target.value)}
            />
          </div>
          <button
            type="button"
            onClick={() => saveMeta.mutate()}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-white"
          >
            Salvar
          </button>
        </div>
        <p className="text-xs text-[var(--text-muted)]">
          PE = custos fixos ({format(m.custosFixosTotal)}) ÷ margem. Ajuste a margem se o ticket médio
          mudar.
        </p>
      </section>

      <section className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4 space-y-3">
        <h2 className="text-sm uppercase tracking-wide text-[var(--text-muted)]">Custos fixos</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-[var(--text-muted)] text-left">
              <tr>
                <th className="py-2">Descrição</th>
                <th>Categoria</th>
                <th>Valor/mês</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {(fixos.data ?? []).map((c) => (
                <tr key={c.id} className="border-t border-[var(--border)]">
                  <td className="py-2">{c.descricao}</td>
                  <td>{c.categoria}</td>
                  <td>{format(Number(c.valorMensal))}</td>
                  <td>
                    <button
                      type="button"
                      className="text-[var(--red)] text-xs"
                      onClick={() =>
                        api.delete(`/api/custos-fixos/${c.id}`).then(() => {
                          qc.invalidateQueries({ queryKey: ["custos-fixos"] });
                          qc.invalidateQueries({ queryKey: ["metas"] });
                        })
                      }
                    >
                      Excluir
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="flex flex-wrap gap-2 items-end pt-2">
          <input
            placeholder="Descrição"
            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2"
            value={novo.descricao}
            onChange={(e) => setNovo({ ...novo, descricao: e.target.value })}
          />
          <input
            placeholder="Categoria"
            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 w-36"
            value={novo.categoria}
            onChange={(e) => setNovo({ ...novo, categoria: e.target.value })}
          />
          <input
            type="number"
            placeholder="Valor"
            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 w-28"
            value={novo.valorMensal}
            onChange={(e) => setNovo({ ...novo, valorMensal: e.target.value })}
          />
          <button
            type="button"
            onClick={() => addFixo.mutate()}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm hover:bg-[var(--bg)]"
          >
            Adicionar
          </button>
        </div>
      </section>
    </div>
  );
}

function Card({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const color =
    tone === "green" ? "text-[var(--green)]" : tone === "blue" ? "text-[var(--accent)]" : "text-white";
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <p className="text-xs uppercase text-[var(--text-muted)]">{label}</p>
      <p className={`text-xl mt-1 ${color}`}>{value}</p>
    </div>
  );
}

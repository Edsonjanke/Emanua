import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { useMoney } from "@/lib/hide-values";
import { hojeBrasil } from "@/lib/date";
import { nomesCategorias, useCategorias } from "@/lib/use-categorias";
import { parseValorPositivoDigitado, parseNumeroDigitado } from "@shared/valor";
import { InputDecimalBr, paraCampoDecimalBr } from "@/components/ui/input-decimal-br";

export default function MetasTab() {
  const { format } = useMoney();
  const qc = useQueryClient();
  const metas = useQuery({ queryKey: ["metas"], queryFn: () => api.get<any>("/api/metas") });
  const fixos = useQuery({ queryKey: ["custos-fixos"], queryFn: () => api.get<any[]>("/api/custos-fixos") });
  const catsQ = useCategorias();

  const [metaFat, setMetaFat] = useState("");
  const [margem, setMargem] = useState("");
  const [novo, setNovo] = useState({
    descricao: "",
    categoria: "Aluguel",
    valorMensal: "",
    dataInicio: hojeBrasil(),
  });
  const categoriasOpts = nomesCategorias(catsQ.data, novo.categoria);

  /*
   * Meta e margem também eram `type="number"`: quem digitasse "12.000,00" ou
   * "58,5" — do jeito brasileiro — mandava texto que o servidor não lia.
   * Campo em branco continua significando "não mexi nesse".
   */
  const metaFatLida = parseValorPositivoDigitado(metaFat);
  const erroMetaFat = metaFat.trim() === "" || metaFatLida.ok ? null : metaFatLida.erro;
  const margemLida = parseNumeroDigitado(margem);
  const erroMargem = margem.trim() === "" || margemLida.ok ? null : margemLida.erro;

  const saveMeta = useMutation({
    mutationFn: () =>
      api.put("/api/metas", {
        metaFaturamento: metaFatLida.ok ? metaFatLida.valor : metas.data?.metaFaturamento,
        margemContribuicaoPct: margemLida.ok ? margemLida.valor : metas.data?.margemContribuicaoPct,
      }),
    onSuccess: () => {
      toast.success("Metas salvas");
      qc.invalidateQueries({ queryKey: ["metas"] });
      qc.invalidateQueries({ queryKey: ["fluxo"] });
    },
  });

  const fixoLido = parseValorPositivoDigitado(novo.valorMensal);
  const erroFixo = novo.valorMensal.trim() === "" || fixoLido.ok ? null : fixoLido.erro;

  const addFixo = useMutation({
    mutationFn: async () => {
      if (!fixoLido.ok) throw new Error(fixoLido.erro);
      return api.post("/api/custos-fixos", {
        ...novo,
        valorMensal: fixoLido.valor,
      });
    },
    onSuccess: () => {
      toast.success("Custo fixo adicionado");
      setNovo({ descricao: "", categoria: "Aluguel", valorMensal: "", dataInicio: hojeBrasil() });
      qc.invalidateQueries({ queryKey: ["custos-fixos"] });
      qc.invalidateQueries({ queryKey: ["metas"] });
    },
    onError: (e: any) => toast.error(e.message),
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
            <label className="text-xs text-[var(--text-muted)]" htmlFor="meta-faturamento">
              Meta faturamento
            </label>
            <InputDecimalBr
              id="meta-faturamento"
              aria-invalid={!!erroMetaFat}
              className="block mt-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 tabular-nums"
              placeholder={paraCampoDecimalBr(m.metaFaturamento)}
              value={metaFat}
              onChange={setMetaFat}
            />
            {erroMetaFat && (
              <p className="mt-1 text-xs text-[var(--red-text)]">{erroMetaFat}</p>
            )}
          </div>
          <div>
            <label className="text-xs text-[var(--text-muted)]" htmlFor="meta-margem">
              Margem contribuição %
            </label>
            <InputDecimalBr
              id="meta-margem"
              casas={null}
              aria-invalid={!!erroMargem}
              className="block mt-1 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 w-28 tabular-nums"
              placeholder={String(m.margemContribuicaoPct)}
              value={margem}
              onChange={setMargem}
            />
            {erroMargem && <p className="mt-1 text-xs text-[var(--red-text)]">{erroMargem}</p>}
          </div>
          <button
            type="button"
            disabled={!!erroMetaFat || !!erroMargem}
            onClick={() => saveMeta.mutate()}
            className="rounded-lg bg-[var(--accent)] px-4 py-2 text-sm text-[var(--on-accent)]"
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
                      className="text-[var(--red-text)] text-xs"
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
          <select
            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 w-40"
            value={novo.categoria}
            onChange={(e) => setNovo({ ...novo, categoria: e.target.value })}
          >
            {categoriasOpts.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <InputDecimalBr
            placeholder="Valor (ex.: 1.200,00)"
            aria-label="Valor mensal do custo fixo"
            aria-invalid={!!erroFixo}
            className="rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 w-44 tabular-nums"
            value={novo.valorMensal}
            onChange={(valorMensal) => setNovo({ ...novo, valorMensal })}
          />
          <button
            type="button"
            disabled={!!erroFixo}
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
    tone === "green" ? "text-[var(--green)]" : tone === "blue" ? "text-[var(--accent-text)]" : "text-[var(--text)]";
  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--bg-card)] p-4">
      <p className="text-xs uppercase text-[var(--text-muted)]">{label}</p>
      <p className={`text-xl mt-1 ${color}`}>{value}</p>
    </div>
  );
}

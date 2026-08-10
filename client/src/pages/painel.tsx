import { useState } from "react";
import {
  Activity,
  Target,
  Building2,
  ArrowDownCircle,
  ArrowUpCircle,
  Wallet,
  Eye,
  EyeOff,
  LogOut,
} from "lucide-react";
import { useAuth } from "@/lib/auth";
import { useMoney } from "@/lib/hide-values";
import FluxoTab from "@/components/fluxo-tab";
import MetasTab from "@/components/metas-tab";
import DreTab from "@/components/dre-tab";
import ContasReceberTab from "@/components/contas-receber-tab";
import ContasPagarTab from "@/components/contas-pagar-tab";
import ProLaboreTab from "@/components/prolabore-tab";

type Tab = "fluxo" | "metas" | "dre" | "receber" | "pagar" | "prolabore";

const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: "fluxo", label: "Fluxo", icon: <Activity size={16} /> },
  { id: "metas", label: "Metas", icon: <Target size={16} /> },
  { id: "dre", label: "DRE", icon: <Building2 size={16} /> },
  { id: "receber", label: "A Receber", icon: <ArrowDownCircle size={16} /> },
  { id: "pagar", label: "A Pagar", icon: <ArrowUpCircle size={16} /> },
  { id: "prolabore", label: "Pró-labore", icon: <Wallet size={16} /> },
];

export default function PainelPage() {
  const [tab, setTab] = useState<Tab>("fluxo");
  const { user, logout } = useAuth();
  const { hidden, toggle } = useMoney();

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-[var(--border)] bg-[var(--bg-elevated)]/80 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-4 flex items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl md:text-3xl text-white leading-none">Painel Financeiro</h1>
            <p className="text-sm text-[var(--text-muted)] mt-1">
              Emanua Massoterapia · visão geral e controle
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-[var(--text-muted)] hidden sm:inline">{user?.nome}</span>
            <button
              type="button"
              onClick={toggle}
              className="p-2 rounded-lg border border-[var(--border)] hover:bg-[var(--bg-card)]"
              title={hidden ? "Mostrar valores" : "Ocultar valores"}
            >
              {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            <button
              type="button"
              onClick={() => logout()}
              className="p-2 rounded-lg border border-[var(--border)] hover:bg-[var(--bg-card)]"
              title="Sair"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
        <nav className="max-w-7xl mx-auto px-4 flex gap-1 overflow-x-auto pb-0">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2.5 text-sm whitespace-nowrap border-b-2 transition-colors ${
                tab === t.id
                  ? "border-[var(--accent)] text-white"
                  : "border-transparent text-[var(--text-muted)] hover:text-white"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="flex-1 max-w-7xl w-full mx-auto px-4 py-5">
        {tab === "fluxo" && <FluxoTab />}
        {tab === "metas" && <MetasTab />}
        {tab === "dre" && <DreTab />}
        {tab === "receber" && <ContasReceberTab />}
        {tab === "pagar" && <ContasPagarTab />}
        {tab === "prolabore" && <ProLaboreTab />}
      </main>
    </div>
  );
}

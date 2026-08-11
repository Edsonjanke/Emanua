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
    <div className="min-h-screen flex flex-col relative">
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        aria-hidden
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -20%, #d4e3c4 0%, transparent 55%), radial-gradient(ellipse 60% 40% at 100% 100%, #bed3b2 0%, transparent 50%)",
        }}
      />
      <header className="relative border-b border-[var(--border)] bg-[var(--bg-elevated)]/95 backdrop-blur sticky top-0 z-20">
        <div className="max-w-7xl mx-auto px-4 py-2.5 flex items-center justify-between gap-4">
          <div>
            <h1 className="brand text-2xl md:text-3xl text-[var(--text)] leading-none tracking-tight">
              Emanua
            </h1>
            <p className="text-xs text-[var(--text-muted)] mt-1">
              Massoterapia · painel financeiro
            </p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <span className="text-xs text-[var(--text-muted)] hidden sm:inline">{user?.nome}</span>
            <button
              type="button"
              onClick={toggle}
              className="p-2 rounded-lg border border-[var(--border)] hover:bg-[var(--bg-card)]"
              title={hidden ? "Mostrar valores" : "Ocultar valores"}
              aria-label={hidden ? "Mostrar valores" : "Ocultar valores"}
            >
              {hidden ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
            <button
              type="button"
              onClick={() => logout()}
              className="p-2 rounded-lg border border-[var(--border)] hover:bg-[var(--bg-card)]"
              title="Sair"
              aria-label="Sair"
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
        <nav
          className="max-w-7xl mx-auto px-4 flex gap-1 overflow-x-auto pb-0"
          aria-label="Seções do painel"
        >
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={`flex items-center gap-1.5 px-3 py-2 text-sm whitespace-nowrap border-b-2 transition-colors ${
                tab === t.id
                  ? "border-[var(--brand)] text-[var(--text)]"
                  : "border-transparent text-[var(--text-muted)] hover:text-[var(--text)]"
              }`}
            >
              {t.icon}
              {t.label}
            </button>
          ))}
        </nav>
      </header>

      <main className="relative flex-1 max-w-7xl w-full mx-auto px-4 py-4">
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

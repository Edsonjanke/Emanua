import { useEffect, useState } from "react";
import { useLocation } from "wouter";
import { toast } from "sonner";
import { useAuth } from "@/lib/auth";

export default function LoginPage() {
  const { login, user } = useAuth();
  const [, setLoc] = useLocation();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (user) setLoc("/");
  }, [user, setLoc]);

  if (user) return null;

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    try {
      await login(username, password);
      toast.success("Bem-vinda");
      setLoc("/");
    } catch (err: any) {
      toast.error(err.message || "Não foi possível entrar. Confira usuário e senha.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen grid place-items-center px-4 relative overflow-hidden">
      <div
        className="absolute inset-0 opacity-40"
        style={{
          background:
            "radial-gradient(ellipse 80% 50% at 50% -20%, #d4e3c4 0%, transparent 55%), radial-gradient(ellipse 60% 40% at 100% 100%, #bed3b2 0%, transparent 50%)",
        }}
      />
      <form
        onSubmit={onSubmit}
        className="relative w-full max-w-sm rounded-2xl border border-[var(--border)] bg-[var(--bg-elevated)]/95 p-8 shadow-[0_12px_40px_rgba(23,36,22,0.12)] backdrop-blur"
      >
        <p className="brand text-3xl text-[var(--text)] mb-1">Emanua</p>
        <p className="text-sm text-[var(--text-muted)] mb-6">Controle financeiro · massoterapia</p>
        <label className="block text-xs text-[var(--text-muted)] mb-1">Usuário</label>
        <input
          className="w-full mb-3 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 focus:border-[var(--accent-strong)]"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />
        <label className="block text-xs text-[var(--text-muted)] mb-1">Senha</label>
        <input
          type="password"
          className="w-full mb-5 rounded-lg border border-[var(--border)] bg-[var(--bg)] px-3 py-2 focus:border-[var(--accent-strong)]"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-lg bg-[var(--accent)] py-2.5 font-medium text-[var(--on-accent)] hover:bg-[var(--accent-strong)] disabled:opacity-50"
        >
          {busy ? "Entrando…" : "Entrar"}
        </button>
      </form>
    </div>
  );
}

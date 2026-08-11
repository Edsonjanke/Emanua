import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Switch, Redirect } from "wouter";
import { Toaster } from "sonner";
import { AuthProvider, useAuth } from "@/lib/auth";
import { MoneyProvider } from "@/lib/hide-values";
import LoginPage from "@/pages/login";
import PainelPage from "@/pages/painel";

const qc = new QueryClient({
  defaultOptions: {
    queries: { retry: 1, refetchOnWindowFocus: false },
  },
});

function PrivateRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center relative overflow-hidden">
        <div
          className="pointer-events-none absolute inset-0 opacity-40"
          aria-hidden
          style={{
            background:
              "radial-gradient(ellipse 80% 50% at 50% -20%, #d4e3c4 0%, transparent 55%), radial-gradient(ellipse 60% 40% at 100% 100%, #bed3b2 0%, transparent 50%)",
          }}
        />
        <div className="relative text-center">
          <p className="brand text-3xl text-[var(--text)]">Emanua</p>
          <p className="text-sm text-[var(--text-muted)] mt-2">Carregando o painel…</p>
        </div>
      </div>
    );
  }
  if (!user) return <Redirect to="/login" />;
  return <>{children}</>;
}

export default function App() {
  return (
    <QueryClientProvider client={qc}>
      <AuthProvider>
        <MoneyProvider>
          <Switch>
            <Route path="/login" component={LoginPage} />
            <Route path="/">
              <PrivateRoute>
                <PainelPage />
              </PrivateRoute>
            </Route>
            <Route>
              <Redirect to="/" />
            </Route>
          </Switch>
          <Toaster theme="light" position="top-right" richColors />
        </MoneyProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

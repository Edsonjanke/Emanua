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
      <div className="min-h-screen grid place-items-center text-[var(--text-muted)]">
        Carregando…
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
          <Toaster theme="dark" position="top-right" richColors />
        </MoneyProvider>
      </AuthProvider>
    </QueryClientProvider>
  );
}

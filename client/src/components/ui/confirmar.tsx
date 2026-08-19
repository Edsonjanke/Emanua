import { createContext, useCallback, useContext, useRef, useState } from "react";
import type { ReactNode } from "react";
import { createPortal } from "react-dom";
import { useFocoModal, useTravaScrollBody } from "./sheet";

export interface ConfirmarOpts {
  titulo: string;
  descricao?: string;
  confirmar?: string;
  tone?: "normal" | "perigo";
}

export type ConfirmarFn = (opts: ConfirmarOpts) => Promise<boolean>;

const Ctx = createContext<ConfirmarFn | null>(null);

/** Substitui o window.confirm(). Precisa envolver a árvore em App.tsx. */
export function ConfirmProvider({ children }: { children: ReactNode }): JSX.Element {
  const [opts, setOpts] = useState<ConfirmarOpts | null>(null);
  const resolverRef = useRef<((v: boolean) => void) | null>(null);
  const painelRef = useRef<HTMLDivElement>(null);

  const confirmar = useCallback<ConfirmarFn>((o) => {
    return new Promise<boolean>((resolve) => {
      resolverRef.current?.(false);
      resolverRef.current = resolve;
      setOpts(o);
    });
  }, []);

  const responder = useCallback((v: boolean) => {
    const resolve = resolverRef.current;
    resolverRef.current = null;
    setOpts(null);
    resolve?.(v);
  }, []);

  const cancelar = useCallback(() => responder(false), [responder]);

  const aberto = opts !== null;
  useTravaScrollBody(aberto);
  useFocoModal(aberto, painelRef, cancelar);

  const perigo = opts?.tone === "perigo";

  return (
    <Ctx.Provider value={confirmar}>
      {children}
      {aberto &&
        opts &&
        createPortal(
          <div className="fixed inset-0 z-[60] grid place-items-center p-4">
            <div
              className="absolute inset-0 bg-[var(--text)]/30"
              onClick={cancelar}
              aria-hidden
            />
            <div
              ref={painelRef}
              role="dialog"
              aria-modal="true"
              aria-labelledby="confirmar-titulo"
              aria-describedby={opts.descricao ? "confirmar-descricao" : undefined}
              tabIndex={-1}
              className="relative w-full max-w-sm rounded-xl border border-[var(--border)] bg-[var(--bg-elevated)] p-5 outline-none"
            >
              <h2
                id="confirmar-titulo"
                className="text-lg font-medium text-[var(--text)]"
              >
                {opts.titulo}
              </h2>
              {opts.descricao && (
                <p
                  id="confirmar-descricao"
                  className="mt-2 text-sm text-[var(--text-muted)]"
                >
                  {opts.descricao}
                </p>
              )}
              {/*
                min-h-11: 44px. Estes dois botões tinham 38px enquanto os cards
                atrás deles já tinham 44 — o passo que EFETIVA a gravação era o
                menor alvo do fluxo inteiro. No celular eles ainda ocupam meia
                largura cada, que é onde o polegar cai.
              */}
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={cancelar}
                  className="min-h-11 flex-1 sm:flex-none rounded-lg border border-[var(--border)] px-4 py-2 text-sm text-[var(--text)] hover:bg-[var(--bg-card)]"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => responder(true)}
                  className="min-h-11 flex-1 sm:flex-none rounded-lg px-4 py-2 text-sm text-[var(--on-accent)]"
                  style={{ backgroundColor: perigo ? "var(--red)" : "var(--accent)" }}
                >
                  {opts.confirmar || "Confirmar"}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </Ctx.Provider>
  );
}

/** Hook que devolve a função de confirmação. */
export function useConfirmar(): ConfirmarFn {
  const ctx = useContext(Ctx);
  if (!ctx) {
    throw new Error("useConfirmar precisa estar dentro de <ConfirmProvider>");
  }
  return ctx;
}

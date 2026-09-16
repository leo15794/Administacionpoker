import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

// Reemplazo de los confirm()/alert()/prompt() nativos del navegador (que salen pegados arriba,
// feos y sin estilo) por modales propios, centrados, con la misma estética que el resto del
// sistema (reusa .modal-backdrop/.modal-box de components/Modal). Uso:
//   const { confirmDialog, alertDialog, promptDialog } = useConfirmDialog();
//   if (!(await confirmDialog("¿Seguro?"))) return;
//   await alertDialog("Listo.");
//   const motivo = await promptDialog("¿Por qué?"); if (motivo === null) return; // null = canceló
interface ConfirmState {
  message: string;
  title?: string;
  danger?: boolean;
  resolve: (value: boolean) => void;
}
interface AlertState {
  message: string;
  title?: string;
  resolve: () => void;
}
interface PromptState {
  message: string;
  title?: string;
  placeholder?: string;
  defaultValue?: string;
  resolve: (value: string | null) => void;
}

const ConfirmContext = createContext<{
  confirmDialog: (message: string, opts?: { title?: string; danger?: boolean }) => Promise<boolean>;
  alertDialog: (message: string, opts?: { title?: string }) => Promise<void>;
  promptDialog: (message: string, opts?: { title?: string; placeholder?: string; defaultValue?: string }) => Promise<string | null>;
} | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [alertState, setAlertState] = useState<AlertState | null>(null);
  const [promptState, setPromptState] = useState<PromptState | null>(null);
  const [promptValue, setPromptValue] = useState("");
  const promptInputRef = useRef<HTMLInputElement>(null);

  const confirmDialog = useCallback((message: string, opts?: { title?: string; danger?: boolean }) => {
    return new Promise<boolean>((resolve) => {
      setConfirmState({ message, title: opts?.title, danger: opts?.danger, resolve });
    });
  }, []);

  const alertDialog = useCallback((message: string, opts?: { title?: string }) => {
    return new Promise<void>((resolve) => {
      setAlertState({ message, title: opts?.title, resolve });
    });
  }, []);

  const promptDialog = useCallback((message: string, opts?: { title?: string; placeholder?: string; defaultValue?: string }) => {
    return new Promise<string | null>((resolve) => {
      setPromptValue(opts?.defaultValue ?? "");
      setPromptState({ message, title: opts?.title, placeholder: opts?.placeholder, defaultValue: opts?.defaultValue, resolve });
    });
  }, []);

  useEffect(() => {
    if (promptState) {
      // Foco automático al abrir, como haría el prompt() nativo.
      const t = setTimeout(() => promptInputRef.current?.focus(), 0);
      return () => clearTimeout(t);
    }
  }, [promptState]);

  function closeConfirm(result: boolean) {
    confirmState?.resolve(result);
    setConfirmState(null);
  }
  function closeAlert() {
    alertState?.resolve();
    setAlertState(null);
  }
  function closePrompt(result: string | null) {
    promptState?.resolve(result);
    setPromptState(null);
  }

  return (
    <ConfirmContext.Provider value={{ confirmDialog, alertDialog, promptDialog }}>
      {children}

      {confirmState && (
        <div className="modal-backdrop confirm-backdrop" onClick={() => closeConfirm(false)}>
          <div className="modal-box confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-body">
              {confirmState.title && <h3 style={{ marginTop: 0 }}>{confirmState.title}</h3>}
              <p style={{ whiteSpace: "pre-wrap", margin: confirmState.title ? undefined : "0 0 4px" }}>{confirmState.message}</p>
              <div className="confirm-actions">
                <button className="btn secondary" onClick={() => closeConfirm(false)}>Cancelar</button>
                <button className={`btn ${confirmState.danger ? "danger" : ""}`} onClick={() => closeConfirm(true)} autoFocus>
                  Confirmar
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {alertState && (
        <div className="modal-backdrop confirm-backdrop" onClick={closeAlert}>
          <div className="modal-box confirm-box" onClick={(e) => e.stopPropagation()}>
            <div className="modal-body">
              {alertState.title && <h3 style={{ marginTop: 0 }}>{alertState.title}</h3>}
              <p style={{ whiteSpace: "pre-wrap", margin: alertState.title ? undefined : "0 0 4px" }}>{alertState.message}</p>
              <div className="confirm-actions">
                <button className="btn" onClick={closeAlert} autoFocus>Aceptar</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {promptState && (
        <div className="modal-backdrop confirm-backdrop" onClick={() => closePrompt(null)}>
          <form
            className="modal-box confirm-box"
            onClick={(e) => e.stopPropagation()}
            onSubmit={(e) => {
              e.preventDefault();
              closePrompt(promptValue);
            }}
          >
            <div className="modal-body">
              {promptState.title && <h3 style={{ marginTop: 0 }}>{promptState.title}</h3>}
              <p style={{ whiteSpace: "pre-wrap", margin: promptState.title ? undefined : "0 0 4px" }}>{promptState.message}</p>
              <input
                ref={promptInputRef}
                value={promptValue}
                onChange={(e) => setPromptValue(e.target.value)}
                placeholder={promptState.placeholder}
                style={{ width: "100%", marginTop: 10 }}
              />
              <div className="confirm-actions">
                <button type="button" className="btn secondary" onClick={() => closePrompt(null)}>Cancelar</button>
                <button type="submit" className="btn">Confirmar</button>
              </div>
            </div>
          </form>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}

export function useConfirmDialog() {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error("useConfirmDialog tiene que usarse dentro de <ConfirmProvider>.");
  return ctx;
}

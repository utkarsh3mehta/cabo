import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

interface Toast {
  id: number;
  message: string;
}

const ToastContext = createContext<(message: string) => void>(() => undefined);

/** Errors and rejected moves are shown here and announced to assistive technology. */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const show = useCallback((message: string) => {
    const id = next.current++;
    setToasts((t) => [...t.filter((x) => x.message !== message), { id, message }].slice(-3));
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 6000);
  }, []);
  const value = useMemo(() => show, [show]);
  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="toast-region" role="alert" aria-live="assertive" data-testid="toasts">
        {toasts.map((t) => (
          <div key={t.id} className="notice error">
            <span>{t.message}</span>
            <button type="button" className="small ghost" aria-label="Dismiss" onClick={() => setToasts((all) => all.filter((x) => x.id !== t.id))}>
              ✕
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast(): (message: string) => void {
  return useContext(ToastContext);
}

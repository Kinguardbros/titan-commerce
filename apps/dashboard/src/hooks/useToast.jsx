import { useState, useCallback, createContext, useContext } from 'react';
import './Toast.css';

const ToastContext = createContext(null);

function ToastContainer({ toasts, onRemove }) {
  return (
    <div className="toast-container">
      {toasts.slice(-3).map((t) => (
        <div key={t.id} className={`toast toast--${t.type}`} onClick={() => onRemove(t.id)}>
          <span className="toast-icon">{t.type === 'success' ? '✓' : t.type === 'error' ? '✗' : 'ℹ'}</span>
          <span className="toast-msg">{t.message}</span>
          <span className="toast-close">×</span>
        </div>
      ))}
    </div>
  );
}

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const removeToast = useCallback((id) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const addToast = useCallback((message, type = 'info', duration = 3000) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, message, type }]);
    if (type !== 'error' && duration > 0) {
      setTimeout(() => removeToast(id), duration);
    }
  }, [removeToast]);

  const value = {
    success: (msg) => addToast(msg, 'success', 3000),
    error: (msg) => addToast(msg, 'error', 0),
    info: (msg) => addToast(msg, 'info', 5000),
  };

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastContainer toasts={toasts} onRemove={removeToast} />
    </ToastContext.Provider>
  );
}

export function useToast() {
  return useContext(ToastContext);
}

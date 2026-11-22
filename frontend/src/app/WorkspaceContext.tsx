import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import type { Workspace } from '../../../shared/contracts';
import { api } from '../lib/api';
interface WorkspaceState {
  data: Workspace | null;
  demo: boolean;
  setDemo: (value: boolean) => void;
  loading: boolean;
  error: string;
  toast: string;
  busy: boolean;
  refresh: () => Promise<void>;
  notify: (message: string) => void;
  mutate: (path: string, body?: unknown, method?: string, success?: string) => Promise<boolean>;
}
const Context = createContext<WorkspaceState | null>(null);
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const [demo, setDemo] = useState(() => new URLSearchParams(location.search).get('demo') === '1');
  const [data, setData] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [toast, setToast] = useState(''),
    [busy, setBusy] = useState(false);
  const generation = useRef(0),
    active = useRef<AbortController | null>(null);
  const notify = useCallback((message: string) => setToast(message), []);
  const refresh = useCallback(async () => {
    const current = ++generation.current;
    active.current?.abort();
    const controller = new AbortController();
    active.current = controller;
    try {
      const result = await api<Workspace>('/workspace', { signal: controller.signal }, demo);
      if (current === generation.current) {
        setData(result);
        setError('');
      }
    } catch (e) {
      if (current === generation.current && !controller.signal.aborted)
        setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      if (current === generation.current) {
        active.current = null;
        setLoading(false);
      }
    }
  }, [demo]);
  useEffect(() => {
    setData(null);
    setLoading(true);
    void refresh();
    const timer = setInterval(() => {
      if (!active.current) void refresh();
    }, 5000);
    return () => {
      clearInterval(timer);
      active.current?.abort();
    };
  }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(''), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const mutate = async (path: string, body?: unknown, method = 'POST', success = '已更新') => {
    setBusy(true);
    try {
      await api(
        path,
        { method, body: body === undefined ? undefined : JSON.stringify(body) },
        demo,
      );
      await refresh();
      notify(success);
      return true;
    } catch (e) {
      notify(e instanceof Error ? e.message : '操作失败');
      return false;
    } finally {
      setBusy(false);
    }
  };
  return (
    <Context.Provider
      value={{
        data,
        demo,
        setDemo,
        loading,
        error,
        toast,
        busy,
        refresh,
        notify,
        mutate,
      }}
    >
      {children}
    </Context.Provider>
  );
}
export function useWorkspace() {
  const context = useContext(Context);
  if (!context) throw new Error('WorkspaceProvider missing');
  return context;
}

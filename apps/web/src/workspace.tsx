import { createContext, useContext, useEffect, useState } from "react";
import type {
  SessionView,
  TenantView,
} from "../../../packages/core/src/contracts.ts";
import { api } from "./api";
export type WorkspaceContext = {
  session: SessionView;
  tenant: TenantView;
  prefix: string;
  refresh: () => void;
  revision: number;
  updateSession: (s: SessionView) => void;
  notify: (s: string) => void;
};
export const Context = createContext<WorkspaceContext>(null!);
export const useWorkspace = () => useContext(Context);
export function useLoad<T>(path: string | null) {
  const { prefix, revision } = useWorkspace();
  const [state, setState] = useState<{
    data?: T;
    error?: string;
    loading: boolean;
  }>({ loading: true });
  useEffect(() => {
    if (path === null) {
      setState({ loading: false });
      return;
    }
    const abort = new AbortController();
    setState({ loading: true });
    api<T>(prefix + path, { signal: abort.signal })
      .then((data) => setState({ data, loading: false }))
      .catch((e) => {
        if (e.name !== "AbortError")
          setState({ error: e.message, loading: false });
      });
    return () => abort.abort();
  }, [prefix, path, revision]);
  return state;
}

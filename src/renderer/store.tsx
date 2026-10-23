import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { newProject, normalizeProject } from '../shared/model';
import type { AnyRow, Project, TableKey } from '../shared/types';
import { api } from './api';

interface Store {
  project: Project;
  filePath?: string;
  dirty: boolean;
  /** Projeyi kopya üzerinde değiştirir; geri alınabilir. */
  mutate: (fn: (draft: Project) => void) => void;
  /** Tek hücre güncellemesi. */
  setField: (table: TableKey, id: string, field: string, value: unknown) => void;
  addRows: (table: TableKey, rows: AnyRow[]) => void;
  removeRows: (table: TableKey, ids: string[]) => void;
  replace: (p: Project, path?: string, markClean?: boolean) => void;
  setPath: (p?: string) => void;
  markSaved: () => void;
  undo: () => void;
  redo: () => void;
  toast: (msg: string, kind?: 'ok' | 'warn' | 'err') => void;
  toasts: { id: number; msg: string; kind: string }[];
}

const Ctx = createContext<Store | null>(null);

export function useStore(): Store {
  const s = useContext(Ctx);
  if (!s) throw new Error('store yok');
  return s;
}

export function StoreProvider({ children }: { children: ReactNode }) {
  const [project, setProject] = useState<Project>(() => newProject());
  const [filePath, setPath] = useState<string | undefined>();
  const [dirty, setDirty] = useState(false);
  const [toasts, setToasts] = useState<{ id: number; msg: string; kind: string }[]>([]);
  const undoStack = useRef<Project[]>([]);
  const redoStack = useRef<Project[]>([]);
  const projectRef = useRef(project);
  projectRef.current = project;

  const toast = useCallback((msg: string, kind: 'ok' | 'warn' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 8000 : 4000);
  }, []);

  const commit = useCallback((next: Project) => {
    undoStack.current.push(projectRef.current);
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    projectRef.current = next;
    setProject(next);
    setDirty(true);
  }, []);

  const mutate = useCallback(
    (fn: (d: Project) => void) => {
      const d = structuredClone(projectRef.current);
      fn(d);
      commit(d);
    },
    [commit],
  );

  const setField = useCallback(
    (table: TableKey, id: string, field: string, value: unknown) =>
      mutate((d) => {
        const row = (d[table] as unknown as Record<string, unknown>[]).find((r) => r.id === id);
        if (!row) return;
        row[field] = value;
        // Elle kapatma: kapanış tarihi; yeniden açma: kapanış bilgisi temizlenir.
        if (field === 'workStatus') {
          if (value === 'Kapandı' && !row.closedAt) row.closedAt = new Date().toISOString();
          if (value !== 'Kapandı' && value !== 'İptal') row.closedAt = '';
        }
        if (field === 'assignee' && value && row.workStatus === 'Atanmadı') row.workStatus = 'Atandı';
        if (field === 'assignee' && value && !row.discipline) {
          const person = d.people.find((x) => x.id === value);
          if (person?.discipline) row.discipline = person.discipline;
        }
      }),
    [mutate],
  );

  const addRows = useCallback((table: TableKey, rows: AnyRow[]) => mutate((d) => void (d[table] as AnyRow[]).push(...rows)), [mutate]);
  const removeRows = useCallback(
    (table: TableKey, ids: string[]) =>
      mutate((d) => {
        (d as unknown as Record<string, AnyRow[]>)[table] = (d[table] as AnyRow[]).filter((r) => !ids.includes(r.id));
        if (table === 'people') for (const r of [...d.requirements, ...d.issues]) if (ids.includes(r.assignee)) r.assignee = '';
      }),
    [mutate],
  );

  const replace = useCallback((p: Project, path?: string, markClean = true) => {
    undoStack.current = [];
    redoStack.current = [];
    const n = normalizeProject(p);
    projectRef.current = n;
    setProject(n);
    setPath(path);
    setDirty(!markClean);
  }, []);

  const undo = useCallback(() => {
    const prev = undoStack.current.pop();
    if (!prev) return;
    redoStack.current.push(projectRef.current);
    projectRef.current = prev;
    setProject(prev);
    setDirty(true);
  }, []);
  const redo = useCallback(() => {
    const nxt = redoStack.current.pop();
    if (!nxt) return;
    undoStack.current.push(projectRef.current);
    projectRef.current = nxt;
    setProject(nxt);
    setDirty(true);
  }, []);

  useEffect(() => {
    api.setDirty(dirty);
  }, [dirty]);

  useEffect(() => {
    if (!dirty) return;
    const t = setTimeout(() => api.autosave({ path: filePath, data: project }), 2500);
    return () => clearTimeout(t);
  }, [project, dirty, filePath]);

  const value = useMemo<Store>(
    () => ({ project, filePath, dirty, mutate, setField, addRows, removeRows, replace, setPath, markSaved: () => setDirty(false), undo, redo, toast, toasts }),
    [project, filePath, dirty, mutate, setField, addRows, removeRows, replace, undo, redo, toast, toasts],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Senkron sonucu gibi uzun işlemlerden sonra güncel projeyi okumak için. */
export function useLatest<T>(v: T) {
  const r = useRef(v);
  r.current = v;
  return r;
}

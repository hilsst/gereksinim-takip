import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { record } from '../shared/history';
import { isClosed, newProject, normalizeProject } from '../shared/model';
import type { AnyRow, PersonRow, Project, TableKey } from '../shared/types';
import { api } from './api';

interface Store {
  project: Project;
  filePath?: string;
  dirty: boolean;
  /** Projeyi kopya üzerinde değiştirir; geri alınabilir. Değişiklik günlüğüne actor (yoksa oturumdaki kullanıcı) adıyla yazılır. */
  mutate: (fn: (draft: Project) => void, actor?: string) => void;
  /** Tek hücre güncellemesi. */
  setField: (table: TableKey, id: string, field: string, value: unknown) => void;
  addRows: (table: TableKey, rows: AnyRow[]) => void;
  /** Kaydı silindi olarak işaretler; satır ve numarası dosyada kalır. */
  removeRows: (table: TableKey, ids: string[], reason: string) => void;
  restoreRows: (table: TableKey, ids: string[]) => void;
  /** Değişiklik günlüğüne yazılan kullanıcı (Windows oturum adı). */
  user: string;
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
  const [user, setUser] = useState('');
  const userRef = useRef('');
  userRef.current = user;
  const undoStack = useRef<Project[]>([]);
  const redoStack = useRef<Project[]>([]);
  const projectRef = useRef(project);
  projectRef.current = project;

  const toast = useCallback((msg: string, kind: 'ok' | 'warn' | 'err' = 'ok') => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, msg, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 8000 : 4000);
  }, []);

  useEffect(() => {
    api.userName().then((u) => setUser(u || 'bilinmiyor'));
  }, []);

  const commit = useCallback((next: Project, actor?: string) => {
    record(projectRef.current, next, actor || userRef.current || 'bilinmiyor');
    undoStack.current.push(projectRef.current);
    if (undoStack.current.length > 100) undoStack.current.shift();
    redoStack.current = [];
    projectRef.current = next;
    setProject(next);
    setDirty(true);
  }, []);

  const mutate = useCallback(
    (fn: (d: Project) => void, actor?: string) => {
      const d = structuredClone(projectRef.current);
      fn(d);
      commit(d, actor);
    },
    [commit],
  );

  const setField = useCallback(
    (table: TableKey, id: string, field: string, value: unknown) =>
      mutate((d) => {
        const row = (d[table] as unknown as Record<string, unknown>[]).find((r) => r.id === id);
        if (!row) return;
        const before = row[field];
        row[field] = value;
        // Yeni sorumlu atandığında atama günü Planner başlangıç tarihi olur
        if (field === 'assignee' && value && value !== before) row.assignedAt = new Date().toISOString().slice(0, 10);
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
    (table: TableKey, ids: string[], reason: string) =>
      mutate((d) => {
        const at = new Date().toISOString();
        for (const r of d[table] as AnyRow[]) {
          if (!ids.includes(r.id) || r.deletedAt) continue;
          Object.assign(r, { deletedAt: at, deletedBy: userRef.current, deleteReason: reason });
          if (table === 'people') (r as PersonRow).active = false;
        }
        // Silinen kişinin açık işleri boşa düşer; kapanmış işlerde sorumlu KPI için kalır
        if (table === 'people') for (const r of [...d.requirements, ...d.issues]) if (ids.includes(r.assignee) && !isClosed(r)) r.assignee = '';
      }),
    [mutate],
  );
  const restoreRows = useCallback(
    (table: TableKey, ids: string[]) =>
      mutate((d) => {
        for (const r of d[table] as AnyRow[]) {
          if (!ids.includes(r.id) || !r.deletedAt) continue;
          Object.assign(r, { deletedAt: '', deletedBy: '', deleteReason: '' });
          if (table === 'people') (r as PersonRow).active = true;
        }
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
    () => ({ project, filePath, dirty, mutate, setField, addRows, removeRows, restoreRows, user, replace, setPath, markSaved: () => setDirty(false), undo, redo, toast, toasts }),
    [project, filePath, dirty, mutate, setField, addRows, removeRows, restoreRows, user, replace, undo, redo, toast, toasts],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Senkron sonucu gibi uzun işlemlerden sonra güncel projeyi okumak için. */
export function useLatest<T>(v: T) {
  const r = useRef(v);
  r.current = v;
  return r;
}

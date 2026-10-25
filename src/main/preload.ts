import { contextBridge, ipcRenderer } from 'electron';
import type { SyncResult } from '../shared/planner';
import type { Member } from '../shared/model';
import type { DrawingImage } from '../shared/raster';
import type { Project } from '../shared/types';
import type { UpdateStatus } from './updater';

type Result<T> = { ok: true; data: T } | { ok: false; error: string };
type Cfg = { clientId: string; tenantId: string };
type Account = { name: string; username: string };

const api = {
  openProject: (file?: string): Promise<{ path: string; data: Project; backup?: string } | null> => ipcRenderer.invoke('project:open', file),
  userName: (): Promise<string> => ipcRenderer.invoke('app:user'),
  saveProject: (args: { path?: string; data: Project; saveAs?: boolean }): Promise<string | null> => ipcRenderer.invoke('project:save', args),
  recent: (): Promise<string[]> => ipcRenderer.invoke('project:recent'),
  recovery: (): Promise<{ path?: string; data: Project; at: string } | null> => ipcRenderer.invoke('project:recovery'),
  autosave: (payload: { path?: string; data: Project }) => ipcRenderer.invoke('project:autosave', payload),
  discardRecovery: () => ipcRenderer.invoke('project:discardRecovery'),
  setDirty: (v: boolean) => ipcRenderer.send('project:dirty', v),
  quit: () => ipcRenderer.send('app:quit'),
  exportExcel: (data: Project): Promise<string | null> => ipcRenderer.invoke('excel:export', data),
  pickFiles: (multi = true): Promise<{ path: string; name: string }[]> => ipcRenderer.invoke('file:pick', { multi }),
  openPath: (p: string) => ipcRenderer.invoke('file:open', p),
  aiStatus: (): Promise<{ configured: boolean; fromEnv: boolean }> => ipcRenderer.invoke('ai:status'),
  aiSetKey: (key: string) => ipcRenderer.invoke('ai:setKey', key),
  readFile: (p: string): Promise<Uint8Array> => ipcRenderer.invoke('file:read', p),
  cadSvg: (p: string): Promise<Result<string | null>> => ipcRenderer.invoke('cad:svg', p),
  aiRequirements: (a: { filePath?: string; text?: string; images?: DrawingImage[]; drawing?: boolean; docId: string; docLabel: string; existing: string[] }): Promise<Result<unknown>> => ipcRenderer.invoke('ai:requirements', a),
  aiCancel: () => ipcRenderer.invoke('ai:cancel'),
  plannerStatus: (cfg: Cfg): Promise<Result<{ account: Account | null }>> => ipcRenderer.invoke('planner:status', cfg),
  plannerSignIn: (cfg: Cfg): Promise<Result<Account>> => ipcRenderer.invoke('planner:signIn', cfg),
  plannerSignOut: (cfg: Cfg): Promise<Result<void>> => ipcRenderer.invoke('planner:signOut', cfg),
  plannerPlans: (cfg: Cfg): Promise<Result<{ id: string; title: string }[]>> => ipcRenderer.invoke('planner:plans', cfg),
  plannerPush: (a: { project: Project; ids: string[] }): Promise<Result<SyncResult>> => ipcRenderer.invoke('planner:push', a),
  plannerPull: (a: { project: Project }): Promise<Result<SyncResult>> => ipcRenderer.invoke('planner:pull', a),
  flowPickFolder: (): Promise<string | null> => ipcRenderer.invoke('flow:pickFolder'),
  teamGet: (): Promise<Member[]> => ipcRenderer.invoke('team:get'),
  teamSave: (members: Member[]) => ipcRenderer.invoke('team:save', members),
  flowLastFolder: (): Promise<string | null> => ipcRenderer.invoke('flow:lastFolder'),
  flowStatus: (root: string): Promise<Result<{ waitingOut: number; waitingIn: number }>> => ipcRenderer.invoke('flow:status', root),
  flowPush: (a: { project: Project; ids: string[] }): Promise<Result<SyncResult>> => ipcRenderer.invoke('flow:push', a),
  flowPull: (a: { project: Project }): Promise<Result<SyncResult>> => ipcRenderer.invoke('flow:pull', a),
  onMenu: (cb: (id: string) => void) => {
    const h = (_e: unknown, id: string) => cb(id);
    ipcRenderer.on('menu', h);
    return () => {
      ipcRenderer.removeListener('menu', h);
    };
  },
  checkUpdates: () => ipcRenderer.send('update:check'),
  installUpdate: () => ipcRenderer.send('update:install'),
  onUpdate: (cb: (s: UpdateStatus) => void) => {
    const h = (_e: unknown, s: UpdateStatus) => cb(s);
    ipcRenderer.on('update', h);
    return () => {
      ipcRenderer.removeListener('update', h);
    };
  },
  onOpenFile: (cb: (p: string) => void) => {
    const h = (_e: unknown, p: string) => cb(p);
    ipcRenderer.on('open-file', h);
    return () => {
      ipcRenderer.removeListener('open-file', h);
    };
  },
};

contextBridge.exposeInMainWorld('api', api);

export type Api = typeof api;

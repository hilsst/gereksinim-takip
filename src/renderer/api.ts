import type { Api } from '../main/preload';
import type { Project } from '../shared/types';

declare global {
  interface Window {
    api: Api;
  }
}

// Tarayıcıda (Electron dışında) önizleme için basit yedek; dosya işlemleri localStorage'a yazar.
function browserFallback(): Api {
  const key = 'gereksinim-takip-project';
  const noop = () => () => undefined;
  const fail = async () => ({ ok: false as const, error: 'Bu özellik yalnızca masaüstü uygulamasında çalışır.' });
  return {
    openProject: async () => {
      const t = localStorage.getItem(key);
      return t ? { path: 'tarayici', data: JSON.parse(t) as Project } : null;
    },
    saveProject: async ({ data }: { data: Project }) => {
      localStorage.setItem(key, JSON.stringify(data));
      return 'tarayici';
    },
    userName: async () => 'tarayici',
    recent: async () => [],
    recovery: async () => null,
    autosave: async () => undefined,
    discardRecovery: async () => undefined,
    setDirty: () => undefined,
    quit: () => undefined,
    exportExcel: async () => null,
    pickFiles: async () => [],
    openPath: async () => '',
    aiStatus: async () => ({ configured: false, fromEnv: false }),
    aiSetKey: async () => true,
    readFile: async () => new Uint8Array(),
    cadSvg: fail,
    aiRequirements: fail,
    aiCancel: async () => undefined,
    onAiProgress: noop,
    plannerStatus: async () => ({ ok: true as const, data: { account: null } }),
    plannerSignIn: fail,
    plannerSignOut: fail,
    plannerPlans: fail,
    plannerPush: fail,
    plannerPull: fail,
    flowPickFolder: async () => null,
    flowLastFolder: async () => null,
    teamGet: async () => [],
    teamSave: async () => undefined,
    flowStatus: fail,
    flowPush: fail,
    flowPull: fail,
    onMenu: noop,
    checkUpdates: () => undefined,
    installUpdate: () => undefined,
    onUpdate: noop,
    onOpenFile: noop,
  } as unknown as Api;
}

export const api: Api = typeof window !== 'undefined' && window.api ? window.api : browserFallback();
export const isDesktop = typeof window !== 'undefined' && !!window.api;

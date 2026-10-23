import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { applySync, type SyncResult } from '../shared/planner';
import { api, isDesktop } from './api';
import { useLatest, useStore } from './store';

interface PlannerCtx {
  account: { name: string; username: string } | null;
  busy: string | null;
  configured: boolean;
  /** Gönderim ve kontrol için bağlantı hazır mı (seçili moda göre). */
  ready: boolean;
  mode: 'flow' | 'graph';
  signIn: () => Promise<void>;
  signOut: () => Promise<void>;
  plans: () => Promise<{ id: string; title: string }[]>;
  push: (ids: string[]) => Promise<void>;
  pull: (quiet?: boolean) => Promise<void>;
}

const Ctx = createContext<PlannerCtx | null>(null);
export const usePlanner = () => {
  const c = useContext(Ctx);
  if (!c) throw new Error('planner yok');
  return c;
};

export function PlannerProvider({ children }: { children: ReactNode }) {
  const { project, mutate, toast } = useStore();
  const [account, setAccount] = useState<PlannerCtx['account']>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const latest = useLatest(project);
  const busyRef = useRef(false);
  const cfg = { clientId: project.planner.clientId, tenantId: project.planner.tenantId };
  const mode = project.planner.mode;
  const configured = mode === 'flow' ? !!project.planner.flowFolder : !!cfg.clientId;

  useEffect(() => {
    if (!isDesktop || !cfg.clientId || mode !== 'graph') {
      setAccount(null);
      return;
    }
    api.plannerStatus(cfg).then((r) => setAccount(r.ok ? r.data.account : null));
  }, [cfg.clientId, cfg.tenantId, mode]); // eslint-disable-line react-hooks/exhaustive-deps

  const apply = useCallback(
    (r: SyncResult) => {
      mutate((d) => Object.assign(d, applySync(d, r)));
      const errs = r.log.filter((l) => l.kind === 'err').length;
      return errs;
    },
    [mutate],
  );

  const guarded = async (label: string, fn: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(label);
    try {
      await fn();
    } finally {
      busyRef.current = false;
      setBusy(null);
    }
  };

  const signIn = () =>
    guarded('Microsoft girişi bekleniyor… (tarayıcıda açılan pencereyi tamamlayın)', async () => {
      const r = await api.plannerSignIn(cfg);
      if (r.ok) {
        setAccount(r.data);
        toast(`${r.data.username} ile bağlandı`);
      } else toast(`Giriş başarısız: ${r.error}`, 'err');
    });

  const signOut = async () => {
    await api.plannerSignOut(cfg);
    setAccount(null);
    toast('Microsoft hesabından çıkış yapıldı');
  };

  const plans = async () => {
    const r = await api.plannerPlans(cfg);
    if (!r.ok) {
      toast(`Planlar alınamadı: ${r.error}`, 'err');
      return [];
    }
    return r.data;
  };

  const push = (ids: string[]) =>
    guarded(`${ids.length} atama Planner'a gönderiliyor…`, async () => {
      const r = latest.current.planner.mode === 'flow' ? await api.flowPush({ project: latest.current, ids }) : await api.plannerPush({ project: latest.current, ids });
      if (!r.ok) return toast(`Planner: ${r.error}`, 'err');
      const errs = apply(r.data);
      const sent = r.data.log.filter((l) => l.kind === 'ok').length;
      toast(errs ? `${errs} satır gönderilemedi; ayrıntılar Planner günlüğünde` : latest.current.planner.mode === 'flow' ? `${sent} istek Power Automate'e bırakıldı` : `${sent} işlem tamamlandı`, errs ? 'warn' : 'ok');
    });

  const pull = useCallback(
    (quiet = false) =>
      guarded('Planner kontrol ediliyor…', async () => {
        const r = latest.current.planner.mode === 'flow' ? await api.flowPull({ project: latest.current }) : await api.plannerPull({ project: latest.current });
        if (!r.ok) {
          if (!quiet) toast(`Planner: ${r.error}`, 'err');
          return;
        }
        const closed = r.data.patches.filter((x) => x.fields.workStatus === 'Kapandı').length;
        if (r.data.patches.length || r.data.log.length || !quiet) apply(r.data);
        if (closed) toast(`Planner'da ${closed} görev tamamlanmış; gereksinimler kapatıldı`);
        else if (!quiet) toast('Planner kontrol edildi');
      }),
    [apply], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Uygulama açıkken düzenli kontrol
  const minutes = project.planner.pollMinutes;
  const ready = mode === 'flow' ? !!project.planner.flowFolder : !!account && !!project.planner.planId;
  useEffect(() => {
    if (!ready || !minutes) return;
    pull(true);
    const t = setInterval(() => pull(true), minutes * 60_000);
    return () => clearInterval(t);
  }, [ready, minutes, pull]);

  const value: PlannerCtx = { account, busy, configured, ready, mode, signIn, signOut, plans, push, pull };
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

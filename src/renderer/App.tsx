import { useCallback, useEffect, useState } from 'react';
import { newProject } from '../shared/model';
import { sampleProject } from '../shared/sample';
import { totals } from '../shared/summary';
import type { Project } from '../shared/types';
import { api, isDesktop } from './api';
import { Modal } from './components/Modal';
import { usePlanner } from './planner';
import { useStore } from './store';
import { TABS, type TabKey } from './tabs';
import { OverviewTab } from './tabs/Overview';
import { PlannerTab } from './tabs/PlannerTab';
import { DocumentsTab, IssuesTab, PeopleTab, RequirementsTab } from './tabs/Tables';

function navCount(p: Project, key: TabKey): { n: number | string; tone?: string } | null {
  const t = totals(p);
  switch (key) {
    case 'documents': return { n: p.documents.length };
    case 'requirements': return t.overdue ? { n: `${t.overdue}!`, tone: 'rose' } : { n: p.requirements.length };
    case 'issues': return t.issuesOpen ? { n: t.issuesOpen, tone: 'peach' } : null;
    case 'people': return { n: p.people.length };
    default: return null;
  }
}

export function App() {
  const { project, filePath, dirty, replace, setPath, markSaved, toast, toasts, undo, redo } = useStore();
  const planner = usePlanner();
  const [tab, setTab] = useState<TabKey>('overview');
  const [settings, setSettings] = useState(false);
  const [welcome, setWelcome] = useState(true);
  const [recent, setRecent] = useState<string[]>([]);
  const [recovery, setRecovery] = useState<{ path?: string; data: Project; at: string } | null>(null);

  useEffect(() => {
    api.recent().then(setRecent);
    api.recovery().then((r) => r && setRecovery(r));
    const h = () => setSettings(true);
    window.addEventListener('open-settings', h);
    return () => window.removeEventListener('open-settings', h);
  }, []);

  const confirmDiscard = () => !dirty || window.confirm('Kaydedilmemiş değişiklikler kaybolacak. Devam edilsin mi?');

  const save = useCallback(
    async (saveAs = false) => {
      const target = await api.saveProject({ path: filePath, data: project, saveAs });
      if (!target) return false;
      setPath(target);
      markSaved();
      toast('Proje kaydedildi');
      return true;
    },
    [filePath, project, setPath, markSaved, toast],
  );

  const open = useCallback(
    async (file?: string) => {
      if (!confirmDiscard()) return;
      try {
        const r = await api.openProject(file);
        if (!r) return;
        replace(r.data, r.path);
        setWelcome(false);
        setTab('overview');
      } catch (e) {
        toast(`Dosya açılamadı: ${e instanceof Error ? e.message : e}`, 'err');
      }
    },
    [dirty, replace, toast], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const start = (p: Project) => {
    if (!confirmDiscard()) return;
    replace(p, undefined, false);
    setWelcome(false);
    setTab('overview');
  };

  const exportExcel = useCallback(async () => {
    if (!isDesktop) return toast('Excel raporu masaüstü uygulamasında çalışır.', 'warn');
    const out = await api.exportExcel(project);
    if (out) {
      toast('Excel raporu oluşturuldu');
      api.openPath(out);
    }
  }, [project, toast]);

  useEffect(
    () =>
      api.onMenu(async (id) => {
        if (id === 'new') start(newProject());
        else if (id === 'open') open();
        else if (id === 'save') save();
        else if (id === 'saveAs') save(true);
        else if (id === 'export') exportExcel();
        else if (id === 'sample') start(sampleProject());
        else if (id === 'undo') undo();
        else if (id === 'redo') redo();
        else if (id === 'save-and-quit') {
          if (await save()) api.quit();
        }
      }),
    [open, save, exportExcel, undo, redo], // eslint-disable-line react-hooks/exhaustive-deps
  );
  useEffect(() => api.onOpenFile((p) => open(p)), [open]);
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod || isDesktop) return; // masaüstünde menü kısayolları çalışır
      if (e.key === 's') {
        e.preventDefault();
        save();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [save]);

  const meta = TABS.find((t) => t.key === tab)!;
  const groups = [...new Set(TABS.map((t) => t.group))];
  const title = project.meta.name || project.meta.partNumber || 'Adsız proje';

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          <div className="logo">GT</div>
          <div>
            <b>Gereksinim Takip</b>
            <small>{title}</small>
          </div>
        </div>
        {groups.map((g) => (
          <div key={g}>
            <div className="nav-group">{g}</div>
            {TABS.filter((t) => t.group === g).map((t) => {
              const c = navCount(project, t.key);
              return (
                <button key={t.key} className={`nav ${tab === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>
                  <span className={`ico ${t.tone}`}>{t.icon}</span>
                  <span className="lbl">{t.label}</span>
                  {c && <span className={`cnt ${c.tone ?? ''}`}>{c.n}</span>}
                </button>
              );
            })}
          </div>
        ))}
        <span className="grow" />
        <div className="side-foot">
          <div className="sync-chip" title={planner.busy ?? ''}>
            <span className={`dot ${planner.ready ? 'on' : 'off'}`} />
            {planner.busy ? 'Planner senkronu…' : planner.ready ? (planner.mode === 'flow' ? 'Planner: Power Automate' : `Planner: ${project.planner.planTitle || 'bağlı'}`) : 'Planner bağlı değil'}
          </div>
          <div className="file">{filePath ? filePath : 'Kaydedilmedi'}{dirty ? ' •' : ''}</div>
        </div>
      </aside>

      <main className="main">
        <header className="head">
          <div>
            <div className="kicker">{meta.group}</div>
            <h1>{meta.title}</h1>
            <p>{meta.hint}</p>
          </div>
          <div className="actions">
            <button className="btn" onClick={() => setWelcome(true)}>
              Proje
            </button>
            <button className="btn" onClick={() => save()}>
              Kaydet
            </button>
            <button className="btn" onClick={exportExcel}>
              Excel raporu
            </button>
            <button className="btn" onClick={() => setSettings(true)}>
              ⚙ Ayarlar
            </button>
          </div>
        </header>
        <div className="content">
          {tab === 'overview' && <OverviewTab go={setTab} />}
          {tab === 'documents' && <DocumentsTab />}
          {tab === 'requirements' && <RequirementsTab />}
          {tab === 'issues' && <IssuesTab />}
          {tab === 'people' && <PeopleTab />}
          {tab === 'planner' && <PlannerTab />}
        </div>
      </main>

      {welcome && (
        <div className="modal-back">
          <div className="welcome">
            <div className="w-head">
              <div className="logo big">GT</div>
              <div>
                <h1>Gereksinim Takip</h1>
                <p>Dokümanlardan gereksinim listesi, kanıt planı, mühendis ataması ve Teams Planner takibi.</p>
              </div>
            </div>
            <div className="w-grid">
              <button className="w-card lav" onClick={() => start(newProject())}>
                <b>Yeni proje</b>
                <span>Boş bir gereksinim listesiyle başlayın.</span>
              </button>
              <button className="w-card mint" onClick={() => open()}>
                <b>Proje aç</b>
                <span>Kayıtlı .greq dosyasını açın.</span>
              </button>
              <button className="w-card peach" onClick={() => start(sampleProject())}>
                <b>Örnek proje</b>
                <span>Ekranları örnek verilerle inceleyin.</span>
              </button>
            </div>
            {recovery && (
              <div className="callout peach" style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
                <span style={{ flex: 1 }}>Kaydedilmemiş bir çalışma bulundu ({new Date(recovery.at).toLocaleString('tr-TR')}).</span>
                <button
                  className="btn small"
                  onClick={() => {
                    replace(recovery.data, recovery.path, false);
                    setRecovery(null);
                    setWelcome(false);
                  }}
                >
                  Geri yükle
                </button>
                <button
                  className="btn small"
                  onClick={() => {
                    api.discardRecovery();
                    setRecovery(null);
                  }}
                >
                  Sil
                </button>
              </div>
            )}
            {recent.length > 0 && (
              <div className="w-recent">
                <h3>Son açılanlar</h3>
                {recent.map((f) => (
                  <button key={f} className="link" onClick={() => open(f)}>
                    {f}
                  </button>
                ))}
              </div>
            )}
            <div className="w-flow">
              <div>
                <b>1 · Yükle</b>Word, Excel, teknik resim, e-posta
              </div>
              <div>
                <b>2 · Kontrol et</b>Gereksinim, kanıt ve açık konular
              </div>
              <div>
                <b>3 · Ata</b>Tasarım, konfigürasyon, imalat + miat
              </div>
              <div>
                <b>4 · Takip et</b>Planner'da kapanan iş burada kapanır
              </div>
            </div>
          </div>
        </div>
      )}

      {settings && <SettingsDialog onClose={() => setSettings(false)} />}

      <div className="toasts">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.msg}
          </div>
        ))}
      </div>
    </div>
  );
}

function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { toast } = useStore();
  const [key, setKey] = useState('');
  const [status, setStatus] = useState<{ configured: boolean; fromEnv: boolean } | null>(null);
  useEffect(() => {
    api.aiStatus().then(setStatus);
  }, []);
  const saveKey = async (k: string) => {
    await api.aiSetKey(k);
    setStatus(await api.aiStatus());
    setKey('');
    toast(k ? 'API anahtarı kaydedildi' : 'API anahtarı silindi');
  };
  return (
    <Modal icon="⚙" title="Ayarlar" onClose={onClose} foot={<button className="btn" onClick={onClose}>Kapat</button>}>
      <h3>Claude (AI) – gereksinim çıkarma</h3>
      <p className="muted" style={{ marginTop: 0 }}>
        Durum: {status?.configured ? (status.fromEnv ? 'ANTHROPIC_API_KEY ortam değişkeninden' : 'anahtar kayıtlı') : 'anahtar yok'}. Anahtar işletim sisteminin şifreli deposunda saklanır.
      </p>
      <div className="form">
        <label className="wide">
          <span>Claude API anahtarı</span>
          <input className="cell-input" type="password" value={key} placeholder="sk-ant-…" onChange={(e) => setKey(e.target.value)} />
        </label>
      </div>
      <div className="row-btns">
        <button className="btn primary" disabled={!key} onClick={() => saveKey(key)}>
          Kaydet
        </button>
        {status?.configured && !status.fromEnv && (
          <button className="btn danger" onClick={() => saveKey('')}>
            Anahtarı sil
          </button>
        )}
      </div>
      <div className="callout">AI çıkarma, yüklenen dokümanları Anthropic API'sine gönderir. Gizli dokümanlar için kurum politikanızı kontrol edin.</div>
    </Modal>
  );
}

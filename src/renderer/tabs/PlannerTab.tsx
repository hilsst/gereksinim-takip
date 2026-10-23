import { useEffect, useState } from 'react';
import { IN_DIR, OUT_DIR } from '../../shared/flow';
import { api } from '../api';
import { TextCell } from '../components/Cells';
import { isDesktop } from '../api';
import { usePlanner } from '../planner';
import { useStore } from '../store';

function GraphPlanner() {
  const { project, mutate } = useStore();
  const planner = usePlanner();
  const [plans, setPlans] = useState<{ id: string; title: string }[] | null>(null);
  const pl = project.planner;
  const set = (k: 'clientId' | 'tenantId' | 'pollMinutes', v: unknown) =>
    mutate((d) => {
      if (k === 'pollMinutes') d.planner.pollMinutes = Math.max(0, Number(v) || 0);
      else d.planner[k] = String(v).trim();
    });
  const choose = (id: string) => {
    const p = plans?.find((x) => x.id === id);
    mutate((d) => {
      if (d.planner.planId !== id) d.planner.buckets = {};
      d.planner.planId = id;
      d.planner.planTitle = p?.title ?? '';
    });
  };
  const linked = [...project.requirements, ...project.issues].filter((r) => r.plannerTaskId).length;

  return (
    <div className="two-col">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card">
          <h3>
            <span className="ico rose">1</span> Bağlantı
          </h3>
          <div className="form">
            <label className="wide">
              <span>Uygulama (client) ID</span>
              <TextCell value={pl.clientId} onCommit={(v) => set('clientId', v)} />
            </label>
            <label className="wide">
              <span>Dizin (tenant) ID</span>
              <TextCell value={pl.tenantId} onCommit={(v) => set('tenantId', v)} />
            </label>
          </div>
          <div className="row-btns">
            {planner.account ? (
              <>
                <span className="sync-chip">
                  <span className="dot on" /> {planner.account.name || planner.account.username} · {planner.account.username}
                </span>
                <button className="btn small" onClick={planner.signOut}>
                  Çıkış
                </button>
              </>
            ) : (
              <button className="btn primary" disabled={!pl.clientId || !isDesktop || !!planner.busy} onClick={planner.signIn}>
                Microsoft ile giriş yap
              </button>
            )}
          </div>
        </div>

        <div className="card">
          <h3>
            <span className="ico rose">2</span> Plan
          </h3>
          <p className="muted" style={{ marginTop: 0 }}>
            Görevler bu plana açılır; her disiplin için bir kova (Tasarım, Konfigürasyon, İmalat) otomatik oluşturulur.
          </p>
          <div className="row-btns" style={{ alignItems: 'center' }}>
            <button className="btn soft" disabled={!planner.account} onClick={async () => setPlans(await planner.plans())}>
              Planlarımı listele
            </button>
            {plans && (
              <select className="filter" value={pl.planId} onChange={(e) => choose(e.target.value)}>
                <option value="">Plan seçin…</option>
                {plans.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title}
                  </option>
                ))}
              </select>
            )}
            {!plans && pl.planId && <span className="badge b-mint">{pl.planTitle || pl.planId}</span>}
          </div>
          {plans && plans.length === 0 && <div className="callout peach">Üyesi olduğunuz plan bulunamadı. Teams'de bir kanal sekmesine Planner ekleyip plan oluşturun.</div>}
        </div>

        <div className="card">
          <h3>
            <span className="ico rose">3</span> Senkron
          </h3>
          <div className="form">
            <label>
              <span>Otomatik kontrol (dakika, 0 = kapalı)</span>
              <TextCell value={pl.pollMinutes} onCommit={(v) => set('pollMinutes', v)} />
            </label>
            <label>
              <span>Son kontrol</span>
              <div className="cell-ro">{pl.lastSync ? new Date(pl.lastSync).toLocaleString('tr-TR') : '–'}</div>
            </label>
          </div>
          <div className="row-btns">
            <button className="btn sky" disabled={!planner.account || !pl.planId || !!planner.busy} onClick={() => planner.pull()}>
              ↻ Şimdi kontrol et
            </button>
            <span className="muted" style={{ alignSelf: 'center' }}>
              {linked} kayıt Planner görevine bağlı
            </span>
          </div>
          <div className="callout mint">
            Planner'da görev <b>tamamlandı</b> işaretlenince satır “Kapandı” olur ve görev açıklamasındaki “Kapanış açıklamasını bu çizginin altına yazın” satırının altındaki metin <b>Kapanış Açıklaması</b> alanına eklenir.
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card">
          <h3>
            <span className="ico lav">i</span> İlk kurulum (bir kez)
          </h3>
          <ol className="steps">
            <li>
              <b>portal.azure.com → Microsoft Entra ID → Uygulama kayıtları → Yeni kayıt</b>. Ad: "Gereksinim Takip", hesap türü: yalnızca bu kuruluş.
            </li>
            <li>
              <b>Kimlik doğrulama → Platform ekle → Mobil ve masaüstü uygulamaları</b>, yönlendirme URI'si <code>http://localhost</code>.
            </li>
            <li>
              <b>API izinleri → Microsoft Graph → Temsilci izinleri</b>: <code>Tasks.ReadWrite</code> ve <code>User.ReadBasic.All</code>. Kuruluşunuz kullanıcı onayına izin vermiyorsa BT'den "yönetici onayı" isteyin.
            </li>
            <li>Genel bakıştaki <b>Uygulama (istemci) kimliği</b> ve <b>Dizin (kiracı) kimliği</b> değerlerini soldaki alanlara yapıştırın.</li>
          </ol>
          <div className="callout">Yeni "Premium" Planner planları Graph üzerinden erişilemez; standart (Teams ekibine bağlı) bir plan kullanın.</div>
        </div>
        <div className="card">
          <h3>
            <span className="ico sky">≡</span> Günlük
          </h3>
          {project.syncLog.length === 0 ? (
            <p className="muted">Henüz senkron yapılmadı.</p>
          ) : (
            <ul className="log">
              {project.syncLog.slice(0, 200).map((l, i) => (
                <li key={i}>
                  <span className={`k ${l.kind}`} />
                  <time>{new Date(l.at).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}</time>
                  <span>{l.text}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

export function PlannerTab() {
  const { project, mutate } = useStore();
  const mode = project.planner.mode;
  const setMode = (m: 'flow' | 'graph') => mutate((d) => void (d.planner.mode = m));
  return (
    <>
      <div className="seg">
        <button className={mode === 'flow' ? 'on' : ''} onClick={() => setMode('flow')}>
          <b>Power Automate</b>
          <span>Azure kaydı gerekmez · OneDrive/SharePoint klasörü üzerinden</span>
        </button>
        <button className={mode === 'graph' ? 'on' : ''} onClick={() => setMode('graph')}>
          <b>Doğrudan bağlantı (Graph)</b>
          <span>Azure uygulama kaydı gerekir · anlık, miat/kişi değişikliği iki yönlü</span>
        </button>
      </div>
      {mode === 'flow' ? <FlowPlanner /> : <GraphPlanner />}
    </>
  );
}

function SyncLog() {
  const { project } = useStore();
  return (
    <div className="card">
      <h3>
        <span className="ico sky">≡</span> Günlük
      </h3>
      {project.syncLog.length === 0 ? (
        <p className="muted">Henüz senkron yapılmadı.</p>
      ) : (
        <ul className="log">
          {project.syncLog.slice(0, 200).map((l, i) => (
            <li key={i}>
              <span className={`k ${l.kind}`} />
              <time>{new Date(l.at).toLocaleString('tr-TR', { dateStyle: 'short', timeStyle: 'short' })}</time>
              <span>{l.text}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function FlowPlanner() {
  const { project, mutate, toast } = useStore();
  const planner = usePlanner();
  const pl = project.planner;
  const [status, setStatus] = useState<{ waitingOut: number; waitingIn: number } | null>(null);
  useEffect(() => {
    if (!pl.flowFolder || !isDesktop) return setStatus(null);
    api.flowStatus(pl.flowFolder).then((r) => setStatus(r.ok ? r.data : null));
  }, [pl.flowFolder, pl.lastSync, project.syncLog.length]);
  const pick = async () => {
    const f = await api.flowPickFolder();
    if (f) {
      mutate((d) => void (d.planner.flowFolder = f));
      toast(`Klasör hazır: ${OUT_DIR} ve ${IN_DIR} alt klasörleri oluşturuldu`);
    }
  };
  const queued = [...project.requirements, ...project.issues].filter((r) => r.plannerEtag === 'flow:kuyrukta').length;
  const linked = [...project.requirements, ...project.issues].filter((r) => r.plannerTaskId).length;
  return (
    <div className="two-col">
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <div className="card">
          <h3>
            <span className="ico rose">1</span> Alışveriş klasörü
          </h3>
          <p className="muted" style={{ marginTop: 0 }}>
            OneDrive veya SharePoint ile senkron bir klasör seçin (ör. <code>OneDrive - Şirket\GereksinimTakip</code>). Uygulama <code>{OUT_DIR}</code> klasörüne istek yazar, akışlar <code>{IN_DIR}</code> klasörüne sonuç bırakır.
          </p>
          <div className="row-btns" style={{ alignItems: 'center' }}>
            <button className="btn primary" disabled={!isDesktop} onClick={pick}>
              Klasör seç
            </button>
            {pl.flowFolder && <span className="badge b-mint">{pl.flowFolder}</span>}
          </div>
          {status && (
            <div className="row-btns">
              <span className="badge b-sky">Akışın alması beklenen istek: {status.waitingOut}</span>
              <span className="badge b-lav">Okunmayı bekleyen sonuç: {status.waitingIn}</span>
            </div>
          )}
        </div>
        <div className="card">
          <h3>
            <span className="ico rose">2</span> Senkron
          </h3>
          <div className="form">
            <label>
              <span>Gelen klasörünü kontrol (dakika, 0 = kapalı)</span>
              <TextCell value={pl.pollMinutes} onCommit={(v) => mutate((d) => void (d.planner.pollMinutes = Math.max(0, Number(v) || 0)))} />
            </label>
            <label>
              <span>Son kontrol</span>
              <div className="cell-ro">{pl.lastSync ? new Date(pl.lastSync).toLocaleString('tr-TR') : '–'}</div>
            </label>
          </div>
          <div className="row-btns">
            <button className="btn sky" disabled={!planner.ready || !!planner.busy} onClick={() => planner.pull()}>
              ↻ Şimdi kontrol et
            </button>
            <span className="muted" style={{ alignSelf: 'center' }}>
              {linked} kayıt görevine bağlı · {queued} kayıt akışı bekliyor
            </span>
          </div>
          <div className="callout mint">
            Planner'da görev <b>tamamlandı</b> işaretlenince akış görev açıklamasını gelen klasörüne yazar; uygulama satırı “Kapandı” yapar ve ayraç çizgisinin altındaki metni <b>Kapanış Açıklaması</b> alanına ekler.
          </div>
        </div>
        <SyncLog />
      </div>
      <div className="card">
        <h3>
          <span className="ico lav">i</span> Power Automate akışları (bir kez kurulur)
        </h3>
        <p className="muted" style={{ marginTop: 0 }}>
          Ayrıntılı tarif, ifadeler ve JSON şeması depodaki <code>docs/power-automate.md</code> dosyasında. Tüm bağlayıcılar standart lisansla çalışır.
        </p>
        <h4 className="mini">Akış 1 · GT – Görev oluştur</h4>
        <ol className="steps">
          <li><b>OneDrive for Business – Dosya oluşturulduğunda</b> · klasör: <code>…/{OUT_DIR}</code></li>
          <li><b>JSON ayrıştır</b> · içerik: <code>{"json(base64ToString(triggerBody()?['$content']))"}</code></li>
          <li><b>Koşul</b> · <code>islem</code> = <code>olustur</code></li>
          <li>Evet: <b>Planner – Demetleri listele</b> → <b>Diziyi filtrele</b> (ad = <code>kova</code>) → <b>Görev oluştur</b> (başlık, demet, bitiş tarihi, atanan: <code>sorumluEposta</code>) → <b>Görev ayrıntılarını güncelleştir</b> (açıklama: <code>aciklama</code>) → <b>Dosya oluştur</b> <code>…/{IN_DIR}</code> (olay: olusturuldu, kayitId, gorevId)</li>
          <li>Hayır: <b>Görevi güncelleştir</b> (görev kimliği: <code>gorevId</code>, başlık, bitiş tarihi)</li>
          <li><b>Dosyayı sil</b> · tetikleyen dosya</li>
        </ol>
        <h4 className="mini">Akış 2 · GT – Görev tamamlandı</h4>
        <ol className="steps">
          <li><b>Planner – Görev tamamlandığında</b> · grup ve plan</li>
          <li><b>Koşul</b> · başlık <code>REQ-</code> veya <code>ISS-</code> ile başlıyor</li>
          <li><b>Görev ayrıntılarını al</b> → <b>Oluştur (Compose)</b> olay: tamamlandi, gorevId, baslik, aciklama, tamamlanmaTarihi</li>
          <li><b>Dosya oluştur</b> · <code>…/{IN_DIR}</code>, ad: <code>tamamlandi_&lt;görev kimliği&gt;.json</code></li>
        </ol>
        <div className="callout peach">
          Bu modda görevler akışı kuran kişinin hesabıyla açılır. Planner'da elle değiştirilen miat uygulamaya geri gelmez; sorumlu değişikliğinde eski kişiyi Planner'dan elle çıkarın.
        </div>
      </div>
    </div>
  );
}

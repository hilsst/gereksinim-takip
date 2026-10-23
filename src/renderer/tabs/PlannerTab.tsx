import { useState } from 'react';
import { TextCell } from '../components/Cells';
import { isDesktop } from '../api';
import { usePlanner } from '../planner';
import { useStore } from '../store';

export function PlannerTab() {
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

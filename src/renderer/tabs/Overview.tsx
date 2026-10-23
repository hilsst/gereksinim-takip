import { TextCell } from '../components/Cells';
import { personSummary, totals } from '../../shared/summary';
import type { ProjectMeta } from '../../shared/types';
import { useStore } from '../store';
import type { TabKey } from '../tabs';

const META: [keyof ProjectMeta, string][] = [
  ['name', 'Proje adı'], ['customer', 'Müşteri'], ['partNumber', 'Parça / montaj no'], ['partName', 'Parça adı'],
  ['program', 'Program'], ['drawingRevision', 'Resim revizyonu'], ['owner', 'Proje sorumlusu'], ['startDate', 'Başlangıç'],
];

export function OverviewTab({ go }: { go: (t: TabKey) => void }) {
  const { project, mutate } = useStore();
  const t = totals(project);
  const people = personSummary(project).filter((x) => x.total > 0);
  const setMeta = (k: keyof ProjectMeta, v: unknown) => mutate((d) => void (d.meta[k] = String(v)));

  const tiles: [string, number, string, TabKey][] = [
    ['Gereksinim', t.requirements, 'lav', 'requirements'],
    ['Açık konu', t.issuesOpen, 'peach', 'issues'],
    ['Atanmamış', t.unassigned, 'butter', 'requirements'],
    ['Planner\'a gönderilmemiş', t.notSent, 'sky', 'requirements'],
    ['Gecikmiş', t.overdue, 'rose', 'requirements'],
    ['Kapanan', t.closed, 'mint', 'requirements'],
  ];

  return (
    <>
      <div className="tiles">
        {tiles.map(([l, v, c, tab]) => (
          <button key={l} className={`tile ${c}`} onClick={() => go(tab)}>
            <span className="tile-v">{v}</span>
            <span className="tile-l">{l}</span>
          </button>
        ))}
      </div>
      <div className="two-col">
        <div className="card">
          <h3>
            <span className="ico lav">◆</span> Proje bilgileri
          </h3>
          <div className="form">
            {META.map(([k, l]) => (
              <label key={k}>
                <span>{l}</span>
                <TextCell value={project.meta[k]} type={k === 'startDate' ? 'date' : 'text'} onCommit={(v) => setMeta(k, v)} />
              </label>
            ))}
            <label className="wide">
              <span>Kapsam / notlar</span>
              <TextCell value={project.meta.scope} multiline onCommit={(v) => setMeta('scope', v)} />
            </label>
          </div>
        </div>
        <div className="card">
          <h3>
            <span className="ico mint">●</span> Kişi bazında durum
          </h3>
          {people.length === 0 ? (
            <p className="muted">Henüz atama yok. Gereksinimler ekranında satırları seçip “Ata” ile sorumlu ve miat verin.</p>
          ) : (
            <>
              <table className="people">
                <thead>
                  <tr>
                    <th>Kişi</th>
                    <th>Disiplin</th>
                    <th>Açık</th>
                    <th>Gecikmiş</th>
                    <th>Kapanan</th>
                    <th>Zamanında</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {people.map((s) => (
                    <tr key={s.personId}>
                      <td>{s.name}</td>
                      <td className="muted">{s.discipline}</td>
                      <td className="n">{s.open}</td>
                      <td className="n">{s.overdue ? <span className="badge b-rose">{s.overdue}</span> : 0}</td>
                      <td className="n">{s.closed}</td>
                      <td className="n">{s.onTimeRate == null ? '–' : `%${s.onTimeRate}`}</td>
                      <td>
                        <div className="bar" title={`${s.closed} kapandı · ${s.open - s.overdue} açık · ${s.overdue} gecikmiş`}>
                          <i className="c" style={{ width: `${(s.closed / s.total) * 100}%` }} />
                          <i className="o" style={{ width: `${((s.open - s.overdue) / s.total) * 100}%` }} />
                          <i className="l" style={{ width: `${(s.overdue / s.total) * 100}%` }} />
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <div className="legend">
                <span style={{ ['--c' as string]: 'var(--mint-mid)' }}>Kapandı</span>
                <span style={{ ['--c' as string]: 'var(--sky-mid)' }}>Açık</span>
                <span style={{ ['--c' as string]: 'var(--rose-mid)' }}>Gecikmiş</span>
              </div>
            </>
          )}
          {(t.noData > 0 || t.noEvidence > 0) && (
            <div className="callout peach">
              {t.noData > 0 && <div>{t.noData} gereksinimde kabul kriteri “VERİ YOK”.</div>}
              {t.noEvidence > 0 && <div>{t.noEvidence} gereksinimde kanıt türü boş.</div>}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

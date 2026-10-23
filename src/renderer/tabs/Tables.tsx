import { useState } from 'react';
import { isClosed, isOverdue, LISTS } from '../../shared/model';
import type { AnyRow, Assignable, AssignableTable, DocumentRow } from '../../shared/types';
import { api } from '../api';
import { PasteDialog, useExtraction } from '../components/Ai';
import { AssignDialog } from '../components/AssignDialog';
import { Grid } from '../components/Grid';
import { usePlanner } from '../planner';
import { useStore } from '../store';

export function DocumentsTab() {
  const { project } = useStore();
  const ai = useExtraction();
  const [paste, setPaste] = useState(false);
  const [sel, setSel] = useState<string[]>([]);
  const doc = sel.length === 1 ? project.documents.find((d) => d.id === sel[0]) : undefined;
  return (
    <>
      <Grid
        table="documents"
        selected={sel}
        onSelect={setSel}
        toolbar={() => (
          <>
            <button className="btn ai" onClick={() => ai.upload()}>
              ✦ Doküman yükle ve çıkar
            </button>
            <button className="btn soft" onClick={() => setPaste(true)}>
              ✉ Metin yapıştır
            </button>
            <button className="btn" disabled={!doc?.filePath} onClick={() => doc && ai.upload(doc as DocumentRow)}>
              Seçiliyi tekrar çıkar
            </button>
            <button className="btn" disabled={!doc?.filePath} onClick={() => doc && api.openPath(doc.filePath)}>
              Dosyayı aç
            </button>
          </>
        )}
        emptyHint={
          <>
            Word, Excel, PDF teknik resim, görsel veya Outlook e-postası (.msg / .eml) yükleyin.
            <br />
            Claude gereksinimleri, kanıt yöntemlerini ve açık konuları çıkarır; siz onaylayarak eklersiniz.
          </>
        }
      />
      {paste && <PasteDialog onRun={ai.fromText} onClose={() => setPaste(false)} />}
      {ai.dialogs}
    </>
  );
}

type View = 'all' | 'unassigned' | 'open' | 'late' | 'closed' | 'noEvidence';
const VIEWS: [View, string][] = [['all', 'Tümü'], ['unassigned', 'Atanmamış'], ['open', 'Açık atamalar'], ['late', 'Gecikmiş'], ['closed', 'Kapanan'], ['noEvidence', 'Kanıtı eksik']];

function viewFilter(view: View, discipline: string, person: string) {
  return (r: AnyRow) => {
    const a = r as unknown as Assignable & { evidenceType?: string };
    if (discipline && a.discipline !== discipline) return false;
    if (person && a.assignee !== person) return false;
    switch (view) {
      case 'unassigned': return !a.assignee && !isClosed(a);
      case 'open': return !!a.assignee && !isClosed(a);
      case 'late': return isOverdue(a);
      case 'closed': return a.workStatus === 'Kapandı';
      case 'noEvidence': return 'evidenceType' in a && !a.evidenceType;
      default: return true;
    }
  };
}

function AssignableTab({ table }: { table: AssignableTable }) {
  const { project, mutate, toast } = useStore();
  const planner = usePlanner();
  const [sel, setSel] = useState<string[]>([]);
  const [assign, setAssign] = useState(false);
  const [view, setView] = useState<View>('all');
  const [discipline, setDiscipline] = useState('');
  const [person, setPerson] = useState('');
  const canSend = !!planner.account && !!project.planner.planId;

  const approve = (ids: string[]) => {
    mutate((d) => {
      for (const r of d.requirements) if (ids.includes(r.id)) r.approval = 'Approved';
    });
    toast(`${ids.length} gereksinim onaylandı`);
  };

  return (
    <>
      <Grid
        table={table}
        selected={sel}
        onSelect={setSel}
        filter={viewFilter(view, discipline, person)}
        toolbar={(s) => (
          <>
            <button className="btn soft" disabled={!s.length} onClick={() => setAssign(true)}>
              👤 Ata{s.length ? ` (${s.length})` : ''}
            </button>
            <button className="btn sky" disabled={!s.length || !canSend || !!planner.busy} title={canSend ? '' : 'Planner sekmesinden giriş yapıp plan seçin'} onClick={() => planner.push(s)}>
              ↗ Planner'a gönder
            </button>
            {table === 'requirements' && (
              <button className="btn mint" disabled={!s.length} onClick={() => approve(s)}>
                ✓ Onayla
              </button>
            )}
          </>
        )}
        filters={
          <>
            <select className="filter" value={view} onChange={(e) => setView(e.target.value as View)}>
              {VIEWS.filter(([v]) => table === 'requirements' || v !== 'noEvidence').map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
            <select className="filter" value={discipline} onChange={(e) => setDiscipline(e.target.value)}>
              <option value="">Tüm disiplinler</option>
              {LISTS.discipline.map((d) => (
                <option key={d}>{d}</option>
              ))}
            </select>
            <select className="filter" value={person} onChange={(e) => setPerson(e.target.value)}>
              <option value="">Tüm kişiler</option>
              {project.people.map((x) => (
                <option key={x.id} value={x.id}>
                  {x.name}
                </option>
              ))}
            </select>
          </>
        }
        emptyHint={table === 'requirements' ? 'Dokümanlar ekranından dosya yükleyerek gereksinim çıkarın veya “+ Satır” ile elle ekleyin.' : 'Dokümanlardan çıkarılamayan bilgiler, çelişkiler ve belirsizlikler burada listelenir.'}
      />
      {assign && <AssignDialog table={table} ids={sel} onClose={() => setAssign(false)} />}
    </>
  );
}

export const RequirementsTab = () => <AssignableTab table="requirements" />;
export const IssuesTab = () => <AssignableTab table="issues" />;

export function PeopleTab() {
  return (
    <>
      <div className="callout">
        Planner ataması kişinin <b>Microsoft 365 e-posta adresiyle</b> yapılır. Kişinin, seçtiğiniz planın bağlı olduğu Teams ekibinin üyesi olması gerekir.
      </div>
      <Grid table="people" emptyHint="Tasarım, konfigürasyon ve imalat mühendislerini ekleyin." />
    </>
  );
}

import { useState } from 'react';
import { activePeople, isClosed, LISTS } from '../../shared/model';
import type { Assignable, AssignableTable, Discipline } from '../../shared/types';
import { usePlanner } from '../planner';
import { useStore } from '../store';
import { Modal } from './Modal';

/** Seçili gereksinim / açık konuları toplu atar; isteğe bağlı olarak hemen Planner'a gönderir. */
export function AssignDialog({ table, ids, onClose }: { table: AssignableTable; ids: string[]; onClose: () => void }) {
  const { project, mutate, toast } = useStore();
  const planner = usePlanner();
  const rows = (project[table] as unknown as (Assignable & { id: string })[]).filter((r) => ids.includes(r.id));
  const first = rows[0];
  const same = <K extends keyof Assignable>(k: K) => (rows.every((r) => r[k] === first?.[k]) ? first?.[k] ?? '' : '');
  const [discipline, setDiscipline] = useState<Discipline>(same('discipline') as Discipline);
  const [assignee, setAssignee] = useState(String(same('assignee')));
  const [dueDate, setDueDate] = useState(String(same('dueDate')));
  const canSend = !!project.planner.planId && !!planner.account;
  const [send, setSend] = useState(canSend);
  const people = activePeople(project, discipline || undefined);
  const closed = rows.filter((r) => isClosed(r)).length;

  const save = async () => {
    mutate((d) => {
      for (const r of d[table] as unknown as (Assignable & { id: string })[]) {
        if (!ids.includes(r.id) || isClosed(r)) continue;
        if (discipline) r.discipline = discipline;
        if (assignee) r.assignee = assignee;
        if (dueDate) r.dueDate = dueDate;
        if (r.assignee && r.workStatus === 'Atanmadı') r.workStatus = 'Atandı';
      }
    });
    toast(`${ids.length - closed} satır atandı`);
    onClose();
    if (send && canSend) setTimeout(() => planner.push(ids), 0);
  };

  return (
    <Modal
      icon="👤"
      title={`${ids.length} kayıt ata`}
      sub="Boş bıraktığınız alanlar değişmez. Kapalı satırlar atlanır."
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>
            Vazgeç
          </button>
          <button className="btn primary" disabled={!discipline && !assignee && !dueDate} onClick={save}>
            {send && canSend ? 'Ata ve Planner\'a gönder' : 'Ata'}
          </button>
        </>
      }
    >
      <div className="form">
        <label>
          <span>Disiplin</span>
          <select className="cell-select" value={discipline} onChange={(e) => setDiscipline(e.target.value as Discipline)}>
            <option value=""></option>
            {LISTS.discipline.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Miat</span>
          <input className="cell-input" type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
        </label>
        <label className="wide">
          <span>Sorumlu mühendis</span>
          <select className="cell-select" value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value=""></option>
            {people.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name} {x.discipline ? `· ${x.discipline}` : ''}
              </option>
            ))}
          </select>
        </label>
        <label className="wide" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <input type="checkbox" checked={send && canSend} disabled={!canSend} onChange={(e) => setSend(e.target.checked)} />
          <span style={{ fontWeight: 400, fontSize: 13 }}>Atamaları hemen Teams Planner'a gönder</span>
        </label>
      </div>
      {!canSend && <div className="callout peach">Planner'a göndermek için önce Planner sekmesinden giriş yapıp bir plan seçin. Atamayı şimdi kaydedip sonra gönderebilirsiniz.</div>}
      {project.people.length === 0 && <div className="callout">Ekip sekmesine tasarım, konfigürasyon ve imalat mühendislerini ekleyin.</div>}
      {closed > 0 && <div className="callout">{closed} kapalı/iptal satır atlanacak.</div>}
    </Modal>
  );
}

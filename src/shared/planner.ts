// Teams Planner senkron mantığı. Graph çağrıları GraphLike arayüzü üzerinden yapılır;
// böylece kurallar ağ olmadan test edilebilir. Fonksiyonlar projeyi değiştirmez, uygulanacak yamaları döner.
import { checklistTitle, mergeMembers, type Member, closureFromDescription, isClosed, LISTS, personName, startDateOf, taskDescription, taskTitle } from './model';
import type { Assignable, AssignableTable, IssueRow, PersonRow, Project, RequirementRow, SyncLogEntry } from './types';

export interface PlannerTask {
  id: string;
  title: string;
  planId: string;
  bucketId: string;
  percentComplete: number;
  dueDateTime: string | null;
  startDateTime?: string | null;
  completedDateTime: string | null;
  completedBy: { user?: { id?: string; displayName?: string } } | null;
  assignments: Record<string, unknown>;
  '@odata.etag': string;
}

export interface GraphLike {
  get<T>(path: string): Promise<T>;
  /** Sayfalı listeyi (@odata.nextLink) sonuna kadar okur. */
  list<T>(path: string): Promise<T[]>;
  post<T>(path: string, body: unknown): Promise<T>;
  /** etag verilirse If-Match başlığıyla gönderilir. Prefer: return=representation ile güncel nesneyi döner. */
  patch<T>(path: string, body: unknown, etag?: string): Promise<T | null>;
}

export class GraphError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export interface RowPatch {
  table: AssignableTable | 'people';
  id: string;
  fields: Record<string, unknown>;
}

export interface SyncResult {
  patches: RowPatch[];
  /** Teams grubundan gelen ekip üyeleri (eksikler Ekip listesine eklenir). */
  members?: Member[];
  planner: Partial<Project['planner']>;
  log: SyncLogEntry[];
}

type Row = (RequirementRow | IssueRow) & Assignable;

const now = () => new Date().toISOString();
const log = (text: string, kind: SyncLogEntry['kind'] = 'ok'): SyncLogEntry => ({ at: now(), text, kind });
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Planner tarih alanı: miat günü yerel 17:00 yerine gün sonu belirsizliği olmasın diye UTC öğlen. */
export const toPlannerDate = (d: string) => (d ? `${d}T12:00:00Z` : null);
export const fromPlannerDate = (d: string | null) => (d ? d.slice(0, 10) : '');

function rowsOf(p: Project): { table: AssignableTable; row: Row }[] {
  return [
    ...p.requirements.map((row) => ({ table: 'requirements' as const, row })),
    ...p.issues.map((row) => ({ table: 'issues' as const, row })),
  ];
}

/** Denetim listesindeki gereksinim maddesinin sabit kimliği (görev başına tek madde). */
export const CHECKLIST_ID = '6a1f0c4e-9b2d-4e7a-8c31-5d0e2f7b9a10';

/** Atanmış satırları Planner'a gönderir: yeni görev açar veya mevcut görevin başlık/miat/kişi/kovasını günceller. */
export async function pushAssignments(g: GraphLike, p: Project, ids: string[]): Promise<SyncResult> {
  const res: SyncResult = { patches: [], planner: {}, log: [] };
  if (!p.planner.planId) throw new Error('Önce Planner sekmesinden bir plan seçin.');
  const buckets = { ...p.planner.buckets };
  const people = new Map(p.people.map((x) => [x.id, { ...x }]));
  let bucketList: { id: string; name: string }[] | null = null;

  const userId = async (person: PersonRow): Promise<string> => {
    if (person.aadId) return person.aadId;
    if (!person.email) throw new Error(`${person.name}: Ekip sekmesinde e-posta yok.`);
    try {
      const u = await g.get<{ id: string }>(`/users/${encodeURIComponent(person.email)}?$select=id,displayName`);
      person.aadId = u.id;
      res.patches.push({ table: 'people', id: person.id, fields: { aadId: u.id } });
      return u.id;
    } catch (e) {
      throw new Error(`${person.name} (${person.email}) Microsoft 365'te bulunamadı: ${errText(e)}`);
    }
  };

  const bucketId = async (discipline: string): Promise<string> => {
    const name = discipline || 'Genel';
    if (buckets[name]) return buckets[name];
    bucketList ??= await g.list<{ id: string; name: string }>(`/planner/plans/${p.planner.planId}/buckets`);
    let b = bucketList.find((x) => x.name.toLocaleLowerCase('tr') === name.toLocaleLowerCase('tr'));
    if (!b) {
      b = await g.post<{ id: string; name: string }>('/planner/buckets', { name, planId: p.planner.planId, orderHint: ' !' });
      bucketList.push(b);
      res.log.push(log(`Planner'da "${name}" kovası oluşturuldu`));
    }
    buckets[name] = b.id;
    res.planner.buckets = buckets;
    return b.id;
  };

  for (const { table, row } of rowsOf(p).filter((x) => ids.includes(x.row.id))) {
    try {
      if (isClosed(row)) {
        res.log.push(log(`${row.id}: kapalı/iptal, gönderilmedi`, 'warn'));
        continue;
      }
      const person = row.assignee ? people.get(row.assignee) : undefined;
      if (!person) throw new Error('sorumlu kişi seçilmemiş');
      if (!row.dueDate) throw new Error('miat girilmemiş');
      const uid = await userId(person);
      const bid = await bucketId(row.discipline);
      const title = taskTitle(p, row);
      const due = toPlannerDate(row.dueDate);
      const start = toPlannerDate(startDateOf(row));

      if (!row.plannerTaskId) {
        const t = await g.post<PlannerTask>('/planner/tasks', {
          planId: p.planner.planId,
          bucketId: bid,
          title,
          dueDateTime: due,
          startDateTime: start,
          assignments: { [uid]: { '@odata.type': '#microsoft.graph.plannerAssignment', orderHint: ' !' } },
        });
        const det = await g.get<{ '@odata.etag': string }>(`/planner/tasks/${t.id}/details`);
        await g.patch(`/planner/tasks/${t.id}/details`, {
          description: taskDescription(p, row),
          previewType: 'checklist',
          checklist: { [CHECKLIST_ID]: { '@odata.type': 'microsoft.graph.plannerChecklistItem', title: checklistTitle(row), isChecked: false } },
        }, det['@odata.etag']);
        res.patches.push({ table, id: row.id, fields: { plannerTaskId: t.id, plannerEtag: t['@odata.etag'], plannerSyncedAt: now(), workStatus: 'Atandı' } });
        res.log.push(log(`${row.id} → ${person.name} için Planner görevi açıldı (miat ${row.dueDate})`));
        continue;
      }

      let t: PlannerTask;
      try {
        t = await g.get<PlannerTask>(`/planner/tasks/${row.plannerTaskId}`);
      } catch (e) {
        if (e instanceof GraphError && e.status === 404) {
          res.patches.push({ table, id: row.id, fields: { plannerTaskId: '', plannerEtag: '' } });
          res.log.push(log(`${row.id}: Planner görevi silinmiş; bağlantı kaldırıldı, tekrar gönderebilirsiniz`, 'warn'));
          continue;
        }
        throw e;
      }
      const body: Record<string, unknown> = {};
      if (t.title !== title) body.title = title;
      if (fromPlannerDate(t.dueDateTime) !== row.dueDate) body.dueDateTime = due;
      if (t.bucketId !== bid) body.bucketId = bid;
      const assigned = Object.keys(t.assignments ?? {});
      if (assigned.length !== 1 || assigned[0] !== uid) {
        const a: Record<string, unknown> = Object.fromEntries(assigned.filter((x) => x !== uid).map((x) => [x, null]));
        if (!assigned.includes(uid)) a[uid] = { '@odata.type': '#microsoft.graph.plannerAssignment', orderHint: ' !' };
        body.assignments = a;
      }
      if (!Object.keys(body).length) {
        res.log.push(log(`${row.id}: Planner görevi zaten güncel`));
        continue;
      }
      const upd = await g.patch<PlannerTask>(`/planner/tasks/${t.id}`, body, t['@odata.etag']);
      res.patches.push({ table, id: row.id, fields: { plannerEtag: upd?.['@odata.etag'] ?? '', plannerSyncedAt: now() } });
      res.log.push(log(`${row.id}: Planner görevi güncellendi (${Object.keys(body).join(', ')})`));
    } catch (e) {
      res.log.push(log(`${row.id}: gönderilemedi – ${errText(e)}`, 'err'));
    }
  }
  return res;
}

/**
 * Plandaki görevleri okur ve uygulamaya yansıtır:
 * tamamlanan görev → satır kapanır, Planner açıklaması kapanış notu olur;
 * %50 → "Devam ediyor"; tamamlanmış görev yeniden açılırsa satır da açılır; Planner'da değişen miat geri alınır.
 */
export async function pullCompletions(g: GraphLike, p: Project): Promise<SyncResult> {
  const res: SyncResult = { patches: [], planner: { lastSync: now() }, log: [] };
  if (!p.planner.planId) throw new Error('Önce Planner sekmesinden bir plan seçin.');
  const linked = rowsOf(p).filter((x) => x.row.plannerTaskId && x.row.workStatus !== 'İptal');
  if (!linked.length) return res;
  const tasks = new Map((await g.list<PlannerTask>(`/planner/plans/${p.planner.planId}/tasks`)).map((t) => [t.id, t]));
  const byAad = new Map(p.people.filter((x) => x.aadId).map((x) => [x.aadId, x]));

  for (const { table, row } of linked) {
    const t = tasks.get(row.plannerTaskId);
    if (!t) {
      res.log.push(log(`${row.id}: bağlı Planner görevi planda bulunamadı (silinmiş veya taşınmış olabilir)`, 'warn'));
      continue;
    }
    const fields: Record<string, unknown> = {};
    const done = t.percentComplete >= 100;
    if (done && row.workStatus !== 'Kapandı') {
      let note = '';
      try {
        const det = await g.get<{ description: string }>(`/planner/tasks/${t.id}/details`);
        note = closureFromDescription(det.description ?? '');
      } catch (e) {
        res.log.push(log(`${row.id}: kapanış açıklaması okunamadı – ${errText(e)}`, 'warn'));
      }
      const uid = t.completedBy?.user?.id ?? '';
      Object.assign(fields, {
        workStatus: 'Kapandı',
        closedAt: t.completedDateTime ?? now(),
        closedBy: byAad.get(uid)?.name ?? t.completedBy?.user?.displayName ?? (row.assignee ? personName(p, row.assignee) : ''),
        closureNote: note,
      });
      if (table === 'issues') fields.status = 'Closed';
      res.log.push(log(`${row.id}: Planner'da tamamlandı, kapatıldı${note ? '' : ' (açıklama boş)'}`, note ? 'ok' : 'warn'));
    } else if (!done && row.workStatus === 'Kapandı') {
      Object.assign(fields, { workStatus: t.percentComplete > 0 ? 'Devam ediyor' : 'Atandı', closedAt: '', closedBy: '' });
      if (table === 'issues') fields.status = 'Open';
      res.log.push(log(`${row.id}: Planner'da görev yeniden açıldı, satır da açıldı`, 'warn'));
    } else if (!done) {
      const st = t.percentComplete > 0 ? 'Devam ediyor' : 'Atandı';
      if (row.workStatus !== st) fields.workStatus = st;
    }
    const due = fromPlannerDate(t.dueDateTime);
    if (due && due !== row.dueDate) {
      fields.dueDate = due;
      res.log.push(log(`${row.id}: miat Planner'da ${row.dueDate || '-'} → ${due} olarak değiştirilmiş`, 'warn'));
    }
    if (Object.keys(fields).length) res.patches.push({ table, id: row.id, fields: { ...fields, plannerEtag: t['@odata.etag'], plannerSyncedAt: now() } });
  }
  return res;
}

export function applySync(p: Project, r: SyncResult): Project {
  const next: Project = structuredClone(p);
  for (const patch of r.patches) {
    const rows = next[patch.table] as unknown as Record<string, unknown>[];
    const row = rows.find((x) => x.id === patch.id);
    if (row) Object.assign(row, patch.fields);
  }
  if (r.members?.length) mergeMembers(next, r.members);
  next.planner = { ...next.planner, ...r.planner };
  next.syncLog = [...r.log.slice().reverse(), ...next.syncLog].slice(0, 500);
  return next;
}

export const WORK_STATUSES = LISTS.workStatus;

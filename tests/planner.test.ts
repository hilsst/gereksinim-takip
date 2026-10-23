import { describe, expect, it } from 'vitest';
import { closureFromDescription, CLOSURE_MARK, taskDescription } from '../src/shared/model';
import { applySync, GraphError, pullCompletions, pushAssignments, type GraphLike, type PlannerTask } from '../src/shared/planner';
import { sampleProject } from '../src/shared/sample';
import { personSummary, totals } from '../src/shared/summary';

/** Bellek içi Planner: istekleri kaydeder, görevleri tutar. */
function fakeGraph() {
  const tasks = new Map<string, PlannerTask>();
  const details = new Map<string, { description: string; '@odata.etag': string }>();
  const buckets: { id: string; name: string }[] = [{ id: 'B-TAS', name: 'Tasarım' }];
  const calls: string[] = [];
  let n = 0;
  const g: GraphLike = {
    async get<T>(path: string) {
      calls.push(`GET ${path}`);
      const u = path.match(/^\/users\/([^?]+)/);
      if (u) {
        const email = decodeURIComponent(u[1]);
        if (email.startsWith('yok')) throw new GraphError(404, 'Not found');
        return { id: `aad-${email}` } as T;
      }
      const d = path.match(/^\/planner\/tasks\/([^/]+)\/details$/);
      if (d) return (details.get(d[1]) ?? { description: '', '@odata.etag': 'e0' }) as T;
      const t = path.match(/^\/planner\/tasks\/([^/]+)$/);
      if (t) {
        const task = tasks.get(t[1]);
        if (!task) throw new GraphError(404, 'Not found');
        return task as T;
      }
      throw new Error(`beklenmeyen GET ${path}`);
    },
    async list<T>(path: string) {
      calls.push(`LIST ${path}`);
      if (path.endsWith('/buckets')) return buckets as T[];
      if (path.endsWith('/tasks')) return [...tasks.values()] as T[];
      throw new Error(path);
    },
    async post<T>(path: string, body: unknown) {
      calls.push(`POST ${path}`);
      const b = body as Record<string, unknown>;
      if (path === '/planner/buckets') {
        const bk = { id: `B-${++n}`, name: String(b.name) };
        buckets.push(bk);
        return bk as T;
      }
      const id = `T-${++n}`;
      const task: PlannerTask = { id, title: String(b.title), planId: String(b.planId), bucketId: String(b.bucketId), percentComplete: 0, dueDateTime: b.dueDateTime as string, completedDateTime: null, completedBy: null, assignments: b.assignments as Record<string, unknown>, '@odata.etag': 'W/1' };
      tasks.set(id, task);
      return task as T;
    },
    async patch<T>(path: string, body: unknown) {
      calls.push(`PATCH ${path}`);
      const d = path.match(/^\/planner\/tasks\/([^/]+)\/details$/);
      if (d) {
        details.set(d[1], { description: String((body as { description: string }).description), '@odata.etag': 'e1' });
        return null;
      }
      const t = tasks.get(path.split('/').pop()!)!;
      const b = body as Record<string, unknown>;
      if (b.assignments) {
        const a = { ...t.assignments };
        for (const [k, v] of Object.entries(b.assignments as Record<string, unknown>)) if (v === null) delete a[k];
        else a[k] = v;
        t.assignments = a;
      }
      Object.assign(t, { ...b, assignments: t.assignments, '@odata.etag': 'W/2' });
      return t as T;
    },
  };
  return { g, tasks, details, buckets, calls };
}

function project() {
  const p = sampleProject();
  p.planner.planId = 'PLAN-1';
  return p;
}

describe('Planner gönderimi', () => {
  it('atanmış satır için görev açar, açıklamayı yazar ve kişiyi eşleştirir', async () => {
    const f = fakeGraph();
    const p = project();
    const r = await pushAssignments(f.g, p, ['REQ-001']);
    const next = applySync(p, r);
    const row = next.requirements.find((x) => x.id === 'REQ-001')!;
    expect(row.plannerTaskId).toMatch(/^T-/);
    expect(row.workStatus).toBe('Atandı');
    const task = f.tasks.get(row.plannerTaskId)!;
    expect(task.bucketId).toBe('B-TAS');
    expect(task.title.startsWith('REQ-001 · ')).toBe(true);
    expect(task.dueDateTime).toBe('2026-11-05T12:00:00Z');
    expect(Object.keys(task.assignments)).toEqual(['aad-ayse.demir@ornek.com']);
    expect(f.details.get(task.id)!.description).toContain(CLOSURE_MARK);
    expect(f.details.get(task.id)!.description).toContain('CATIA kütle raporu');
    expect(next.people.find((x) => x.id === 'P-001')!.aadId).toBe('aad-ayse.demir@ornek.com');
  });

  it('eksik kova oluşturulur, sorumlu/miat yoksa hata günlüğe yazılır', async () => {
    const f = fakeGraph();
    const p = project();
    const r = await pushAssignments(f.g, p, ['REQ-003', 'REQ-004']);
    expect(f.buckets.map((b) => b.name)).toContain('Konfigürasyon');
    expect(r.log.some((l) => l.kind === 'err' && l.text.startsWith('REQ-004'))).toBe(true);
    expect(r.patches.filter((x) => x.table === 'requirements').map((x) => x.id)).toEqual(['REQ-003']);
  });

  it('kapalı satırı göndermez', async () => {
    const f = fakeGraph();
    const r = await pushAssignments(f.g, project(), ['REQ-002']);
    expect(f.calls.some((c) => c.startsWith('POST /planner/tasks'))).toBe(false);
    expect(r.log[0].kind).toBe('warn');
  });

  it('mevcut görevde miat ve sorumlu değişikliğini günceller', async () => {
    const f = fakeGraph();
    let p = project();
    p = applySync(p, await pushAssignments(f.g, p, ['REQ-001']));
    const row = p.requirements.find((x) => x.id === 'REQ-001')!;
    row.dueDate = '2026-11-20';
    row.assignee = 'P-003';
    p = applySync(p, await pushAssignments(f.g, p, ['REQ-001']));
    const task = f.tasks.get(row.plannerTaskId)!;
    expect(task.dueDateTime).toBe('2026-11-20T12:00:00Z');
    expect(Object.keys(task.assignments)).toEqual(['aad-zeynep.arslan@ornek.com']);
  });

  it('Planner\'da silinmiş görevin bağlantısını kaldırır', async () => {
    const f = fakeGraph();
    let p = project();
    p = applySync(p, await pushAssignments(f.g, p, ['REQ-001']));
    f.tasks.clear();
    p = applySync(p, await pushAssignments(f.g, p, ['REQ-001']));
    expect(p.requirements.find((x) => x.id === 'REQ-001')!.plannerTaskId).toBe('');
  });
});

describe('Planner\'dan kapanış', () => {
  it('tamamlanan görev satırı kapatır ve çizgi altındaki açıklamayı ekler', async () => {
    const f = fakeGraph();
    let p = project();
    p = applySync(p, await pushAssignments(f.g, p, ['REQ-001']));
    const id = p.requirements.find((x) => x.id === 'REQ-001')!.plannerTaskId;
    const d = f.details.get(id)!;
    d.description += 'Kütle 2.31 kg ölçüldü, rapor QR-2240 ekte.';
    Object.assign(f.tasks.get(id)!, { percentComplete: 100, completedDateTime: '2026-11-01T08:00:00Z', completedBy: { user: { id: 'aad-ayse.demir@ornek.com' } } });
    p = applySync(p, await pullCompletions(f.g, p));
    const row = p.requirements.find((x) => x.id === 'REQ-001')!;
    expect(row.workStatus).toBe('Kapandı');
    expect(row.closureNote).toBe('Kütle 2.31 kg ölçüldü, rapor QR-2240 ekte.');
    expect(row.closedBy).toBe('Ayşe Demir');
    expect(row.closedAt).toBe('2026-11-01T08:00:00Z');
    expect(p.planner.lastSync).not.toBe('');
  });

  it('açık konu kapanınca konu durumu da Closed olur; yeniden açılırsa geri açılır', async () => {
    const f = fakeGraph();
    let p = project();
    const iss = p.issues.find((x) => x.id === 'ISS-001')!;
    iss.assignee = 'P-002';
    iss.dueDate = '2026-10-30';
    p = applySync(p, await pushAssignments(f.g, p, ['ISS-001']));
    const tid = p.issues.find((x) => x.id === 'ISS-001')!.plannerTaskId;
    f.tasks.get(tid)!.percentComplete = 100;
    p = applySync(p, await pullCompletions(f.g, p));
    expect(p.issues.find((x) => x.id === 'ISS-001')!.status).toBe('Closed');
    f.tasks.get(tid)!.percentComplete = 50;
    p = applySync(p, await pullCompletions(f.g, p));
    const row = p.issues.find((x) => x.id === 'ISS-001')!;
    expect(row.workStatus).toBe('Devam ediyor');
    expect(row.status).toBe('Open');
  });

  it('Planner\'da değişen miatı uygulamaya alır', async () => {
    const f = fakeGraph();
    let p = project();
    p = applySync(p, await pushAssignments(f.g, p, ['REQ-001']));
    const tid = p.requirements.find((x) => x.id === 'REQ-001')!.plannerTaskId;
    f.tasks.get(tid)!.dueDateTime = '2026-12-01T12:00:00Z';
    p = applySync(p, await pullCompletions(f.g, p));
    expect(p.requirements.find((x) => x.id === 'REQ-001')!.dueDate).toBe('2026-12-01');
  });
});

describe('Model', () => {
  it('kapanış açıklaması: işaret silinmişse tüm açıklama alınır', () => {
    expect(closureFromDescription(`üst\n${CLOSURE_MARK}\n  sonuç  `)).toBe('sonuç');
    expect(closureFromDescription('sadece metin')).toBe('sadece metin');
  });
  it('görev açıklaması kabul kriteri ve kanıtı içerir', () => {
    const p = sampleProject();
    const d = taskDescription(p, p.requirements[2]);
    expect(d).toContain('VERİ YOK');
    expect(d).toContain('Muayene');
  });
  it('kişi özeti zamanında kapanmayı sayar', () => {
    const p = sampleProject();
    const s = personSummary(p, '2026-10-23').find((x) => x.personId === 'P-001')!;
    expect(s).toMatchObject({ total: 2, closed: 1, closedOnTime: 1, onTimeRate: 100, open: 1, overdue: 0 });
    expect(totals(p, '2026-10-23').overdue).toBe(1);
  });
});

describe('Excel raporu', () => {
  it('özet, gereksinim, açık konu ve günlük sayfalarını üretir', async () => {
    const { buildWorkbook } = await import('../src/shared/excel');
    const ExcelJS = (await import('exceljs')).default;
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await buildWorkbook(sampleProject())) as unknown as ArrayBuffer);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Özet', 'Gereksinimler', 'Açık Konular', 'Dokümanlar', 'Ekip', 'Planner Günlüğü']);
    expect(wb.getWorksheet('Gereksinimler')!.getCell(4, 1).value).toBe('REQ-001');
  });
});

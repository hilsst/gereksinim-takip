import type { AnyRow, Assignable, IssueRow, PersonRow, Project, RequirementRow, TableKey } from './types';

export const ID_PREFIX: Record<TableKey, string> = {
  documents: 'DOC',
  requirements: 'REQ',
  issues: 'ISS',
  people: 'P',
};

export const TABLE_LABEL: Record<TableKey, string> = {
  documents: 'Dokümanlar',
  requirements: 'Gereksinimler',
  issues: 'Açık Konular',
  people: 'Ekip',
};

export const LISTS = {
  reqType: ['Functional', 'Performance', 'Dimensional', 'Material', 'Structural', 'Environmental', 'Safety', 'Reliability', 'Interface', 'Manufacturing', 'Inspection', 'Regulatory', 'Customer-specific', 'Configuration'],
  docType: ['Teknik resim', 'Teknik şartname', 'Müşteri gereksinimi', 'E-posta', 'Toplantı notu', 'Excel listesi', 'Malzeme datasheet', 'Proses spesifikasyonu', 'Test raporu', 'CAD (STEP/IGES)', 'Diğer'],
  evidenceType: ['Ölçüm', 'Test', 'Analiz', 'Muayene', 'Model kontrolü', 'Doküman incelemesi', 'Benzerlik', 'Sertifika'],
  approval: ['AI Proposed', 'Engineer Reviewed', 'Approved', 'Rejected'],
  confidence: ['High', 'Medium', 'Low'],
  dataStatus: ['Dokümandan (kaynaklı)', 'VERİ YOK – doğrulanmalı', 'AI VARSAYIMI – mühendislik doğrulaması gerekli', 'AI RECOMMENDATION'],
  issueStatus: ['Open', 'Under Review', 'Waiting Customer', 'Resolved', 'Closed'],
  priority: ['Critical', 'Important', 'Optional'],
  discipline: ['Tasarım', 'Konfigürasyon', 'İmalat'],
  workStatus: ['Atanmadı', 'Atandı', 'Devam ediyor', 'Kapandı', 'İptal'],
};

export const NO_DATA = 'VERİ YOK – doğrulanmalı';

const assignBlank = (): Assignable => ({
  discipline: '', assignee: '', dueDate: '', assignedAt: '', workStatus: 'Atanmadı',
  plannerTaskId: '', plannerSyncedAt: '', plannerEtag: '', closedAt: '', closedBy: '', closureNote: '',
});

export function blankRow(table: TableKey, id: string): AnyRow {
  switch (table) {
    case 'documents':
      return { id, name: '', docType: '', docNumber: '', revision: '', date: '', source: '', notes: '', filePath: '', extractedAt: '' };
    case 'requirements':
      return { id, ...assignBlank(), text: '', reqType: '', acceptance: '', evidenceType: '', evidence: '', source: '', confidence: '', dataStatus: '', approval: '', notes: '' };
    case 'issues':
      return { id, ...assignBlank(), description: '', priority: '', source: '', risk: '', relatedReq: '', recommendedAction: '', status: 'Open', answer: '' };
    case 'people':
      return { id, name: '', discipline: '', email: '', aadId: '', active: true };
  }
}

export function nextId(p: Project, table: TableKey): string {
  const prefix = ID_PREFIX[table];
  let max = 0;
  for (const r of p[table] as AnyRow[]) {
    const m = r.id.match(/-(\d+)$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return `${prefix}-${String(max + 1).padStart(3, '0')}`;
}

export function newProject(): Project {
  return {
    schema: 'gereksinim-takip/1',
    meta: { name: '', code: '', partNumber: '', partName: '', customer: '', program: '', drawingRevision: '', owner: '', startDate: new Date().toISOString().slice(0, 10), scope: '', confidentiality: '' },
    planner: { mode: 'flow', flowFolder: '', clientId: '', tenantId: '', planId: '', planTitle: '', buckets: {}, pollMinutes: 5, lastSync: '' },
    documents: [],
    requirements: [],
    issues: [],
    people: [],
    syncLog: [],
  };
}

export function normalizeProject(raw: Partial<Project>): Project {
  const base = newProject();
  const p: Project = {
    ...base,
    ...raw,
    schema: 'gereksinim-takip/1',
    meta: { ...base.meta, ...(raw.meta ?? {}) },
    planner: { ...base.planner, ...(raw.planner ?? {}), buckets: { ...(raw.planner?.buckets ?? {}) } },
    syncLog: raw.syncLog ?? [],
  } as Project;
  for (const t of Object.keys(ID_PREFIX) as TableKey[]) {
    const rows = (raw[t] as AnyRow[] | undefined) ?? [];
    (p as unknown as Record<string, AnyRow[]>)[t] = rows.map((r) => ({ ...blankRow(t, r.id), ...r }) as AnyRow);
  }
  return p;
}

export const isClosed = (r: Assignable) => r.workStatus === 'Kapandı' || r.workStatus === 'İptal';

export function isOverdue(r: Assignable, today = new Date().toISOString().slice(0, 10)): boolean {
  return !!r.dueDate && !isClosed(r) && r.dueDate < today;
}

export function personName(p: Project, id: string): string {
  return p.people.find((x) => x.id === id)?.name || id;
}

/** Proje kodu: elle girilen kod, yoksa proje adının başındaki numara ("1522 Projesi" → "1522"). */
export function projectCode(p: Project): string {
  const c = p.meta.code?.trim();
  if (c) return c.replace(/\s+/g, '-');
  const first = p.meta.name.trim().split(/\s+/)[0] ?? '';
  return /\d/.test(first) ? first : '';
}

/** Projeler arasında tekil kayıt anahtarı ve Planner görev başlığı: "1522-REQ-001" (kod yoksa "REQ-001"). */
export function taskKey(p: Project, r: { id: string }): string {
  const code = projectCode(p);
  return code ? `${code}-${r.id}` : r.id;
}
export const taskTitle = taskKey;

/** Planner denetim listesi maddesi: gereksinimin kendisi (Planner sınırı 100 karakter, tam metin açıklamada). */
export function checklistTitle(r: RequirementRow | IssueRow): string {
  const s = ('text' in r ? r.text : r.description).replace(/\s+/g, ' ').trim();
  return s.length > 100 ? `${s.slice(0, 99)}…` : s;
}

/** Planner başlangıç tarihi: atama günü (eski kayıtlarda bugün). */
export function startDateOf(r: Assignable): string {
  return r.assignedAt || new Date().toISOString().slice(0, 10);
}

export const CLOSURE_MARK = '──── Kapanış açıklamasını bu çizginin altına yazın ────';

export function taskDescription(p: Project, r: RequirementRow | IssueRow): string {
  const lines: string[] = [];
  const proj = [p.meta.name, p.meta.partNumber].filter(Boolean).join(' · ');
  if (proj) lines.push(`Proje: ${proj}`);
  if ('text' in r) {
    lines.push(`Gereksinim: ${r.text}`);
    if (r.reqType) lines.push(`Tip: ${r.reqType}`);
    lines.push(`Kabul kriteri: ${r.acceptance || NO_DATA}`);
    lines.push(`Kanıt: ${[r.evidenceType, r.evidence].filter(Boolean).join(' – ') || NO_DATA}`);
  } else {
    lines.push(`Açık konu [${r.priority || '-'}]: ${r.description}`);
    if (r.risk) lines.push(`Risk: ${r.risk}`);
    if (r.recommendedAction) lines.push(`Önerilen aksiyon: ${r.recommendedAction}`);
    if (r.relatedReq) lines.push(`İlgili gereksinim: ${r.relatedReq}`);
  }
  if (r.source) lines.push(`Kaynak: ${r.source}`);
  lines.push('', CLOSURE_MARK, '');
  return lines.join('\n');
}

/** Kapanış açıklaması: işaret çizgisinin altı; çizgi silinmişse tüm açıklama. */
export function closureFromDescription(desc: string): string {
  const i = desc.indexOf(CLOSURE_MARK);
  return (i >= 0 ? desc.slice(i + CLOSURE_MARK.length) : desc).trim();
}

export function activePeople(p: Project, discipline?: string): PersonRow[] {
  return p.people.filter((x) => x.active && (!discipline || !x.discipline || x.discipline === discipline));
}

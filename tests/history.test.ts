import { describe, expect, it } from 'vitest';
import { diffProjects, record } from '../src/shared/history';
import { blankRow, live, nextId, normalizeProject, SCHEMA, splitSource } from '../src/shared/model';
import { totals } from '../src/shared/summary';
import { sampleProject } from '../src/shared/sample';
import type { Project, RequirementRow } from '../src/shared/types';

const edit = (p: Project, fn: (d: Project) => void, user = 'kemal') => {
  const d = structuredClone(p);
  fn(d);
  return record(p, d, user, '2026-10-25T08:00:00.000Z');
};

describe('Kalıcı kimlik', () => {
  it('silinen son kaydın numarası yeni kayda tekrar verilmez', () => {
    let p = sampleProject();
    p = normalizeProject(p);
    expect(nextId(p, 'requirements')).toBe('REQ-006');
    // Eski davranış: satır dosyadan çıkınca en büyük numara düşerdi. Sayaç bunu engeller.
    p = edit(p, (d) => void (d.requirements = d.requirements.filter((r) => r.id !== 'REQ-005')));
    expect(nextId(p, 'requirements')).toBe('REQ-006');
    p = edit(p, (d) => void d.requirements.push(blankRow('requirements', nextId(d, 'requirements')) as RequirementRow));
    expect(p.seq.requirements).toBe(6);
    expect(nextId(p, 'requirements')).toBe('REQ-007');
  });
});

describe('Şema 1 dönüşümü', () => {
  it('serbest metin kaynağı doküman ID ve yer olarak ayırır', () => {
    expect(splitSource('DOC-002 / §3.2')).toEqual({ sourceDocId: 'DOC-002', sourceRef: '§3.2' });
    expect(splitSource('Şartname s.4')).toEqual({ sourceDocId: '', sourceRef: 'Şartname s.4' });
    expect(splitSource('DOC-001')).toEqual({ sourceDocId: 'DOC-001', sourceRef: '' });
  });

  it('v0.5 dosyasını kayıpsız açar', () => {
    const old = {
      schema: 'gereksinim-takip/1',
      meta: { name: 'Eski' },
      requirements: [{ id: 'REQ-001', text: 'Kütle ≤ 2 kg', source: 'DOC-003 / Sayfa 2', workStatus: 'Atandı', assignee: 'P-001' }],
      issues: [{ id: 'ISS-004', description: 'Renk?', source: 'e-posta 20.10' }],
      documents: [{ id: 'DOC-003', name: 'Şartname', source: 'Müşteri' }],
      people: [{ id: 'P-001', name: 'Ayşe' }],
    } as unknown as Project;
    const p = normalizeProject(old);
    expect(p.schema).toBe(SCHEMA);
    expect(p.requirements[0]).toMatchObject({ text: 'Kütle ≤ 2 kg', sourceDocId: 'DOC-003', sourceRef: 'Sayfa 2', workStatus: 'Atandı', assignee: 'P-001', deletedAt: '' });
    expect('source' in p.requirements[0]).toBe(false);
    expect(p.issues[0]).toMatchObject({ sourceDocId: '', sourceRef: 'e-posta 20.10' });
    // Dokümandaki "Kaynak / Gönderen" alanı ayrı bir alan, olduğu gibi kalır
    expect(p.documents[0].source).toBe('Müşteri');
    expect(p.seq).toEqual({ documents: 3, requirements: 1, issues: 4, people: 1 });
    expect(p.history).toEqual([]);
  });

  it('şema 2 dosyasını tekrar dönüştürmez', () => {
    const p = normalizeProject(sampleProject());
    const again = normalizeProject(JSON.parse(JSON.stringify(p)));
    expect(again).toEqual(p);
  });
});

describe('Değişiklik günlüğü', () => {
  it('alan değişikliğini kim, ne zaman, eski ve yeni değerle yazar', () => {
    const p = edit(normalizeProject(sampleProject()), (d) => void (d.requirements[0].acceptance = '≤ 2.2 kg'));
    expect(p.history).toEqual([{ at: '2026-10-25T08:00:00.000Z', user: 'kemal', table: 'requirements', rowId: 'REQ-001', action: 'Değişti', field: 'acceptance', from: '≤ 2.4 kg', to: '≤ 2.2 kg' }]);
  });

  it('oluşturma, silme ve geri yüklemeyi yazar; teknik senkron alanlarını yazmaz', () => {
    let p = normalizeProject(sampleProject());
    p = edit(p, (d) => void d.issues.push({ ...(blankRow('issues', 'ISS-003') as Project['issues'][number]), description: 'Yeni konu' }));
    expect(p.history.at(-1)).toMatchObject({ action: 'Oluşturuldu', rowId: 'ISS-003', to: 'Yeni konu' });
    p = edit(p, (d) => Object.assign(d.requirements[1], { deletedAt: '2026-10-25T08:00:00Z', deletedBy: 'kemal', deleteReason: 'Mükerrer' }));
    expect(p.history.at(-1)).toMatchObject({ action: 'Silindi', rowId: 'REQ-002', to: 'Mükerrer' });
    p = edit(p, (d) => Object.assign(d.requirements[1], { deletedAt: '', deletedBy: '', deleteReason: '' }));
    expect(p.history.at(-1)).toMatchObject({ action: 'Geri yüklendi', rowId: 'REQ-002', from: 'Mükerrer' });
    const n = p.history.length;
    p = edit(p, (d) => Object.assign(d.requirements[0], { plannerEtag: 'W/"x"', plannerSyncedAt: '2026-10-25' }));
    expect(p.history).toHaveLength(n);
  });

  it('Planner kapanışını Teams Planner adıyla yazar', () => {
    const before = normalizeProject(sampleProject());
    const after = structuredClone(before);
    Object.assign(after.requirements[0], { workStatus: 'Kapandı', closureNote: 'Rapor QR-1' });
    const entries = diffProjects(before, after, 'Teams Planner');
    expect(entries.map((e) => [e.user, e.field])).toEqual([['Teams Planner', 'workStatus'], ['Teams Planner', 'closureNote']]);
  });
});

describe('Silinen kayıtlar', () => {
  it('özet sayılarına girmez', () => {
    const p = normalizeProject(sampleProject());
    const n = totals(p).requirements;
    p.requirements[0].deletedAt = '2026-10-25T08:00:00Z';
    expect(totals(p).requirements).toBe(n - 1);
    expect(live(p).requirements.some((r) => r.id === 'REQ-001')).toBe(false);
  });
});

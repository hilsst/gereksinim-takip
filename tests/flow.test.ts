import { describe, expect, it } from 'vitest';
import { CLOSURE_MARK, projectCode, taskKey } from '../src/shared/model';
import { applyEvents, buildRequests, idFromTitle, QUEUED, type FlowRequest } from '../src/shared/flow';
import { applySync } from '../src/shared/planner';
import { sampleProject } from '../src/shared/sample';

describe('Power Automate modu', () => {
  it('atanmış satır için istek dosyası üretir ve satırı kuyruğa alır', () => {
    const p = sampleProject();
    p.requirements[0].assignedAt = '2026-10-20';
    const { files, result } = buildRequests(p, ['REQ-001', 'REQ-004']);
    expect(files).toHaveLength(1);
    expect(files[0].name).toMatch(/^GT_REQ-001_\d{14}\.json$/);
    const req = JSON.parse(files[0].content) as FlowRequest;
    expect(req).toMatchObject({ islem: 'olustur', kayitId: 'DEMO-REQ-001', baslik: 'DEMO-REQ-001', baslangicTarihi: '2026-10-20T12:00:00Z', gorevId: '', sorumluEposta: 'ayse.demir@ornek.com', kova: 'Tasarım', bitisTarihi: '2026-11-05T12:00:00Z' });
    expect(req.aciklama).toContain(CLOSURE_MARK);
    expect(req.kontrolListesi).toBe(p.requirements[0].text.length > 100 ? p.requirements[0].text.slice(0, 99) + '…' : p.requirements[0].text);
    expect(result.log.some((l) => l.kind === 'err' && l.text.startsWith('REQ-004'))).toBe(true);
    const next = applySync(p, result);
    expect(next.requirements[0].plannerEtag).toBe(QUEUED);
  });

  it('kuyruktaki satırı tekrar göndermez, görevi olanı güncelleme olarak gönderir', () => {
    let p = sampleProject();
    p = applySync(p, buildRequests(p, ['REQ-001']).result);
    expect(buildRequests(p, ['REQ-001']).files).toHaveLength(0);
    p = applySync(p, applyEvents(p, [{ name: 'a.json', event: { olay: 'olusturuldu', kayitId: 'REQ-001', gorevId: 'T-9' } }]));
    expect(p.requirements[0]).toMatchObject({ plannerTaskId: 'T-9', plannerEtag: '' });
    const again = buildRequests(p, ['REQ-001']);
    expect(JSON.parse(again.files[0].content)).toMatchObject({ islem: 'guncelle', gorevId: 'T-9' });
  });

  it('tamamlanan görevi kapatır ve çizgi altındaki açıklamayı alır', () => {
    let p = sampleProject();
    p = applySync(p, applyEvents(p, [{ name: 'a.json', event: { olay: 'olusturuldu', kayitId: 'REQ-001', gorevId: 'T-9' } }]));
    const desc = `Gereksinim: …\n\n${CLOSURE_MARK}\nTartım 2.31 kg, rapor QR-2240.`;
    p = applySync(p, applyEvents(p, [{ name: 'b.json', event: { olay: 'tamamlandi', gorevId: 'T-9', baslik: 'REQ-001 · Montaj', aciklama: desc, tamamlanmaTarihi: '2026-11-01T08:00:00Z' } }]));
    expect(p.requirements[0]).toMatchObject({ workStatus: 'Kapandı', closureNote: 'Tartım 2.31 kg, rapor QR-2240.', closedAt: '2026-11-01T08:00:00Z', closedBy: 'Ayşe Demir' });
  });

  it('"oluşturuldu" olayı gelmeden tamamlanan görevi başlıktaki kimlikten eşleştirir', () => {
    const p = sampleProject();
    const r = applyEvents(p, [
      { name: 'b.json', event: { olay: 'tamamlandi', gorevId: 'T-5', baslik: 'ISS-001 · Boya rengi', aciklama: 'RAL 7035 teyit edildi' } },
    ]);
    const next = applySync(p, r);
    expect(next.issues[0]).toMatchObject({ workStatus: 'Kapandı', status: 'Closed', plannerTaskId: 'T-5', closureNote: 'RAL 7035 teyit edildi' });
  });

  it('aynı turda oluşturuldu + tamamlandı sırayı bozmadan uygulanır', () => {
    const p = sampleProject();
    const r = applyEvents(p, [
      { name: 'tamamlandi_T-7.json', event: { olay: 'tamamlandi', gorevId: 'T-7', baslik: 'değişmiş başlık', aciklama: 'tamam' } },
      { name: 'olusturuldu.json', event: { olay: 'olusturuldu', kayitId: 'REQ-005', gorevId: 'T-7' } },
    ]);
    const row = applySync(p, r).requirements.find((x) => x.id === 'REQ-005')!;
    expect(row).toMatchObject({ plannerTaskId: 'T-7', workStatus: 'Kapandı', closureNote: 'tamam' });
  });

  it('bozuk dosya ve akış hatası günlüğe yazılır', () => {
    let p = sampleProject();
    p = applySync(p, buildRequests(p, ['REQ-001']).result);
    const r = applyEvents(p, [
      { name: 'x.json', event: null, error: 'Unexpected token' },
      { name: 'h.json', event: { olay: 'hata', kayitId: 'REQ-001', mesaj: 'Kullanıcı bulunamadı' } },
    ]);
    expect(r.log.map((l) => l.kind)).toEqual(['err', 'err']);
    expect(applySync(p, r).requirements[0].plannerEtag).toBe('');
  });

  it('proje kodu başlıkta yer alır; başka projenin dosyası klasörde bırakılır', () => {
    const p = sampleProject();
    p.meta.code = '';
    p.meta.name = '1522 Projesi';
    expect(projectCode(p)).toBe('1522');
    expect(taskKey(p, p.requirements[0])).toBe('1522-REQ-001');
    const r = applyEvents(p, [
      { name: 'diger.json', event: { olay: 'tamamlandi', gorevId: 'T-1', baslik: '1600-REQ-001', aciklama: 'x' } },
      { name: 'bizim.json', event: { olay: 'tamamlandi', gorevId: 'T-2', baslik: '1522-REQ-001', aciklama: 'tamam' } },
    ]);
    expect(r.keep).toEqual(['diger.json']);
    expect(applySync(p, r).requirements[0]).toMatchObject({ workStatus: 'Kapandı', plannerTaskId: 'T-2', closureNote: 'tamam' });
  });

  it('başlıktan kimlik okur', () => {
    expect(idFromTitle('1522-REQ-012')).toBe('1522-REQ-012');
    expect(idFromTitle('ASM-1001-ISS-003')).toBe('ASM-1001-ISS-003');
    expect(idFromTitle('REQ-012 · Kütle')).toBe('REQ-012');
    expect(idFromTitle('Başka görev')).toBe('');
  });
});

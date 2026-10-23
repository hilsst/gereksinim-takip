// Örnek proje: ekranları ve Planner akışını denemek için.
import { blankRow, newProject } from './model';
import type { DocumentRow, IssueRow, PersonRow, Project, RequirementRow } from './types';

export function sampleProject(): Project {
  const p = newProject();
  p.meta = { ...p.meta, name: 'Kapak montajı', customer: 'Örnek Müşteri', partNumber: 'ASM-1001', partName: 'Ön kapak montajı', program: 'Demo', drawingRevision: 'B', owner: 'Kemal' };
  const doc = (id: string, f: Partial<DocumentRow>) => p.documents.push({ ...(blankRow('documents', id) as DocumentRow), ...f });
  const req = (id: string, f: Partial<RequirementRow>) => p.requirements.push({ ...(blankRow('requirements', id) as RequirementRow), approval: 'AI Proposed', dataStatus: 'Dokümandan (kaynaklı)', ...f });
  const iss = (id: string, f: Partial<IssueRow>) => p.issues.push({ ...(blankRow('issues', id) as IssueRow), ...f });
  const per = (id: string, f: Partial<PersonRow>) => p.people.push({ ...(blankRow('people', id) as PersonRow), ...f });

  doc('DOC-001', { name: 'ASM-1001 Teknik resim', docType: 'Teknik resim', docNumber: 'DRW-1001', revision: 'B', date: '2026-10-01' });
  doc('DOC-002', { name: 'Teknik şartname', docType: 'Teknik şartname', docNumber: 'TS-220', revision: '03', date: '2026-09-15' });
  doc('DOC-003', { name: 'Müşteri e-postası – boya rengi', docType: 'E-posta', source: 'A. Yılmaz', date: '2026-10-20' });

  per('P-001', { name: 'Ayşe Demir', discipline: 'Tasarım', email: 'ayse.demir@ornek.com' });
  per('P-002', { name: 'Mehmet Kaya', discipline: 'Konfigürasyon', email: 'mehmet.kaya@ornek.com' });
  per('P-003', { name: 'Zeynep Arslan', discipline: 'İmalat', email: 'zeynep.arslan@ornek.com' });

  req('REQ-001', { text: 'Montaj toplam kütlesi ≤ 2.4 kg olmalıdır', reqType: 'Performance', acceptance: '≤ 2.4 kg', evidenceType: 'Analiz', evidence: 'CATIA kütle raporu + ilk numune tartım kaydı', source: 'DOC-002 / §3.2', confidence: 'High', discipline: 'Tasarım', assignee: 'P-001', dueDate: '2026-11-05', workStatus: 'Atandı' });
  req('REQ-002', { text: '4X Ø6.0 +0.10/0 bağlantı deliği', reqType: 'Dimensional', acceptance: 'Ø6.00–6.10 mm', evidenceType: 'Ölçüm', evidence: 'CMM ölçüm raporu, balon 12–15', source: 'DOC-001 / Sayfa 1 / Ölçü 12', confidence: 'High', discipline: 'Tasarım', assignee: 'P-001', dueDate: '2026-10-20', workStatus: 'Kapandı', closedAt: '2026-10-18T09:12:00Z', closedBy: 'Ayşe Demir', closureNote: 'Model ölçüsü kontrol edildi, CMM programı hazır. Rapor: QR-2231.' });
  req('REQ-003', { text: 'Parça üzerinde parça no ve revizyon lazer markalı olmalıdır', reqType: 'Configuration', acceptance: 'VERİ YOK – doğrulanmalı', dataStatus: 'VERİ YOK – doğrulanmalı', evidenceType: 'Muayene', evidence: 'Görsel muayene kaydı + fotoğraf (AI RECOMMENDATION)', source: 'DOC-001 / Not 4', confidence: 'Medium', discipline: 'Konfigürasyon', assignee: 'P-002', dueDate: '2026-10-15', workStatus: 'Atandı' });
  req('REQ-004', { text: 'Dış yüzey RAL 7035 toz boya, kalınlık 60–90 µm', reqType: 'Material', acceptance: '60–90 µm', evidenceType: 'Ölçüm', evidence: 'Boya kalınlık ölçüm kaydı (5 nokta)', source: 'DOC-003 / 20.10.2026 / A. Yılmaz', confidence: 'High', discipline: 'İmalat' });
  req('REQ-005', { text: '96 saat tuz sisi testinde kırmızı pas olmamalıdır', reqType: 'Environmental', acceptance: '96 sa, kırmızı pas yok', evidenceType: 'Test', evidence: 'ISO 9227 NSS test raporu', source: 'DOC-002 / §5.4', confidence: 'High', discipline: 'İmalat' });

  iss('ISS-001', { description: 'Boya rengi e-postada RAL 7035, şartnamede RAL 7040 – hangisi geçerli?', priority: 'Critical', source: 'DOC-002 §4.1 / DOC-003', risk: 'Yanlış renkle üretim, müşteri reddi', recommendedAction: 'Müşteriden yazılı teyit alın', relatedReq: 'REQ-004', status: 'Open', discipline: 'Konfigürasyon' });
  iss('ISS-002', { description: 'Lazer markalama yeri ve yazı yüksekliği belirtilmemiş', priority: 'Important', source: 'DOC-001 / Not 4', recommendedAction: 'Markalama detayını resme ekleyin', relatedReq: 'REQ-003', status: 'Open' });
  return p;
}

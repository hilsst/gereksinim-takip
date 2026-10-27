import { useEffect, useState } from 'react';
import { blankRow, nextId, NO_DATA } from '../../shared/model';
import type { DocumentRow, IssueRow, Project, RequirementRow } from '../../shared/types';
import { api, isDesktop } from '../api';
import { needsRaster, type DrawingImage } from '../../shared/raster';
import { useStore } from '../store';
import { Modal } from './Modal';

type Json = Record<string, unknown>;
interface Proposal {
  docs: DocumentRow[];
  /** Aynı resmin başka formatı olan dokümanlar: "DOC-003 → DOC-001 (FLN-3010 Rev A)" */
  sameAs: string[];
  /** Aynı resmin ikinci+ formatı olan doküman ID'leri: önerileri varsayılan olarak seçili gelmez. */
  twins: string[];
  requirements: (Json & { docId: string })[];
  issues: (Json & { docId: string })[];
  errors: string[];
}

const DOC_TYPE: Record<string, string> = {
  pdf: 'Teknik resim', dwg: 'Teknik resim', dxf: 'Teknik resim', png: 'Teknik resim', jpg: 'Teknik resim', jpeg: 'Teknik resim', tif: 'Teknik resim', tiff: 'Teknik resim', bmp: 'Teknik resim', docx: 'Teknik şartname',
  xlsx: 'Excel listesi', xlsm: 'Excel listesi', eml: 'E-posta', msg: 'E-posta', txt: 'Diğer', md: 'Diğer', csv: 'Excel listesi',
};

// Model bazen metnin başına kendi sıra numarasını yazar ("REQ-01: …"); projedeki ID ile karışmasın.
const stripNo = (v: unknown) => String(v ?? '').replace(/^\s*(REQ|ISS)-?\d+\s*[:.–-]\s*/i, '');
const sameNo = (a: string, b: string) => a.replace(/[\s_.-]/g, '').toUpperCase() === b.replace(/[\s_.-]/g, '').toUpperCase();

export function existingSummary(p: Project): string[] {
  return p.requirements.filter((r) => !r.deletedAt).map((r) => `${r.id} [${r.reqType}] ${r.text} | Kabul: ${r.acceptance || 'VERİ YOK'}`);
}

/** Kapanmamış açık konular: aynı parçanın başka formattaki resmi yüklendiğinde aynı konu tekrar açılmasın. */
export function existingIssueSummary(p: Project): string[] {
  return p.issues.filter((r) => !r.deletedAt && r.status !== 'Resolved' && r.status !== 'Closed').map((r) => `${r.id} [${r.priority}] ${r.description}`);
}

export function useExtraction() {
  const { project, mutate, toast } = useStore();
  const [busy, setBusy] = useState<string | null>(null);
  const [proposal, setProposal] = useState<Proposal | null>(null);

  const guard = async () => {
    if (!isDesktop) {
      toast('AI çıkarma masaüstü uygulamasında çalışır.', 'warn');
      return false;
    }
    if (!(await api.aiStatus()).configured) {
      toast('Önce Ayarlar’dan Claude API anahtarını girin.', 'warn');
      window.dispatchEvent(new CustomEvent('open-settings'));
      return false;
    }
    return true;
  };

  /** Dosyaları doküman olarak kaydeder ve sırayla AI çıkarmasına gönderir. */
  const upload = async (existingDoc?: DocumentRow) => {
    let docs: DocumentRow[];
    if (existingDoc) {
      if (!existingDoc.filePath) {
        toast('Bu dokümana dosya bağlı değil.', 'warn');
        return;
      }
      docs = [existingDoc];
    } else {
      const files = await api.pickFiles(true);
      if (!files.length) return;
      let p = project;
      docs = files.map((f) => {
        const id = nextId(p, 'documents');
        const ext = f.name.split('.').pop()?.toLowerCase() ?? '';
        const row: DocumentRow = { ...(blankRow('documents', id) as DocumentRow), name: f.name.replace(/\.[^.]+$/, ''), docType: DOC_TYPE[ext] ?? 'Diğer', filePath: f.path, date: new Date().toISOString().slice(0, 10) };
        p = { ...p, documents: [...p.documents, row] };
        return row;
      });
      mutate((d) => void d.documents.push(...docs));
      toast(`${docs.length} doküman kaydedildi`);
    }
    if (!(await guard())) return;
    await run(docs.map((d) => ({ doc: d, filePath: d.filePath })));
  };

  const fromText = async (text: string, label: string) => {
    if (!text.trim() || !(await guard())) return;
    const id = nextId(project, 'documents');
    const doc: DocumentRow = { ...(blankRow('documents', id) as DocumentRow), name: label || 'Yapıştırılan metin', docType: 'E-posta', date: new Date().toISOString().slice(0, 10), notes: text.slice(0, 2000) };
    mutate((d) => void d.documents.push(doc));
    await run([{ doc, text }]);
  };

  const run = async (jobs: { doc: DocumentRow; filePath?: string; text?: string }[]) => {
    const out: Proposal = { docs: [], sameAs: [], twins: [], requirements: [], issues: [], errors: [] };
    // Doküman kimlikleri (numara + revizyon): aynı resmin farklı formatlarını tanımak için
    const known = project.documents.filter((d) => !d.deletedAt && d.docNumber).map((d) => ({ id: d.id, number: d.docNumber, revision: d.revision, label: `${d.name} (${d.filePath.split('.').pop() ?? d.docType})` }));
    const existing = existingSummary(project);
    const existingIssues = existingIssueSummary(project);
    for (const [i, j] of jobs.entries()) {
      const step = `${j.doc.id} · ${j.doc.name} (${i + 1}/${jobs.length})`;
      const fileName = j.filePath?.split(/[\\/]/).pop() ?? '';
      const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
      let images: DrawingImage[] | undefined;
      let pdfText: string | undefined;
      if (j.filePath && needsRaster(ext, j.doc.docType)) {
        setBusy(`${step}: teknik resim görüntüleri hazırlanıyor…`);
        try {
          const { prepareDrawing } = await import('../drawing'); // pdf.js yalnızca gerektiğinde yüklenir
          const prep = await prepareDrawing(j.filePath, fileName, j.doc.docType === 'Teknik resim');
          images = prep.images;
          pdfText = prep.pdfText;
          if (prep.note) out.errors.push(`${j.doc.id}: ${prep.note}`);
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          // DWG çevrilemediyse metin de çıkarılamaz; diğer durumlarda dosyanın kendisiyle devam edilir.
          if (ext === 'dwg' || ext === 'dxf') {
            out.errors.push(`${j.doc.id} ${j.doc.name}: ${msg}`);
            continue;
          }
          out.errors.push(`${j.doc.id}: görüntüler hazırlanamadı (${msg}); dosya olduğu gibi gönderildi.`);
        }
      }
      setBusy(`${step}: Claude okuyor…`);
      const off = api.onAiProgress((msg) => setBusy(`${step}: ${msg}`));
      const r = await api.aiRequirements({ filePath: j.filePath, text: j.text, images, pdfText, drawing: j.doc.docType === 'Teknik resim', docId: j.doc.id, docLabel: `${j.doc.docType} – ${j.doc.name}`, existing, existingIssues, existingDocs: known.filter((k) => k.id !== j.doc.id).map((k) => `${k.id} · no ${k.number} · rev ${k.revision || '-'} · ${k.label}`) });
      off();
      if (!r.ok) {
        out.errors.push(`${j.doc.id} ${j.doc.name}: ${r.error}`);
        continue;
      }
      const d = r.data as { document?: { number: string; revision: string; title: string; sameAs: string }; requirements: Json[]; issues: Json[] };
      out.docs.push(j.doc);
      const info = d.document;
      if (info?.number) {
        // Numara ve revizyon dokümana yazılır; eşleşme modelin cevabından bağımsız olarak burada da kontrol edilir.
        const twin = known.find((k) => k.id !== j.doc.id && sameNo(k.number, info.number) && sameNo(k.revision, info.revision));
        const twinId = twin?.id ?? (known.some((k) => k.id === info.sameAs) ? info.sameAs : '');
        if (twinId) out.twins.push(j.doc.id);
        if (twinId) out.sameAs.push(`${j.doc.id} → ${twinId} (${info.number}${info.revision ? ` Rev ${info.revision}` : ''})`);
        mutate((p) => {
          const row = p.documents.find((x) => x.id === j.doc.id);
          if (!row) return;
          row.docNumber ||= info.number;
          row.revision ||= info.revision;
          if (twinId && !row.notes.includes(twinId)) row.notes = `${twinId} ile aynı resim (farklı format). ${row.notes}`.trim();
        });
        known.push({ id: j.doc.id, number: info.number, revision: info.revision, label: `${j.doc.name} (${ext})` });
      }
      out.requirements.push(...d.requirements.map((x) => ({ ...x, text: stripNo(x.text), docId: j.doc.id })));
      out.issues.push(...d.issues.map((x) => ({ ...x, description: stripNo(x.description), docId: j.doc.id })));
      existing.push(...d.requirements.map((x) => `(yeni) ${String(x.text)}`));
      existingIssues.push(...d.issues.map((x) => `(yeni) ${String(x.description)}`));
    }
    setBusy(null);
    if (!out.requirements.length && !out.issues.length) {
      const at = new Date().toISOString();
      mutate((p) => void p.documents.forEach((row) => out.docs.some((x) => x.id === row.id) && (row.extractedAt = at)));
      if (out.errors.length) toast(`AI hatası: ${out.errors.join(' · ')}`, 'err');
      else if (out.sameAs.length) toast(`Aynı resmin farklı formatı (${out.sameAs.join(' · ')}): yeni gereksinim veya açık konu yok.`);
      else toast('AI bu dokümandan yeni gereksinim çıkarmadı.', 'warn');
      return;
    }
    setProposal(out);
  };

  const dialogs = (
    <>
      {busy && (
        <div className="modal-back">
          <div className="modal">
            <div className="busy">
              <div className="spinner" />
              <div>
                <b>Claude dokümanı okuyor</b>
                <div className="muted">{busy}</div>
                <Elapsed />
                <button className="btn" onClick={() => void api.aiCancel()}>
                  İptal
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      {proposal && <ProposalDialog proposal={proposal} onClose={() => setProposal(null)} />}
    </>
  );

  return { upload, fromText, dialogs, busy: !!busy };
}

function Elapsed() {
  const [s, setS] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setS((x) => x + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return <div className="muted">Geçen süre {Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')} · Büyük teknik resimlerde birkaç dakika sürebilir.</div>;
}

function ProposalDialog({ proposal, onClose }: { proposal: Proposal; onClose: () => void }) {
  const { mutate, toast } = useStore();
  // Aynı resmin başka formatından gelen öneriler çoğunlukla okuma farkıdır; kullanıcı isterse seçer.
  const [reqSel, setReqSel] = useState(proposal.requirements.map((r) => !proposal.twins.includes(r.docId)));
  const [issSel, setIssSel] = useState(proposal.issues.map((r) => !proposal.twins.includes(r.docId)));

  const apply = () => {
    let added = 0;
    mutate((d) => {
      const now = new Date().toISOString();
      proposal.requirements.forEach((r, i) => {
        if (!reqSel[i]) return;
        const id = nextId(d, 'requirements');
        const acceptance = String(r.acceptance ?? '');
        d.requirements.push({
          ...(blankRow('requirements', id) as RequirementRow),
          text: String(r.text ?? ''),
          reqType: String(r.reqType ?? ''),
          acceptance,
          evidenceType: String(r.evidenceType ?? ''),
          evidence: String(r.evidence ?? ''),
          discipline: (String(r.discipline ?? '') as RequirementRow['discipline']) || '',
          sourceDocId: String(r.docId),
          sourceRef: String(r.source ?? ''),
          confidence: (r.confidence as RequirementRow['confidence']) ?? '',
          dataStatus: acceptance.includes('VERİ YOK') ? NO_DATA : 'Dokümandan (kaynaklı)',
          approval: 'AI Proposed',
        });
        added++;
      });
      proposal.issues.forEach((r, i) => {
        if (!issSel[i]) return;
        const id = nextId(d, 'issues');
        d.issues.push({
          ...(blankRow('issues', id) as IssueRow),
          description: String(r.description ?? ''),
          priority: (r.priority as IssueRow['priority']) ?? '',
          sourceDocId: String(r.docId),
          sourceRef: String(r.source ?? ''),
          risk: String(r.risk ?? ''),
          recommendedAction: String(r.recommendedAction ?? ''),
          relatedReq: String(r.relatedReq ?? ''),
          status: 'Open',
        });
        added++;
      });
      for (const doc of proposal.docs) {
        const row = d.documents.find((x) => x.id === doc.id);
        if (row) row.extractedAt = now;
      }
    });
    toast(`${added} kayıt “AI Proposed” olarak eklendi`);
    onClose();
  };

  const toggle = (arr: boolean[], set: (v: boolean[]) => void, i: number, v: boolean) => set(arr.map((x, j) => (j === i ? v : x)));

  return (
    <Modal
      wide
      icon="✦"
      title="Çıkarılan gereksinimleri kontrol edin"
      sub={`${proposal.docs.map((d) => d.id).join(', ')} · Öneriler “AI Proposed” olarak eklenir; eklemek istemediklerinizin işaretini kaldırın.`}
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>
            Vazgeç
          </button>
          <button className="btn primary" onClick={apply}>
            Seçilenleri ekle
          </button>
        </>
      }
    >
      {proposal.errors.length > 0 && <div className="callout peach">Okunamayan dosyalar: {proposal.errors.join(' · ')}</div>}
      {proposal.sameAs.length > 0 && (
        <div className="callout">
          Aynı resmin farklı formatı: {proposal.sameAs.join(' · ')}. Bu dokümanlar için yalnızca önceki formatta olmayan farklar listelenir ve seçili gelmez; gerçekten eksikse işaretleyin.
        </div>
      )}
      <h3>
        <span className="badge b-lav">{proposal.requirements.length}</span> gereksinim
      </h3>
      <div className="preview-scroll">
        <table className="effects">
          <thead>
            <tr>
              <th>
                <input type="checkbox" checked={reqSel.every(Boolean)} onChange={(e) => setReqSel(reqSel.map(() => e.target.checked))} />
              </th>
              <th>Gereksinim</th>
              <th>Tip</th>
              <th>Kabul kriteri</th>
              <th>Kanıt</th>
              <th>Disiplin</th>
              <th>Kaynak</th>
              <th>Güven</th>
            </tr>
          </thead>
          <tbody>
            {proposal.requirements.map((r, i) => (
              <tr key={i}>
                <td>
                  <input type="checkbox" checked={reqSel[i]} onChange={(e) => toggle(reqSel, setReqSel, i, e.target.checked)} />
                </td>
                <td>{String(r.text)}</td>
                <td>{String(r.reqType)}</td>
                <td className={String(r.acceptance).includes('VERİ YOK') ? 'warn' : ''}>{String(r.acceptance)}</td>
                <td>
                  <span className="badge b-lav">{String(r.evidenceType)}</span> {String(r.evidence)}
                </td>
                <td>{String(r.discipline)}</td>
                <td>{String(r.source)}</td>
                <td>{String(r.confidence)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {proposal.issues.length > 0 && (
        <>
          <h3 style={{ marginTop: 16 }}>
            <span className="badge b-peach">{proposal.issues.length}</span> açık konu
          </h3>
          <div className="preview-scroll">
            <table className="effects">
              <tbody>
                {proposal.issues.map((r, i) => (
                  <tr key={i}>
                    <td>
                      <input type="checkbox" checked={issSel[i]} onChange={(e) => toggle(issSel, setIssSel, i, e.target.checked)} />
                    </td>
                    <td>
                      <span className={`badge ${r.priority === 'Critical' ? 'b-rose' : r.priority === 'Important' ? 'b-peach' : 'b-gray'}`}>{String(r.priority)}</span>
                    </td>
                    <td>{String(r.description)}</td>
                    <td className="muted">{String(r.recommendedAction)}</td>
                    <td className="muted">{String(r.source)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}

export function PasteDialog({ onRun, onClose }: { onRun: (text: string, label: string) => void; onClose: () => void }) {
  const [text, setText] = useState('');
  const [label, setLabel] = useState('');
  return (
    <Modal
      wide
      icon="✉"
      title="Metinden gereksinim çıkar"
      sub="Müşteri e-postasını, toplantı notunu veya şartname bölümünü yapıştırın. Metin bir doküman kaydı olarak saklanır."
      onClose={onClose}
      foot={
        <>
          <button className="btn" onClick={onClose}>
            Vazgeç
          </button>
          <button
            className="btn primary"
            disabled={!text.trim()}
            onClick={() => {
              onClose();
              onRun(text, label);
            }}
          >
            ✦ Çıkar
          </button>
        </>
      }
    >
      <div className="form" style={{ marginBottom: 10 }}>
        <label className="wide">
          <span>Başlık (ör. "Müşteri e-postası 22.10.2026 – A. Yılmaz")</span>
          <input className="cell-input" value={label} onChange={(e) => setLabel(e.target.value)} />
        </label>
      </div>
      <textarea className="big-text" value={text} onChange={(e) => setText(e.target.value)} placeholder="Metni buraya yapıştırın…" />
    </Modal>
  );
}

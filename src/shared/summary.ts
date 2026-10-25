// Kişi ve disiplin bazında atama özeti (ileride tasarımcı KPI'larının temeli).
import { delayDays, isClosed, isOverdue, live } from './model';
import type { Assignable, Project } from './types';

export interface PersonSummary {
  personId: string;
  name: string;
  discipline: string;
  total: number;
  open: number;
  overdue: number;
  closed: number;
  closedOnTime: number;
  /** Toplam gecikme günü (kapanan + açık işler). */
  delayDays: number;
  /** Zamanında kapanma oranı (%), kapanan yoksa null. */
  onTimeRate: number | null;
}

/** Silinmemiş gereksinim ve açık konular. */
export function assignables(p: Project): Assignable[] {
  return [...p.requirements, ...p.issues].filter((r) => !r.deletedAt);
}

export function personSummary(p: Project, today = new Date().toISOString().slice(0, 10)): PersonSummary[] {
  const work = assignables(p);
  // Ekipten silinen kişi, üzerinde iş kaldıysa KPI'da görünmeye devam eder
  const people = p.people.filter((x) => !x.deletedAt || work.some((r) => r.assignee === x.id));
  return people.map((x) => {
    const rows = work.filter((r) => r.assignee === x.id && r.workStatus !== 'İptal');
    const closed = rows.filter((r) => r.workStatus === 'Kapandı');
    const onTime = closed.filter((r) => !r.dueDate || (r.closedAt && r.closedAt.slice(0, 10) <= r.dueDate));
    return {
      personId: x.id,
      name: x.name,
      discipline: x.discipline,
      total: rows.length,
      open: rows.filter((r) => !isClosed(r)).length,
      overdue: rows.filter((r) => isOverdue(r, today)).length,
      closed: closed.length,
      closedOnTime: onTime.length,
      delayDays: rows.reduce((n, r) => n + delayDays(r, today), 0),
      onTimeRate: closed.length ? Math.round((onTime.length / closed.length) * 100) : null,
    };
  });
}

export function totals(src: Project, today = new Date().toISOString().slice(0, 10)) {
  const p = live(src);
  const all = assignables(p).filter((r) => r.workStatus !== 'İptal');
  return {
    requirements: p.requirements.length,
    issuesOpen: p.issues.filter((i) => i.status !== 'Closed' && i.status !== 'Resolved').length,
    unassigned: all.filter((r) => !r.assignee && !isClosed(r)).length,
    notSent: all.filter((r) => r.assignee && !r.plannerTaskId && !isClosed(r)).length,
    open: all.filter((r) => r.assignee && !isClosed(r)).length,
    overdue: all.filter((r) => isOverdue(r, today)).length,
    closed: all.filter((r) => r.workStatus === 'Kapandı').length,
    lateClosed: all.filter((r) => r.workStatus === 'Kapandı' && delayDays(r, today) > 0).length,
    delayDays: all.reduce((n, r) => n + delayDays(r, today), 0),
    noData: p.requirements.filter((r) => r.acceptance.includes('VERİ YOK') || r.dataStatus === 'VERİ YOK – doğrulanmalı').length,
    noEvidence: p.requirements.filter((r) => !r.evidenceType).length,
  };
}

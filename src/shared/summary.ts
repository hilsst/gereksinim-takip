// Kişi ve disiplin bazında atama özeti (ileride tasarımcı KPI'larının temeli).
import { isClosed, isOverdue } from './model';
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
  /** Zamanında kapanma oranı (%), kapanan yoksa null. */
  onTimeRate: number | null;
}

export function assignables(p: Project): Assignable[] {
  return [...p.requirements, ...p.issues];
}

export function personSummary(p: Project, today = new Date().toISOString().slice(0, 10)): PersonSummary[] {
  return p.people.map((x) => {
    const rows = assignables(p).filter((r) => r.assignee === x.id && r.workStatus !== 'İptal');
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
      onTimeRate: closed.length ? Math.round((onTime.length / closed.length) * 100) : null,
    };
  });
}

export function totals(p: Project, today = new Date().toISOString().slice(0, 10)) {
  const all = assignables(p).filter((r) => r.workStatus !== 'İptal');
  return {
    requirements: p.requirements.length,
    issuesOpen: p.issues.filter((i) => i.status !== 'Closed' && i.status !== 'Resolved').length,
    unassigned: all.filter((r) => !r.assignee && !isClosed(r)).length,
    notSent: all.filter((r) => r.assignee && !r.plannerTaskId && !isClosed(r)).length,
    open: all.filter((r) => r.assignee && !isClosed(r)).length,
    overdue: all.filter((r) => isOverdue(r, today)).length,
    closed: all.filter((r) => r.workStatus === 'Kapandı').length,
    noData: p.requirements.filter((r) => r.acceptance.includes('VERİ YOK') || r.dataStatus === 'VERİ YOK – doğrulanmalı').length,
    noEvidence: p.requirements.filter((r) => !r.evidenceType).length,
  };
}

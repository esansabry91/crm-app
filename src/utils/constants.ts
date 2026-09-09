import type { Stage } from '../types';

/** Visual identity per stage: used for kanban column headers, badges and chart series. */
export const STAGE_COLORS: Record<Stage, { bg: string; border: string; text: string; dot: string }> = {
  'New Lead': { bg: 'bg-slate-50', border: 'border-slate-200', text: 'text-slate-700', dot: '#64748b' },
  'Qualified Lead': { bg: 'bg-sky-50', border: 'border-sky-200', text: 'text-sky-700', dot: '#0284c7' },
  'Prepare Proposal': { bg: 'bg-amber-50', border: 'border-amber-200', text: 'text-amber-700', dot: '#d97706' },
  Submitted: { bg: 'bg-violet-50', border: 'border-violet-200', text: 'text-violet-700', dot: '#7c3aed' },
  Negotiation: { bg: 'bg-orange-50', border: 'border-orange-200', text: 'text-orange-700', dot: '#ea580c' },
  Won: { bg: 'bg-emerald-50', border: 'border-emerald-200', text: 'text-emerald-700', dot: '#059669' },
  Lost: { bg: 'bg-rose-50', border: 'border-rose-200', text: 'text-rose-700', dot: '#e11d48' },
};

/** Categorical palette for brand breakdowns / other series that aren't stage-keyed. */
export const SERIES_COLORS = ['#2563eb', '#d97706', '#059669', '#7c3aed', '#e11d48', '#0891b2'];

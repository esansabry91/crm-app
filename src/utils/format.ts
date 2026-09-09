export function formatRM(value: number): string {
  if (!Number.isFinite(value)) return 'RM 0';
  return new Intl.NumberFormat('en-MY', {
    style: 'currency',
    currency: 'MYR',
    maximumFractionDigits: 0,
  })
    .format(value)
    .replace('MYR', 'RM');
}

export function formatDate(iso: string | undefined): string {
  if (!iso) return '-';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '-';
  return d.toLocaleDateString('en-MY', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function formatMonthLabel(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleDateString('en-MY', { month: 'short', year: '2-digit' });
}

export function formatDateTime(timestamp: number): string {
  const d = new Date(timestamp);
  return d.toLocaleString('en-MY', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

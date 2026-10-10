import { useState } from 'react';
import clsx from 'clsx';
import type { WorkspaceTaskPriority } from '../../types';

/** red = high (4–5), amber = medium (2–3), blue = low (1) — mirrors gdsb-portal's own banding. */
export function priorityBand(priority: WorkspaceTaskPriority): 'low' | 'medium' | 'high' {
  if (priority >= 4) return 'high';
  if (priority >= 2) return 'medium';
  return 'low';
}

export const BAND_COLOR: Record<'low' | 'medium' | 'high', string> = {
  low: '#2a78d6',
  medium: '#eda100',
  high: '#d03b3b',
};

/** Higher priority sorts first; within the same priority, insertion order (position) wins. */
export function sortWorkspaceTasks<T extends { priority: WorkspaceTaskPriority; position: number; done: boolean }>(tasks: T[]): T[] {
  return [...tasks].sort((a, b) => {
    if (a.done !== b.done) return a.done ? 1 : -1;
    if (a.priority !== b.priority) return b.priority - a.priority;
    return a.position - b.position;
  });
}

/**
 * Five small lights, lit up to `value` and colored by its band — clickable to change the value
 * when `editable`, read-only otherwise. Mirrors gdsb-portal's own PriorityLights component
 * (Planner.tsx), including the lit light's soft pulsing glow (see the `.prio-glow` keyframes in
 * index.css).
 */
export default function PriorityLights({
  value,
  editable = false,
  onChange,
  compact = false,
  title,
}: {
  value: WorkspaceTaskPriority;
  editable?: boolean;
  onChange?: (priority: WorkspaceTaskPriority) => void;
  compact?: boolean;
  title?: string;
}) {
  const [hover, setHover] = useState<WorkspaceTaskPriority | null>(null);
  const shown = hover ?? value;
  const color = BAND_COLOR[priorityBand(shown)];
  const size = compact ? 6 : 8;

  return (
    <div
      className="inline-flex items-center gap-1"
      role={editable ? 'radiogroup' : undefined}
      aria-label={editable ? title ?? 'Priority' : undefined}
      title={!editable ? title : undefined}
      onMouseLeave={() => setHover(null)}
    >
      {([1, 2, 3, 4, 5] as WorkspaceTaskPriority[]).map((level) => {
        const lit = level <= shown;
        return (
          <button
            key={level}
            type="button"
            disabled={!editable}
            aria-pressed={lit}
            onMouseEnter={() => editable && setHover(level)}
            onClick={() => editable && onChange?.(level)}
            className={clsx('rounded-full transition-colors', editable ? 'cursor-pointer' : 'cursor-default')}
            style={{
              width: size,
              height: size,
              backgroundColor: lit ? color : '#e1e0d9',
              color,
              boxShadow: lit ? undefined : 'none',
            }}
          >
            <span className={lit ? 'block w-full h-full rounded-full prio-glow' : 'block w-full h-full rounded-full'} style={{ backgroundColor: lit ? color : 'transparent' }} />
          </button>
        );
      })}
    </div>
  );
}

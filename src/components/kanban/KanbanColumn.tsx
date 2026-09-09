import { Droppable } from '@hello-pangea/dnd';
import type { Stage, Tender } from '../../types';
import { STAGE_COLORS } from '../../utils/constants';
import { formatRM } from '../../utils/format';
import TenderCard from './TenderCard';

export default function KanbanColumn({
  stage,
  tenders,
  onCardClick,
  canDrag,
}: {
  stage: Stage;
  tenders: Tender[];
  onCardClick: (t: Tender) => void;
  canDrag: boolean;
}) {
  const colors = STAGE_COLORS[stage];
  const totalValue = tenders.reduce((s, t) => s + (t.tenderValue || 0), 0);

  return (
    <div className="w-72 shrink-0 flex flex-col max-h-full">
      <div className={`rounded-t-xl border ${colors.border} ${colors.bg} px-3 py-2.5`}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: colors.dot }} />
            <p className={`text-sm font-semibold ${colors.text}`}>{stage}</p>
          </div>
          <span className={`text-xs font-medium ${colors.text} bg-white/60 px-1.5 py-0.5 rounded`}>
            {tenders.length}
          </span>
        </div>
        <p className="text-xs text-slate-500 mt-0.5">{formatRM(totalValue)}</p>
      </div>

      <Droppable droppableId={stage} isDropDisabled={!canDrag}>
        {(provided, snapshot) => (
          <div
            ref={provided.innerRef}
            {...provided.droppableProps}
            className={`flex-1 min-h-[120px] overflow-y-auto border border-t-0 rounded-b-xl px-2.5 py-2.5 ${
              snapshot.isDraggingOver ? 'bg-blue-50/40' : 'bg-slate-50/50'
            } ${colors.border}`}
          >
            {tenders.map((t, i) => (
              <TenderCard
                key={t.id}
                tender={t}
                index={i}
                draggable={canDrag}
                onClick={() => onCardClick(t)}
              />
            ))}
            {provided.placeholder}
            {tenders.length === 0 && (
              <p className="text-center text-xs text-slate-300 mt-6">No tenders</p>
            )}
          </div>
        )}
      </Droppable>
    </div>
  );
}

import { DragDropContext, type DropResult } from '@hello-pangea/dnd';
import { STAGES, type Tender } from '../../types';
import KanbanColumn from './KanbanColumn';

export default function KanbanBoard({
  tenders,
  onCardClick,
  onDropStage,
  onDisqualify,
  canDrag,
}: {
  tenders: Tender[];
  onCardClick: (t: Tender) => void;
  onDropStage: (tender: Tender, newStage: (typeof STAGES)[number]) => void;
  onDisqualify: (t: Tender) => void;
  canDrag: boolean;
}) {
  const handleDragEnd = (result: DropResult) => {
    const { source, destination, draggableId } = result;
    if (!destination) return;
    if (source.droppableId === destination.droppableId) return;
    const tender = tenders.find((t) => t.id === draggableId);
    if (!tender) return;

    const newStage = destination.droppableId as (typeof STAGES)[number];

    // Won/Lost/Disqualified Lead tenders are "terminal" — moving one off needs a deliberate
    // confirmation so it can't happen from an accidental drag. Dropping into one of these for
    // the first time is a normal forward action (or, for Disqualified Lead, not possible via
    // drag at all — see KanbanColumn's isDropDisabled) and doesn't need this extra step.
    const wasTerminal = tender.stage === 'Won' || tender.stage === 'Lost' || tender.stage === 'Disqualified Lead';
    if (wasTerminal) {
      const confirmed = window.confirm(
        `"${tender.clientName}" is already marked ${tender.stage}. Are you sure you want to move it to ${newStage}?`
      );
      if (!confirmed) return;
    }

    onDropStage(tender, newStage);
  };

  return (
    <DragDropContext onDragEnd={handleDragEnd}>
      <div className="flex gap-4 overflow-x-auto pb-4 h-full">
        {STAGES.map((stage) => (
          <KanbanColumn
            key={stage}
            stage={stage}
            tenders={tenders.filter((t) => t.stage === stage)}
            onCardClick={onCardClick}
            onDisqualify={onDisqualify}
            canDrag={canDrag}
          />
        ))}
      </div>
    </DragDropContext>
  );
}

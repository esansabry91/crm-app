import { Draggable } from '@hello-pangea/dnd';
import type { Tender } from '../../types';
import { formatDate, formatRM } from '../../utils/format';

export default function TenderCard({
  tender,
  index,
  onClick,
  onDisqualify,
  onRequalify,
  draggable,
  canAct,
}: {
  tender: Tender;
  index: number;
  onClick: () => void;
  onDisqualify: () => void;
  onRequalify: () => void;
  draggable: boolean;
  // Whether action buttons (Disqualify/Re-qualify) should show — independent of `draggable`,
  // since a Disqualified Lead card is never draggable but still needs its Re-qualify button.
  canAct: boolean;
}) {
  const content = (
    <div
      onClick={onClick}
      className="bg-white rounded-xl border border-slate-200 p-3 shadow-sm hover:shadow-md hover:border-slate-300 transition cursor-pointer"
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm font-semibold text-slate-900 leading-snug">{tender.clientName}</p>
        <span className="shrink-0 text-[10px] font-medium px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">
          {tender.brandName}
        </span>
      </div>
      <p className="text-sm font-semibold text-blue-700 mt-1.5">{formatRM(tender.tenderValue)}</p>
      <div className="mt-2 flex items-center justify-between text-[11px] text-slate-400">
        <span>{tender.department}</span>
        <span>{formatDate(tender.contractEnd)}</span>
      </div>
      {tender.submittedDate && (
        <p className="mt-1 text-[11px] text-slate-500">Submitted {formatDate(tender.submittedDate)}</p>
      )}
      {(tender.stage === 'Won' || tender.stage === 'Lost') && tender.closedDate && (
        <p className={`mt-1 text-[11px] ${tender.stage === 'Won' ? 'text-emerald-600' : 'text-rose-500'}`}>
          {tender.stage} on {formatDate(tender.closedDate)}
        </p>
      )}
      {tender.stage === 'Disqualified Lead' && tender.disqualifiedDate && (
        <p className="mt-1 text-[11px] text-stone-500">
          Disqualified on {formatDate(tender.disqualifiedDate)}
        </p>
      )}
      <div className="mt-2 pt-2 border-t border-slate-100 text-[11px] text-slate-500 truncate">
        {tender.ownerName}
      </div>
      {tender.stage === 'New Lead' && canAct && (
        <button
          type="button"
          onClick={(e) => {
            // Don't also trigger the card's own onClick (which opens the edit modal) — this
            // button lives inside that same clickable card.
            e.stopPropagation();
            onDisqualify();
          }}
          className="mt-2 w-full text-[11px] font-medium text-stone-500 hover:text-stone-700 hover:bg-stone-50 border border-stone-200 rounded-md py-1 transition"
        >
          Disqualify
        </button>
      )}
      {tender.stage === 'Disqualified Lead' && canAct && (
        <button
          type="button"
          onClick={(e) => {
            // Same reasoning as the Disqualify button above — this card is also clickable.
            e.stopPropagation();
            onRequalify();
          }}
          className="mt-2 w-full text-[11px] font-medium text-blue-600 hover:text-blue-700 hover:bg-blue-50 border border-blue-200 rounded-md py-1 transition"
        >
          Re-qualify
        </button>
      )}
    </div>
  );

  if (!draggable) return <div className="mb-2.5">{content}</div>;

  return (
    <Draggable draggableId={tender.id} index={index}>
      {(provided, snapshot) => (
        <div
          ref={provided.innerRef}
          {...provided.draggableProps}
          {...provided.dragHandleProps}
          className={`mb-2.5 ${snapshot.isDragging ? 'rotate-1 scale-[1.02]' : ''}`}
        >
          {content}
        </div>
      )}
    </Draggable>
  );
}

import React from 'react';
import { CircleCheck, Trash2 } from 'lucide-react';

interface BulkActionsBarProps {
  selectedCount: number;
  totalCount: number;
  filteredCount: number;
  pageSize: number;
  onCancelSelection: () => void;
  onSelectAllFiltered: () => void;
  onDeleteSelected: () => void;
}

export const BulkActionsBar: React.FC<BulkActionsBarProps> = ({
  selectedCount,
  totalCount,
  filteredCount,
  pageSize,
  onCancelSelection,
  onSelectAllFiltered,
  onDeleteSelected,
}) => {
  if (selectedCount === 0) return null;

  return (
    <div className="p-4 bg-gradient-to-r from-orange-500/10 to-red-500/10 border-2 border-orange-500/30 rounded-lg flex items-center justify-between flex-wrap gap-3">
      <div className="text-sm text-orange-300 font-medium flex items-center gap-1">
        <CircleCheck className="w-4 h-4" /> تم تحديد <strong>{selectedCount}</strong> من {totalCount} طالب
      </div>
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={onCancelSelection}
          className="btn-base btn-secondary"
        >
          إلغاء التحديد
        </button>
        {filteredCount > pageSize && (
          <button
            onClick={onSelectAllFiltered}
            className="btn-base btn-primary"
            title="تحديد جميع نتائج البحث"
          >
            تحديد كل النتائج ({filteredCount})
          </button>
        )}
        <button
          onClick={onDeleteSelected}
          className="btn-base btn-danger"
        >
          <Trash2 className="w-4 h-4" />           حذف المحدد ({selectedCount})
        </button>
      </div>
    </div>
  );
};

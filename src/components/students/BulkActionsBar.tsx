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
    <div className="mb-4 p-4 bg-gradient-to-r from-orange-500/10 to-red-500/10 border-2 border-orange-500/30 rounded-lg flex items-center justify-between flex-wrap gap-3">
      <div className="text-orange-300 font-medium flex items-center gap-1">
        <CircleCheck className="w-4 h-4" /> تم تحديد <strong>{selectedCount}</strong> من {totalCount} طالب
      </div>
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={onCancelSelection}
          className="px-4 py-2 bg-white/10 hover:bg-white/20 text-white font-medium rounded-md transition"
        >
          إلغاء التحديد
        </button>
        {filteredCount > pageSize && (
          <button
            onClick={onSelectAllFiltered}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white font-medium rounded-md transition"
            title="تحديد جميع نتائج البحث"
          >
            تحديد كل النتائج ({filteredCount})
          </button>
        )}
        <button
          onClick={onDeleteSelected}
          className="px-4 py-2 bg-gradient-to-r from-red-600 to-red-700 hover:from-red-700 hover:to-red-800 text-white font-medium rounded-md transition shadow-md flex items-center gap-2"
        >
          <Trash2 className="w-4 h-4" />           حذف المحدد ({selectedCount})
        </button>
      </div>
    </div>
  );
};

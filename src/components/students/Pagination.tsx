import React from 'react';
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from 'lucide-react';

const PAGE_SIZE_OPTIONS = [25, 50, 100, 200];

interface PaginationProps {
  variant: 'top' | 'bottom';
  currentPage: number;
  totalPages: number;
  pageSize: number;
  totalItems: number;
  setCurrentPage: React.Dispatch<React.SetStateAction<number>>;
  setPageSize: React.Dispatch<React.SetStateAction<number>>;
}

export const Pagination: React.FC<PaginationProps> = ({
  variant,
  currentPage,
  totalPages,
  pageSize,
  totalItems,
  setCurrentPage,
  setPageSize,
}) => {
  if (totalItems <= pageSize) return null;

  if (variant === 'top') {
    return (
      <div className="p-3 sm:p-4 bg-white/5 border border-white/10 rounded-lg flex items-center justify-between flex-wrap gap-2 sm:gap-3">
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-slate-400">عرض:</span>
          <select
            value={pageSize}
            onChange={e => setPageSize(Number(e.target.value))}
            className="min-h-10 px-3 py-2 border border-slate-600 bg-slate-800 text-white rounded-md text-sm"
          >
            {PAGE_SIZE_OPTIONS.map(size => (
              <option key={size} value={size}>{size} طالب</option>
            ))}
          </select>
          <span className="text-slate-400">
            ({((currentPage - 1) * pageSize) + 1} - {Math.min(currentPage * pageSize, totalItems)} من {totalItems})
          </span>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setCurrentPage(1)}
            disabled={currentPage === 1}
            className="min-h-10 min-w-10 px-2 inline-flex items-center justify-center bg-white/10 border border-white/15 rounded transition-colors duration-200 disabled:opacity-30 hover:bg-white/20"
            title="الصفحة الأولى"
          >
            <ChevronsRight className="w-4 h-4" />
          </button>
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="min-h-10 px-3 inline-flex items-center gap-1.5 bg-white/10 border border-white/15 rounded transition-colors duration-200 disabled:opacity-30 hover:bg-white/20 text-sm"
          >
            <ChevronRight className="w-4 h-4" /> السابق
          </button>
          <span className="min-h-10 px-3 inline-flex items-center rounded bg-blue-600 text-white text-sm font-bold">
            {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="min-h-10 px-3 inline-flex items-center gap-1.5 bg-white/10 border border-white/15 rounded transition-colors duration-200 disabled:opacity-30 hover:bg-white/20 text-sm"
          >
            التالي <ChevronLeft className="w-4 h-4" />
          </button>
          <button
            onClick={() => setCurrentPage(totalPages)}
            disabled={currentPage === totalPages}
            className="min-h-10 min-w-10 px-2 inline-flex items-center justify-center bg-white/10 border border-white/15 rounded transition-colors duration-200 disabled:opacity-30 hover:bg-white/20"
            title="الصفحة الأخيرة"
          >
            <ChevronsLeft className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
      <div className="p-3 sm:p-4 bg-white/5 border border-white/10 rounded-lg flex items-center justify-center gap-2 flex-wrap">
      <button
        onClick={() => setCurrentPage(1)}
        disabled={currentPage === 1}
        className="min-h-10 px-3 inline-flex items-center gap-1.5 bg-white/10 border border-white/15 rounded transition-colors duration-200 disabled:opacity-30 hover:bg-white/20 text-sm"
      >
        <ChevronsRight className="w-4 h-4" /> الأولى
      </button>
      <button
        onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
        disabled={currentPage === 1}
        className="min-h-10 px-3 inline-flex items-center gap-1.5 bg-white/10 border border-white/15 rounded transition-colors duration-200 disabled:opacity-30 hover:bg-white/20 text-sm"
      >
        <ChevronRight className="w-4 h-4" /> السابق
      </button>

      {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
        let pageNum: number;
        if (totalPages <= 7) {
          pageNum = i + 1;
        } else if (currentPage <= 4) {
          pageNum = i + 1;
        } else if (currentPage >= totalPages - 3) {
          pageNum = totalPages - 6 + i;
        } else {
          pageNum = currentPage - 3 + i;
        }
        return (
          <button
            key={pageNum}
            onClick={() => setCurrentPage(pageNum)}
            className={`min-h-10 px-3 inline-flex items-center justify-center rounded text-sm font-medium transition-colors duration-200 ${
              pageNum === currentPage
                ? 'bg-blue-600 text-white'
                : 'bg-white/10 border border-white/15 hover:bg-white/20'
            }`}
          >
            {pageNum}
          </button>
        );
      })}

      <button
        onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
        disabled={currentPage === totalPages}
        className="min-h-10 px-3 inline-flex items-center gap-1.5 bg-white/10 border border-white/15 rounded transition-colors duration-200 disabled:opacity-30 hover:bg-white/20 text-sm"
      >
        التالي <ChevronLeft className="w-4 h-4" />
      </button>
      <button
        onClick={() => setCurrentPage(totalPages)}
        disabled={currentPage === totalPages}
        className="min-h-10 px-3 inline-flex items-center gap-1.5 bg-white/10 border border-white/15 rounded transition-colors duration-200 disabled:opacity-30 hover:bg-white/20 text-sm"
      >
        الأخيرة <ChevronsLeft className="w-4 h-4" />
      </button>
    </div>
  );
};

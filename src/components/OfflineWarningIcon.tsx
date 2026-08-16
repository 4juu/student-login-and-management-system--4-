import React from 'react';
import { TriangleAlert } from 'lucide-react';

export const OfflineWarningIcon: React.FC = () => (
  <span
    title="انقطع الاتصال بالإنترنت - البيانات محفوظة محلياً وستُرفع تلقائياً"
    className="inline-flex items-center justify-center animate-fadePulse"
  >
    <TriangleAlert
      className="w-6 h-6 text-red-500 drop-shadow-[0_0_6px_rgba(239,68,68,0.8)]"
      fill="rgba(239,68,68,0.15)"
    />
  </span>
);
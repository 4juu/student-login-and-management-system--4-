import React from 'react';
import { motion } from 'framer-motion';
import { TriangleAlert } from 'lucide-react';

export const OfflineWarningIcon: React.FC = () => (
  <motion.span
    title="انقطع الاتصال بالإنترنت - البيانات محفوظة محلياً وستُرفع تلقائياً"
    className="inline-flex items-center justify-center"
    animate={{ opacity: [1, 0.3, 1] }}
    transition={{ duration: 1.2, repeat: Infinity, ease: 'easeInOut' }}
  >
    <TriangleAlert
      className="w-6 h-6 text-red-500 drop-shadow-[0_0_6px_rgba(239,68,68,0.8)]"
      fill="rgba(239,68,68,0.15)"
    />
  </motion.span>
);

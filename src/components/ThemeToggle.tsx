import React from 'react';
import { useTheme } from '../contexts/ThemeContext';

interface ThemeToggleProps {
  size?: 'sm' | 'md' | 'lg';
  showLabel?: boolean;
}

export const ThemeToggle: React.FC<ThemeToggleProps> = ({ size = 'md', showLabel = false }) => {
  const { theme, toggleTheme } = useTheme();

  const sizes = {
    sm: { width: 'w-12', height: 'h-6', ball: 'w-5 h-5', icon: 'text-xs' },
    md: { width: 'w-14', height: 'h-7', ball: 'w-6 h-6', icon: 'text-sm' },
    lg: { width: 'w-16', height: 'h-8', ball: 'w-7 h-7', icon: 'text-base' },
  };

  const s = sizes[size];

  return (
    <div className="flex items-center gap-2">
      {showLabel && (
        <span className={`text-sm font-medium transition-colors ${
          theme === 'dark' ? 'text-slate-300' : 'text-gray-700'
        }`}>
          {theme === 'dark' ? '🌙 ليلي' : '☀️ نهاري'}
        </span>
      )}
      
      <button
        onClick={toggleTheme}
        className={`relative ${s.width} ${s.height} rounded-full transition-all duration-300 shadow-inner ${
          theme === 'dark' 
            ? 'bg-gradient-to-r from-indigo-900 to-purple-900 hover:from-indigo-800 hover:to-purple-800' 
            : 'bg-gradient-to-r from-yellow-300 to-orange-400 hover:from-yellow-400 hover:to-orange-500'
        }`}
        title={theme === 'dark' ? 'تفعيل الوضع النهاري' : 'تفعيل الوضع الليلي'}
        aria-label="تبديل الوضع"
      >
        <div
          className={`absolute top-0.5 ${s.ball} rounded-full transition-all duration-300 flex items-center justify-center shadow-md ${
            theme === 'dark'
              ? 'right-0.5 bg-gradient-to-br from-slate-700 to-slate-900'
              : `${size === 'sm' ? 'right-6' : size === 'md' ? 'right-7' : 'right-8'} bg-gradient-to-br from-white to-yellow-100`
          }`}
        >
          <span className={s.icon}>
            {theme === 'dark' ? '🌙' : '☀️'}
          </span>
        </div>
      </button>
    </div>
  );
};
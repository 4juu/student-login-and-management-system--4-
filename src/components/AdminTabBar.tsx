import type { FC } from 'react';
import type { Tab } from '../hooks/useNavigation';

interface AdminTabBarProps {
  activeTab: Tab;
  isMainAdmin: boolean;
  isCollegeAdmin: boolean;
  pendingCount: number;
  onTabChange: (tab: Tab) => void;
  onOpenSendLink: () => void;
  onOpenTestLink: () => void;
  onOpenPending: () => void;
}

export const AdminTabBar: FC<AdminTabBarProps> = ({
  activeTab,
  isMainAdmin,
  isCollegeAdmin,
  pendingCount,
  onTabChange,
  onOpenSendLink,
  onOpenTestLink,
  onOpenPending,
}) => (
  <div className="overflow-x-auto scrollbar-none">
    <div className="flex flex-nowrap md:flex-wrap gap-2 md:gap-3 pt-3 pb-3 md:pb-3 md:pt-3 justify-start md:justify-center mb-4 md:mb-6">
      {/* role=tablist يحتوي أزرار التبويب فقط — أزرار الإجراءات خارجه (شرط ARIA) */}
      <div role="tablist" aria-label="أقسام لوحة الإدارة" className="contents">
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'stage-selector'}
          onClick={() => onTabChange('stage-selector')}
          className={`tab-btn shrink-0 ${activeTab === 'stage-selector' ? 'active' : ''}`}
        >
          اختيار المرحلة
        </button>
        {isMainAdmin && (
          <>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'colleges'}
              onClick={() => onTabChange('colleges')}
              className={`tab-btn shrink-0 ${activeTab === 'colleges' ? 'active' : ''}`}
            >
              إدارة الكليات
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'teachers'}
              onClick={() => onTabChange('teachers')}
              className={`tab-btn shrink-0 ${activeTab === 'teachers' ? 'active' : ''}`}
            >
              التدريسيين
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === 'system-settings'}
              onClick={() => onTabChange('system-settings')}
              className={`tab-btn shrink-0 ${activeTab === 'system-settings' ? 'active' : ''}`}
            >
              إعدادات النظام
            </button>
          </>
        )}
        {isCollegeAdmin && (
          <button
            type="button"
            role="tab"
            aria-selected={activeTab === 'teachers'}
            onClick={() => onTabChange('teachers')}
            className={`tab-btn shrink-0 ${activeTab === 'teachers' ? 'active' : ''}`}
          >
            صلاحيات التدريسيين
          </button>
        )}
        <button
          type="button"
          role="tab"
          aria-selected={activeTab === 'profile'}
          onClick={() => onTabChange('profile')}
          className={`tab-btn shrink-0 ${activeTab === 'profile' ? 'active' : ''}`}
        >
          الملف الشخصي
        </button>
      </div>
      {isMainAdmin && (
        <>
          <button type="button" onClick={onOpenSendLink} className="btn-base btn-primary shrink-0">
            إرسال رابط تسجيل بصمة
          </button>
          <button type="button" onClick={onOpenTestLink} className="btn-base btn-secondary shrink-0">
            اختبار بصمة
          </button>
        </>
      )}
      {(isMainAdmin || isCollegeAdmin) && (
        <div className="shrink-0 relative" style={{ overflow: 'visible' }}>
          <button type="button" onClick={onOpenPending} className="btn-base btn-secondary" aria-label={pendingCount > 0 ? `طلبات التسجيل (${pendingCount} معلّق)` : 'طلبات التسجيل'}>
            طلبات التسجيل
          </button>
          {pendingCount > 0 && (
            <span
              aria-hidden="true"
              className="absolute bg-red-500 text-white text-xs font-bold rounded-full min-w-[22px] h-[22px] px-1.5 flex items-center justify-center shadow-lg"
              style={{ top: '-8px', right: '-8px', zIndex: 9999, animation: 'pulse-badge 1.5s ease-in-out infinite' }}
            >
              {pendingCount > 99 ? '99+' : pendingCount}
            </span>
          )}
        </div>
      )}
    </div>
  </div>
);

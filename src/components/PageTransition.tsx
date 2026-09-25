import { useEffect, useRef, useState, type ReactNode } from 'react';

interface PageTransitionProps {
  /** يتغيّر عند تبديل الصفحة/التبويب — يبدأ الانتقال عند تغيّره */
  dep: string;
  children: ReactNode;
}

/** مدة الخروج بالمللي ثانية — تطابق مدة pageExit في index.css */
const EXIT_MS = 180;

/**
 * انتقال سلس بين الصفحات: خروج القديم ثم دخول الجديد (تتابع لا قفزات)،
 * ويحفظ محتوى الصفحة أثناء الخروج حتى لا يختفي قبل انتهاء الأنيميشن.
 */
export function PageTransition({ dep, children }: PageTransitionProps) {
  const [phase, setPhase] = useState<'in' | 'out'>('in');
  const frozenRef = useRef<ReactNode>(children);
  const lastDepRef = useRef(dep);

  // كشف تغيّر الصفحة أثناء الرسم (قبل الـpaint) حتى لا تُرسم لقطة واحدة للمحتوى الجديد قبل بدء الخروج
  if (phase === 'in' && dep !== lastDepRef.current) {
    lastDepRef.current = dep;
    setPhase('out');
  }

  useEffect(() => {
    if (phase === 'in') {
      frozenRef.current = children; // احفظ المحتوى الحالي لحظة خروجه
      return;
    }
    const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const id = window.setTimeout(() => setPhase('in'), reduced ? 0 : EXIT_MS);
    return () => window.clearTimeout(id);
  }, [phase, children]);

  if (phase === 'out') {
    return <div className="animate-pageExit">{frozenRef.current}</div>;
  }
  return <div className="animate-pageEnter">{children}</div>;
}

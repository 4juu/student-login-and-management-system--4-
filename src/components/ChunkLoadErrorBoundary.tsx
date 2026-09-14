import { Component, ReactNode } from 'react';

interface ChunkLoadErrorBoundaryProps {
  children: ReactNode;
}

interface ChunkLoadErrorBoundaryState {
  hasError: boolean;
  reloading: boolean;
}

const RELOAD_FLAG = 'opencode_chunk_reload';

// 🚨 حماية من خطأ "Failed to fetch dynamically imported module" —
// يحدث لما يكون عندك تبويب/كاش قديم والموقع ينزل نسخة جديدة بأسماء ملفات متغيرة.
// عند الفشل نعمل تحديث كامل ويجيب index.html الجديد بهاشات صحيحة.
export class ChunkLoadErrorBoundary extends Component<
  ChunkLoadErrorBoundaryProps,
  ChunkLoadErrorBoundaryState
> {
  state: ChunkLoadErrorBoundaryState = { hasError: false, reloading: false };

  static getDerivedStateFromError(): ChunkLoadErrorBoundaryState {
    return { hasError: true, reloading: false };
  }

  componentDidCatch(error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    const isChunkError =
      /dynamically (imported|fetched)|Loading chunk|import\(\"\.\//i.test(msg) ||
      /Failed to fetch/i.test(msg) ||
      error instanceof TypeError;

    if (isChunkError) {
      try {
        const alreadyReloaded = sessionStorage.getItem(RELOAD_FLAG) === '1';
        if (alreadyReloaded) {
          sessionStorage.removeItem(RELOAD_FLAG);
        } else {
          sessionStorage.setItem(RELOAD_FLAG, '1');
          this.setState({ reloading: true });
          window.location.reload();
        }
      } catch {
        window.location.reload();
      }
    }
  }

  render() {
    if (this.state.hasError) {
      if (this.state.reloading) {
        return (
          <div className="min-h-screen flex flex-col items-center justify-center bg-[#0B1220] text-white">
            <p className="text-sm text-slate-300">تحديث الإصدار الجديد...</p>
          </div>
        );
      }
      return (
        <div className="min-h-screen flex flex-col items-center justify-center bg-[#0B1220] text-white p-6 text-center">
          <p className="text-base font-bold mb-2">حدث خطأ في تحميل الموقع</p>
          <button
            onClick={() => window.location.reload()}
            className="mt-4 px-6 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition"
          >
            إعادة تحميل الصفحة
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
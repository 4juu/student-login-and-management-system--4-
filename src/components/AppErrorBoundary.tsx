import { Component, ErrorInfo, ReactNode } from 'react';
import { captureException } from '../lib/sentry';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

// 🚨 حدّ خطأ عام يحيط بكل التطبيق — يلتقط أي خطأ وقت التشغيل غير المغطى
// بحدود أخرى (ChunkLoadErrorBoundary) ويعرض واجهة عربية قابلة لإعادة المحاولة
// بدل شاشة بيضاء فارغة، مع إرسال الخطأ إلى Sentry عند توفره.
export class AppErrorBoundary extends Component<Props, State> {
  state: State = { hasError: false, error: null };

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    captureException(error, { componentStack: info.componentStack ?? undefined });
  }

  private handleRetry = (): void => {
    this.setState({ hasError: false, error: null });
  };

  private handleReload = (): void => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) return this.props.children;

    return (
      <div
        dir="rtl"
        role="alert"
        className="min-h-screen flex flex-col items-center justify-center bg-[#0B1220] text-white p-6 text-center"
      >
        <div className="w-full max-w-md">
          <div
            aria-hidden="true"
            className="mx-auto w-16 h-16 rounded-full border-2 border-red-500/40 bg-gradient-to-br from-red-950 to-[#0F1A30] flex items-center justify-center mb-5"
          >
            <span className="text-2xl">⚠️</span>
          </div>

          <h1 className="text-xl font-bold mb-2 leading-snug">حدث خطأ غير متوقع</h1>
          <p className="text-slate-400 text-sm mb-6 leading-relaxed">
            عذراً، واجهنا مشكلة أثناء تشغيل الصفحة. يمكنك إعادة المحاولة أو تحديث الصفحة.
          </p>

          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={this.handleRetry}
              className="px-6 py-2.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium transition"
            >
              إعادة المحاولة
            </button>
            <button
              onClick={this.handleReload}
              className="px-6 py-2.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium transition"
            >
              تحديث الصفحة
            </button>
          </div>

          {this.state.error?.message && (
            <details className="mt-6 text-right">
              <summary className="text-xs text-slate-500 cursor-pointer hover:text-slate-400">
                تفاصيل تقنية (للمطوّر)
              </summary>
              <pre className="mt-2 text-xs text-red-300 bg-red-500/10 border border-red-500/20 rounded-lg p-3 overflow-auto text-left whitespace-pre-wrap break-words">
                {this.state.error.message}
              </pre>
            </details>
          )}
        </div>
      </div>
    );
  }
}

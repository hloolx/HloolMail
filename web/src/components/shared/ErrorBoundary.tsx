import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
  children: ReactNode;
  variant?: 'page' | 'inline';
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('[ErrorBoundary]', error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      if (this.props.variant === 'inline') {
        return (
          <div className="flex items-center justify-center p-8 min-h-[200px]">
            <div className="text-center max-w-sm">
              <div className="mx-auto mb-3 w-10 h-10 rounded-full flex items-center justify-center"
                   style={{ background: 'color-mix(in srgb, var(--bad) 10%, transparent)' }}>
                <AlertTriangle size={20} style={{ color: 'var(--bad)' }} />
              </div>
              <h3 className="text-sm font-semibold mb-1">页面加载失败</h3>
              <p className="text-xs text-[var(--muted)] mb-3">{this.state.error.message}</p>
              <button className="btn-primary btn-sm" onClick={() => this.setState({ error: null })}>
                <RefreshCw size={14} /> 重试
              </button>
            </div>
          </div>
        );
      }
      return (
        <div className="min-h-screen bg-[var(--shell)] flex items-center justify-center p-6">
          <div className="text-center max-w-md">
            <div className="mx-auto mb-4 w-12 h-12 rounded-full flex items-center justify-center" style={{ background: 'color-mix(in srgb, var(--bad) 10%, transparent)' }}>
              <AlertTriangle size={24} className="w-6 h-6" style={{ color: 'var(--bad)' }} />
            </div>
            <h2 className="text-lg font-semibold mb-2">页面发生错误</h2>
            <p className="text-sm text-[var(--muted)] mb-4">{this.state.error.message}</p>
            <button
              className="btn-primary"
              onClick={() => {
                this.setState({ error: null });
                window.location.reload();
              }}
            >
              <RefreshCw size={16} />
              刷新页面
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

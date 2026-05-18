import { useState } from 'react';
import { Copy, Check, ChevronDown, ChevronUp, AlertCircle } from 'lucide-react';
import { JsonViewer } from './JsonViewer';

export type ExplorerResult = {
  ok: boolean;
  status: number;
  statusText: string;
  body: string;
  url: string;
  method: string;
};

type ResponsePanelProps = {
  result: ExplorerResult | null;
  callError: string;
  duration?: number; // request duration in ms
  responseHeaders?: Record<string, string>;
  onCopyBody?: () => void;
  emptyText: string;
  errorText?: string;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function getStatusPillClasses(status: number): string {
  if (status >= 200 && status < 300) {
    return 'bg-[var(--good)]/10 text-[var(--good)]';
  }
  if (status >= 300 && status < 400) {
    return 'bg-yellow-500/10 text-yellow-600';
  }
  return 'bg-[var(--bad)]/10 text-[var(--bad)]';
}

function isJson(body: string): boolean {
  const trimmed = body.trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

export function ResponsePanel({
  result,
  callError,
  duration,
  responseHeaders,
  onCopyBody,
  emptyText,
  errorText,
}: ResponsePanelProps) {
  const [headersExpanded, setHeadersExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    onCopyBody?.();
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!result && !callError) {
    return (
      <div className="flex items-center justify-center h-full text-sm text-[var(--muted)]">
        {emptyText}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3 h-full">
      {callError && (
        <div className="flex items-center gap-2 p-3 rounded-lg border border-[var(--bad)]/20 bg-[var(--bad)]/10 text-sm text-[var(--bad)]">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>{errorText || callError}</span>
        </div>
      )}

      {result && (
        <>
          {/* Status bar */}
          <div className="flex items-center gap-3 flex-wrap">
            <span
              className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${getStatusPillClasses(result.status)}`}
            >
              {result.status} {result.statusText}
            </span>

            {duration !== undefined && (
              <span className="text-xs text-[var(--muted)]">{duration}ms</span>
            )}

            <span className="text-xs text-[var(--muted)]">
              {formatBytes(result.body.length)}
            </span>

            <button
              onClick={handleCopy}
              className="inline-flex items-center gap-1 ml-auto px-2 py-1 rounded-md text-xs font-medium text-[var(--foreground)] bg-[var(--soft)] hover:bg-[var(--border)] transition-colors"
              title="Copy response body"
            >
              {copied ? (
                <Check className="w-3.5 h-3.5" />
              ) : (
                <Copy className="w-3.5 h-3.5" />
              )}
              {copied ? 'Copied' : 'Copy'}
            </button>
          </div>

          {/* Response Headers */}
          {responseHeaders && Object.keys(responseHeaders).length > 0 && (
            <div className="border border-[var(--border)] rounded-lg overflow-hidden">
              <button
                onClick={() => setHeadersExpanded((v) => !v)}
                className="flex items-center justify-between w-full px-3 py-2 text-xs font-medium text-[var(--foreground)] bg-[var(--panel)] hover:bg-[var(--soft)] transition-colors"
              >
                <span>Response Headers</span>
                {headersExpanded ? (
                  <ChevronUp className="w-3.5 h-3.5" />
                ) : (
                  <ChevronDown className="w-3.5 h-3.5" />
                )}
              </button>
              {headersExpanded && (
                <div className="px-3 py-2 space-y-1 bg-[var(--background)]">
                  {Object.entries(responseHeaders).map(([key, value]) => (
                    <div key={key} className="flex items-start gap-2 text-xs">
                      <span className="font-medium text-[var(--foreground)] shrink-0">
                        {key}:
                      </span>
                      <span className="text-[var(--muted)] break-all">{value}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* Body */}
          <div className="flex-1 min-h-0">
            <div className="max-h-96 overflow-auto rounded-lg border border-[var(--border)] bg-[var(--background)] p-3 font-mono text-xs text-[var(--foreground)]">
              {isJson(result.body) ? (
                (() => {
                  try {
                    const parsed = JSON.parse(result.body);
                    return <JsonViewer data={parsed} initiallyExpanded className="max-h-none" />;
                  } catch {
                    return (
                      <pre className="whitespace-pre-wrap break-all leading-relaxed">
                        {result.body}
                      </pre>
                    );
                  }
                })()
              ) : (
                <pre className="whitespace-pre-wrap break-all leading-relaxed">
                  {result.body}
                </pre>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Play, Square, X, Trash2, ChevronDown, ChevronUp, Wifi } from 'lucide-react';

type SseEvent = {
  id?: string;
  name: string;
  data: string;
  timestamp: number;
};

type SseViewerProps = {
  url: string;
  headers?: Record<string, string>;
  onClose?: () => void;
};

type ConnectionStatus = 'idle' | 'connecting' | 'open' | 'closed' | 'error';

export function SseViewer({ url, headers, onClose }: SseViewerProps) {
  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [events, setEvents] = useState<SseEvent[]>([]);
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);
  const esRef = useRef<EventSource | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const shouldAutoScroll = useRef(true);

  const stopConnection = useCallback(() => {
    if (esRef.current) {
      esRef.current.close();
      esRef.current = null;
    }
    setStatus((prev) => {
      if (prev === 'open' || prev === 'connecting') return 'closed';
      return prev;
    });
  }, []);

  const startConnection = useCallback(() => {
    stopConnection();
    setEvents([]);
    setExpandedIndex(null);

    let finalUrl = url;
    if (headers && headers['X-API-Key']) {
      const sep = url.includes('?') ? '&' : '?';
      finalUrl = `${url}${sep}api_key=${encodeURIComponent(headers['X-API-Key'])}`;
    }

    setStatus('connecting');
    const es = new EventSource(finalUrl);
    esRef.current = es;

    es.onopen = () => {
      setStatus('open');
    };

    es.onmessage = (e: MessageEvent) => {
      setEvents((prev) => {
        const next = [
          ...prev,
          { id: e.lastEventId || undefined, name: e.type || 'message', data: e.data, timestamp: Date.now() },
        ];
        if (next.length > 200) return next.slice(next.length - 200);
        return next;
      });
    };

    es.onerror = () => {
      setStatus('error');
      es.close();
      esRef.current = null;
    };

    // Listen for named events
    const handleNamedEvent = (e: Event) => {
      const msg = e as MessageEvent;
      setEvents((prev) => {
        const next = [
          ...prev,
          { id: msg.lastEventId || undefined, name: msg.type, data: msg.data, timestamp: Date.now() },
        ];
        if (next.length > 200) return next.slice(next.length - 200);
        return next;
      });
    };

    // We can't know all event names ahead of time, but we can try to add a catch-all
    // EventSource doesn't support wildcard listeners, so default onmessage catches unnamed events.
    // Named events require explicit addEventListener per event name.
    // Store the handler reference so we can remove it if needed, but for a generic viewer
    // we'll leave it to the default unless we parse event names dynamically.
    // However, to be robust, we rely on onmessage for default and user can see event type if supported.
    // Some SSE servers send `event: foo` lines which won't fire onmessage unless we register `foo`.
    // We'll use a small workaround: monkey-patch dispatchEvent to intercept all MessageEvents.
    const originalDispatch = es.dispatchEvent.bind(es);
    const monkeyPatch = (event: Event): boolean => {
      if (event instanceof MessageEvent && event.type !== 'message' && event.type !== 'open' && event.type !== 'error') {
        handleNamedEvent(event);
      }
      return originalDispatch(event);
    };
    es.dispatchEvent = monkeyPatch;
  }, [url, headers, stopConnection]);

  useEffect(() => {
    return () => {
      stopConnection();
    };
  }, [stopConnection]);

  useEffect(() => {
    if (shouldAutoScroll.current && scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [events]);

  const handleScroll = () => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 30;
    shouldAutoScroll.current = nearBottom;
  };

  const clearEvents = () => {
    setEvents([]);
    setExpandedIndex(null);
  };

  const statusConfig: Record<ConnectionStatus, { label: string; color: string; bg: string }> = {
    idle: { label: 'Idle', color: 'text-[var(--muted)]', bg: 'bg-[var(--soft)]' },
    connecting: { label: 'Connecting', color: 'text-amber-600', bg: 'bg-amber-100' },
    open: { label: 'Connected', color: 'text-[var(--good)]', bg: 'bg-[var(--good)]/10' },
    closed: { label: 'Disconnected', color: 'text-[var(--bad)]', bg: 'bg-[var(--bad)]/10' },
    error: { label: 'Error', color: 'text-[var(--bad)]', bg: 'bg-[var(--bad)]/10' },
  };

  const isRunning = status === 'connecting' || status === 'open';

  return (
    <div className="flex flex-col h-full w-full bg-[var(--background)] text-[var(--foreground)] border border-[var(--border)] rounded-lg overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-[var(--border)] bg-[var(--panel)] shrink-0">
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2">
            <Wifi size={16} />
            <span className="text-sm font-medium">SSE Viewer</span>
          </div>
          <span className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium ${statusConfig[status].color} ${statusConfig[status].bg}`}>
            <span className={`w-1.5 h-1.5 rounded-full ${status === 'open' ? 'bg-[var(--good)]' : status === 'connecting' ? 'bg-amber-500' : status === 'idle' ? 'bg-[var(--muted)]' : 'bg-[var(--bad)]'}`} />
            {statusConfig[status].label}
          </span>
          <span className="text-xs text-[var(--muted)]">
            {events.length} event{events.length !== 1 ? 's' : ''}
          </span>
        </div>

        <div className="flex items-center gap-2">
          {!isRunning ? (
            <button
              onClick={startConnection}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--focus)] text-white hover:opacity-90 transition-opacity"
            >
              <Play size={14} />
              Start
            </button>
          ) : (
            <button
              onClick={stopConnection}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--bad)] text-white hover:opacity-90 transition-opacity"
            >
              <Square size={14} />
              Stop
            </button>
          )}
          <button
            onClick={clearEvents}
            disabled={events.length === 0}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-[var(--soft)] text-[var(--foreground)] hover:opacity-80 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Trash2 size={14} />
            Clear
          </button>
          {onClose && (
            <button
              onClick={() => {
                stopConnection();
                onClose();
              }}
              className="inline-flex items-center justify-center w-8 h-8 rounded-md text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--soft)] transition-colors"
            >
              <X size={16} />
            </button>
          )}
        </div>
      </div>

      {/* Header note */}
      <div className="px-4 py-2 text-xs text-[var(--muted)] bg-[var(--panel)]/50 border-b border-[var(--border)] shrink-0">
        Note: EventSource does not support custom headers. API keys are appended as query parameters automatically.
      </div>

      {/* Events list */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 space-y-2 min-h-0"
      >
        <AnimatePresence initial={false}>
          {events.map((evt, idx) => {
            const isExpanded = expandedIndex === idx;
            const preview = evt.data.split('\n')[0].slice(0, 120);
            return (
              <motion.div
                key={`${idx}-${evt.timestamp}`}
                initial={{ opacity: 0, y: 8, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                transition={{ duration: 0.2 }}
                className="rounded-lg border border-[var(--border)] bg-[var(--panel)] hover:border-[var(--focus)]/30 transition-colors cursor-pointer"
                onClick={() => setExpandedIndex(isExpanded ? null : idx)}
              >
                <div className="px-3 py-2.5 flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap">
                      {evt.name !== 'message' && (
                        <span className="inline-block px-1.5 py-0.5 rounded text-[10px] font-semibold uppercase tracking-wide bg-[var(--focus)]/10 text-[var(--focus)]">
                          {evt.name}
                        </span>
                      )}
                      {evt.id && (
                        <span className="text-[10px] text-[var(--muted)] font-mono">id: {evt.id}</span>
                      )}
                      <span className="text-[10px] text-[var(--muted)] ml-auto">
                        {new Date(evt.timestamp).toLocaleTimeString()}
                      </span>
                    </div>
                    <div className="mt-1 text-xs text-[var(--foreground)] font-mono truncate">
                      {preview}
                      {evt.data.length > 120 && !isExpanded ? '…' : ''}
                    </div>
                  </div>
                  <div className="shrink-0 mt-0.5 text-[var(--muted)]">
                    {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                  </div>
                </div>

                <AnimatePresence>
                  {isExpanded && (
                    <motion.div
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.2 }}
                      className="overflow-hidden"
                    >
                      <div className="px-3 pb-3">
                        <pre className="text-[11px] font-mono text-[var(--foreground)] bg-[var(--background)] rounded-md p-3 overflow-x-auto whitespace-pre-wrap break-all border border-[var(--border)]">
                          {evt.data}
                        </pre>
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>

        {events.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full py-12 text-[var(--muted)]">
            <Wifi size={32} className="mb-3 opacity-40" />
            <p className="text-sm">No events yet</p>
            <p className="text-xs mt-1">Click Start to connect to the SSE endpoint</p>
          </div>
        )}
      </div>
    </div>
  );
}

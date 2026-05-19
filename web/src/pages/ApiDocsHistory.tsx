import { useRef } from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronRight, Clock, History, Trash2, X } from 'lucide-react';
import type { HistoryEntry } from '../hooks/useRequestHistory';
import { useText } from '../locales';
import { dissolveContainer, dissolveElement } from '../lib/dissolve';

interface ApiDocsHistoryProps {
  showHistory: boolean;
  history: HistoryEntry[];
  setShowHistory: (value: boolean) => void;
  clearHistory: () => void;
  removeEntry: (id: string) => void;
  restoreHistoryEntry: (id: string) => void;
}

export function ApiDocsHistory({
  showHistory,
  history,
  setShowHistory,
  clearHistory,
  removeEntry,
  restoreHistoryEntry,
}: ApiDocsHistoryProps) {
  const text = useText();
  const historyListRef = useRef<HTMLDivElement>(null);

  return (
    <AnimatePresence>
      {showHistory && (
        <motion.div
          className="api-docs-history"
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          exit={{ opacity: 0, height: 0 }}
          transition={{ duration: 0.2 }}
        >
          <div className="api-docs-history-head">
            <span><History size={15} /> {text.apiDocs.requestHistory}</span>
            <div className="api-docs-history-actions">
              {history.length > 0 && (
                <button className="btn-icon" onClick={async () => {
                  if (historyListRef.current) {
                    await dissolveContainer(historyListRef.current, { duration: 400 });
                  }
                  clearHistory();
                }} title="Clear history">
                  <Trash2 size={14} />
                </button>
              )}
              <button className="btn-icon" onClick={() => setShowHistory(false)}>
                <X size={14} />
              </button>
            </div>
          </div>
          {history.length === 0 ? (
            <div className="api-docs-history-empty">{text.apiDocs.noHistory}</div>
          ) : (
            <div className="api-docs-history-list" ref={historyListRef}>
              {history.map((entry) => (
                <div key={entry.id} className="api-docs-history-item">
                  <button className="api-docs-history-restore" onClick={() => restoreHistoryEntry(entry.id)}>
                    <span className={`api-docs-history-status ${entry.status && entry.status >= 200 && entry.status < 300 ? 'ok' : entry.status ? 'bad' : ''}`}>
                      {entry.status || '-'}
                    </span>
                    <span className="api-docs-history-endpoint">{entry.endpointKey}</span>
                    <span className="api-docs-history-meta">
                      <Clock size={12} />
                      {entry.duration !== undefined ? `${entry.duration}ms` : '-'}
                    </span>
                    <ChevronRight size={14} className="api-docs-history-arrow" />
                  </button>
                  <button className="api-docs-history-delete" onClick={async (e) => {
                    const item = (e.currentTarget as HTMLElement).closest('.api-docs-history-item') as HTMLElement | null;
                    if (item) await dissolveElement(item, { duration: 400, blockSize: 4, direction: 'out' });
                    removeEntry(entry.id);
                  }} title="Remove">
                    <X size={12} />
                  </button>
                </div>
              ))}
            </div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}

import { useCallback, useEffect, useState } from "react";

export type HistoryEntry = {
  id: string;
  timestamp: number;
  endpointKey: string;
  apiBase: string;
  requestPath: string;
  queryString: string;
  requestBody: string;
  status?: number;
  statusText?: string;
  responsePreview?: string;
  duration?: number;
};

const STORAGE_KEY = "hlool_api_explorer_history";
const MAX_ENTRIES = 30;

function generateId(): string {
  return `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function optionalNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function sanitizeHistoryEntry(value: unknown): HistoryEntry | null {
  if (!value || typeof value !== "object") return null;
  const entry = value as Record<string, unknown>;
  const id = optionalString(entry.id);
  const endpointKey = optionalString(entry.endpointKey);
  const apiBase = optionalString(entry.apiBase);
  const requestPath = optionalString(entry.requestPath);
  const queryString = optionalString(entry.queryString);
  const requestBody = optionalString(entry.requestBody);
  if (!id || !endpointKey || apiBase === undefined || requestPath === undefined || queryString === undefined || requestBody === undefined) {
    return null;
  }
  return {
    id,
    timestamp: optionalNumber(entry.timestamp) ?? Date.now(),
    endpointKey,
    apiBase,
    requestPath,
    queryString,
    requestBody,
    status: optionalNumber(entry.status),
    statusText: optionalString(entry.statusText),
    responsePreview: optionalString(entry.responsePreview),
    duration: optionalNumber(entry.duration),
  };
}

function sanitizeHistory(entries: unknown[]): HistoryEntry[] {
  return entries
    .map(sanitizeHistoryEntry)
    .filter((entry): entry is HistoryEntry => Boolean(entry));
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      localStorage.removeItem(STORAGE_KEY);
      return [];
    }
    return sanitizeHistory(parsed);
  } catch {
    localStorage.removeItem(STORAGE_KEY);
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]): boolean {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(sanitizeHistory(entries)));
    return true;
  } catch {
    return false;
  }
}

export function useRequestHistory() {
  const [history, setHistory] = useState<HistoryEntry[]>(loadHistory);
  const [storageError, setStorageError] = useState(false);

  useEffect(() => {
    setHistory(loadHistory());
  }, []);

  useEffect(() => {
    const ok = saveHistory(history);
    if (!ok) {
      setStorageError(true);
    } else {
      setStorageError(false);
    }
  }, [history]);

  const addEntry = useCallback(
    (entry: Omit<HistoryEntry, "id" | "timestamp">) => {
      const newEntry: HistoryEntry = {
        ...entry,
        id: generateId(),
        timestamp: Date.now(),
      };
      setHistory((prev) => {
        const updated = [newEntry, ...prev];
        if (updated.length > MAX_ENTRIES) {
          return updated.slice(0, MAX_ENTRIES);
        }
        return updated;
      });
    },
    []
  );

  const removeEntry = useCallback((id: string) => {
    setHistory((prev) => prev.filter((e) => e.id !== id));
  }, []);

  const clearHistory = useCallback(() => {
    setHistory([]);
  }, []);

  const restoreEntry = useCallback(
    (id: string): HistoryEntry | undefined => {
      return history.find((e) => e.id === id);
    },
    [history]
  );

  return {
    history,
    addEntry,
    removeEntry,
    clearHistory,
    restoreEntry,
    storageError,
  };
}

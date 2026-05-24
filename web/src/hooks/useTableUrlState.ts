import { useCallback, useEffect, useMemo, useState } from 'react';

type HistoryMode = 'push' | 'replace';
type HashSearchSetter = (params: URLSearchParams) => void;
type TableFilterValues = Record<string, string>;
type Updater<T> = T | ((current: T) => T);

const HASH_SEARCH_CHANGE_EVENT = 'hlool:hash-search-change';

export type UseTableUrlStateOptions<TFilters extends TableFilterValues = Record<string, never>> = {
  defaultPage?: number;
  defaultPageSize?: number;
  defaultSearch?: string;
  defaultFilters?: TFilters;
  pageParam?: string;
  pageSizeParam?: string;
  searchParam?: string;
  filterParams?: Partial<Record<keyof TFilters, string>>;
  filterOptions?: Partial<{ [K in keyof TFilters]: readonly TFilters[K][] }>;
  pageSizeOptions?: readonly number[];
  historyMode?: HistoryMode;
};

export type UseTableUrlStateResult<TFilters extends TableFilterValues> = {
  page: number;
  setPage: (page: Updater<number>, mode?: HistoryMode) => void;
  pageSize: number;
  setPageSize: (pageSize: Updater<number>, mode?: HistoryMode) => void;
  search: string;
  setSearch: (search: Updater<string>, mode?: HistoryMode) => void;
  filters: TFilters;
  setFilters: (filters: Updater<TFilters>, mode?: HistoryMode) => void;
  setFilter: <K extends keyof TFilters>(key: K, value: Updater<TFilters[K]>, mode?: HistoryMode) => void;
};

export function useHashSearchState() {
  const [snapshot, setSnapshot] = useState(() => currentHashSearch());

  useEffect(() => {
    const sync = () => setSnapshot(currentHashSearch());
    window.addEventListener('hashchange', sync);
    window.addEventListener('popstate', sync);
    window.addEventListener(HASH_SEARCH_CHANGE_EVENT, sync);
    return () => {
      window.removeEventListener('hashchange', sync);
      window.removeEventListener('popstate', sync);
      window.removeEventListener(HASH_SEARCH_CHANGE_EVENT, sync);
    };
  }, []);

  const params = useMemo(() => new URLSearchParams(snapshot), [snapshot]);
  const setParams = useCallback((setter: HashSearchSetter, mode: HistoryMode = 'push') => {
    const hash = readHashParts();
    const nextParams = new URLSearchParams(hash.search);
    setter(nextParams);
    writeHashSearch(nextParams, mode);
    setSnapshot(nextParams.toString());
  }, []);

  return { params, setParams };
}

export function useTableUrlState<TFilters extends TableFilterValues = Record<string, never>>(
  options: UseTableUrlStateOptions<TFilters> = {}
): UseTableUrlStateResult<TFilters> {
  const defaultPage = options.defaultPage ?? 1;
  const defaultPageSize = options.defaultPageSize ?? 10;
  const defaultSearch = options.defaultSearch ?? '';
  const defaultFilters = options.defaultFilters ?? ({} as TFilters);
  const pageParam = options.pageParam ?? 'page';
  const pageSizeParam = options.pageSizeParam ?? 'pageSize';
  const searchParam = options.searchParam ?? 'search';
  const filterParams: Partial<Record<keyof TFilters, string>> = options.filterParams ?? {};
  const filterOptions: Partial<{ [K in keyof TFilters]: readonly TFilters[K][] }> = options.filterOptions ?? {};
  const pageSizeOptions = options.pageSizeOptions;
  const historyMode = options.historyMode ?? 'push';
  const { params, setParams } = useHashSearchState();

  const state = useMemo(() => {
    const page = normalizePositiveInteger(params.get(pageParam), defaultPage);
    const pageSize = normalizePageSize(params.get(pageSizeParam), defaultPageSize, pageSizeOptions);
    const search = params.get(searchParam) ?? defaultSearch;
    const filters = Object.keys(defaultFilters).reduce<TFilters>((result, filterKey) => {
      const key = filterKey as keyof TFilters;
      const param = filterParams[key] || filterKey;
      const raw = params.get(param);
      const defaultValue = defaultFilters[key];
      const allowedValues = filterOptions[key];
      const value = raw === null ? defaultValue : (raw as TFilters[typeof key]);
      result[key] = allowedValues?.includes(value) ? value : defaultValue;
      return result;
    }, { ...defaultFilters });

    return {
      page,
      pageSize,
      search,
      filters
    };
  }, [
    defaultFilters,
    defaultPage,
    defaultPageSize,
    defaultSearch,
    filterOptions,
    filterParams,
    pageParam,
    pageSizeOptions,
    pageSizeParam,
    params,
    searchParam
  ]);

  const writeState = useCallback((
    nextState: typeof state,
    mode: HistoryMode = historyMode
  ) => {
    setParams((nextParams) => {
      setOptionalParam(nextParams, pageParam, String(nextState.page), String(defaultPage));
      setOptionalParam(nextParams, pageSizeParam, String(nextState.pageSize), String(defaultPageSize));
      setOptionalParam(nextParams, searchParam, nextState.search, defaultSearch);

      for (const filterKey of Object.keys(defaultFilters)) {
        const key = filterKey as keyof TFilters;
        const param = filterParams[key] || filterKey;
        setOptionalParam(nextParams, param, nextState.filters[key], defaultFilters[key]);
      }
    }, mode);
  }, [
    defaultFilters,
    defaultPage,
    defaultPageSize,
    defaultSearch,
    filterParams,
    historyMode,
    pageParam,
    pageSizeParam,
    searchParam,
    setParams
  ]);

  const setPage = useCallback((page: Updater<number>, mode?: HistoryMode) => {
    const nextPage = normalizePositiveInteger(resolveUpdater(page, state.page), defaultPage);
    writeState({ ...state, page: nextPage }, mode);
  }, [defaultPage, state, writeState]);

  const setPageSize = useCallback((pageSize: Updater<number>, mode?: HistoryMode) => {
    const nextPageSize = normalizePageSize(resolveUpdater(pageSize, state.pageSize), defaultPageSize, pageSizeOptions);
    writeState({ ...state, page: defaultPage, pageSize: nextPageSize }, mode);
  }, [defaultPage, defaultPageSize, pageSizeOptions, state, writeState]);

  const setSearch = useCallback((search: Updater<string>, mode?: HistoryMode) => {
    const nextSearch = resolveUpdater(search, state.search);
    writeState({ ...state, page: defaultPage, search: nextSearch }, mode);
  }, [defaultPage, state, writeState]);

  const setFilters = useCallback((filters: Updater<TFilters>, mode?: HistoryMode) => {
    const nextFilters = resolveUpdater(filters, state.filters);
    writeState({ ...state, page: defaultPage, filters: nextFilters }, mode);
  }, [defaultPage, state, writeState]);

  const setFilter = useCallback(<K extends keyof TFilters>(key: K, value: Updater<TFilters[K]>, mode?: HistoryMode) => {
    const nextValue = resolveUpdater(value, state.filters[key]);
    writeState({
      ...state,
      page: defaultPage,
      filters: {
        ...state.filters,
        [key]: nextValue
      }
    }, mode);
  }, [defaultPage, state, writeState]);

  return {
    page: state.page,
    setPage,
    pageSize: state.pageSize,
    setPageSize,
    search: state.search,
    setSearch,
    filters: state.filters,
    setFilters,
    setFilter
  };
}

function currentHashSearch() {
  if (typeof window === 'undefined') return '';
  return readHashParts().search;
}

function readHashParts() {
  const rawHash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  const queryIndex = rawHash.indexOf('?');
  const path = queryIndex >= 0 ? rawHash.slice(0, queryIndex) : rawHash;
  const search = queryIndex >= 0 ? rawHash.slice(queryIndex + 1) : '';
  return {
    path: path || '/',
    search
  };
}

function writeHashSearch(params: URLSearchParams, mode: HistoryMode) {
  if (typeof window === 'undefined') return;
  const { path } = readHashParts();
  const search = params.toString();
  const nextHash = `${path || '/'}${search ? `?${search}` : ''}`;
  const nextUrl = `${window.location.pathname}${window.location.search}#${nextHash}`;
  const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  if (nextUrl === currentUrl) return;

  if (mode === 'replace') {
    window.history.replaceState(window.history.state, document.title, nextUrl);
  } else {
    window.history.pushState(window.history.state, document.title, nextUrl);
  }
  window.dispatchEvent(new Event(HASH_SEARCH_CHANGE_EVENT));
}

function setOptionalParam(params: URLSearchParams, key: string, value: string, defaultValue: string) {
  const normalized = value.trim();
  if (!normalized || normalized === defaultValue) {
    params.delete(key);
    return;
  }
  params.set(key, normalized);
}

function normalizePositiveInteger(value: string | number | null | undefined, fallback: number) {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : fallback;
}

function normalizePageSize(value: string | number | null | undefined, fallback: number, options?: readonly number[]) {
  const parsed = normalizePositiveInteger(value, fallback);
  if (!options?.length) return parsed;
  return options.includes(parsed) ? parsed : fallback;
}

function resolveUpdater<T>(updater: Updater<T>, current: T) {
  return typeof updater === 'function' ? (updater as (current: T) => T)(current) : updater;
}

import { useState, useCallback, useMemo } from 'react';
import type { DataTableSortState } from '../components/shared/DataTable';

export interface DataTableStateOptions {
  defaultPage?: number;
  defaultPageSize?: number;
  defaultSortBy?: string | null;
  defaultSortOrder?: 'asc' | 'desc';
}

export interface DataTableStateReturn {
  pagination: {
    page: number;
    pageSize: number;
    setPage: (page: number) => void;
    setPageSize: (size: number) => void;
  };
  search: {
    value: string;
    setValue: (value: string) => void;
    resetToFirstPage: () => void;
  };
  sort: {
    by: string | null;
    order: 'asc' | 'desc';
    state: DataTableSortState | null;
    setSortBy: (by: string | null) => void;
    setSortOrder: (order: 'asc' | 'desc') => void;
    handleSortChange: (sortState: DataTableSortState) => void;
  };
  reset: () => void;
}

/**
 * Unified hook for managing data table state (pagination, search, sorting).
 *
 * @example
 * const tableState = useDataTableState({ defaultPageSize: 25 });
 *
 * const query = useQuery({
 *   queryKey: ['data', tableState.pagination.page, tableState.search.value],
 *   queryFn: () => fetchData({
 *     page: tableState.pagination.page,
 *     search: tableState.search.value,
 *     sortBy: tableState.sort.by,
 *     sortOrder: tableState.sort.order,
 *   }),
 * });
 *
 * <DataTable
 *   sortState={tableState.sort.state}
 *   onSortChange={tableState.sort.handleSortChange}
 * />
 */
export function useDataTableState(options: DataTableStateOptions = {}): DataTableStateReturn {
  const {
    defaultPage = 1,
    defaultPageSize = 25,
    defaultSortBy = null,
    defaultSortOrder = 'desc',
  } = options;

  const [page, setPage] = useState(defaultPage);
  const [pageSize, setPageSize] = useState(defaultPageSize);
  const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<string | null>(defaultSortBy);
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>(defaultSortOrder);

  // Reset to first page when search changes
  const resetToFirstPage = useCallback(() => {
    setPage(1);
  }, []);

  // Handle DataTable sort change
  const handleSortChange = useCallback((sortState: DataTableSortState) => {
    setSortBy(sortState.key);
    setSortOrder(sortState.direction);
    setPage(1); // Reset to first page on sort change
  }, []);

  // Reset all state
  const reset = useCallback(() => {
    setPage(defaultPage);
    setPageSize(defaultPageSize);
    setSearch('');
    setSortBy(defaultSortBy);
    setSortOrder(defaultSortOrder);
  }, [defaultPage, defaultPageSize, defaultSortBy, defaultSortOrder]);

  // Memoized sort state for DataTable
  const sortState = useMemo<DataTableSortState | null>(
    () => (sortBy ? { key: sortBy, direction: sortOrder } : null),
    [sortBy, sortOrder]
  );

  return {
    pagination: {
      page,
      pageSize,
      setPage,
      setPageSize,
    },
    search: {
      value: search,
      setValue: setSearch,
      resetToFirstPage,
    },
    sort: {
      by: sortBy,
      order: sortOrder,
      state: sortState,
      setSortBy,
      setSortOrder,
      handleSortChange,
    },
    reset,
  };
}

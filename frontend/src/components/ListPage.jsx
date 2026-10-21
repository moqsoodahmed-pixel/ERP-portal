import React from 'react';
import { useList } from '../hooks/useList.js';
import {
  Card,
  PageHeader,
  PageToolbar,
  SearchBox,
  Select,
  EmptyState,
  ErrorState,
  LoadingState,
} from '../design-system/index.js';
import DataTable from './DataTable.jsx';

/**
 * Generic server-paginated enterprise list view consuming LDS v1.0.
 */
export default function ListPage({
  title,
  subtitle,
  path,
  columns,
  statuses = [],
  emptyTitle,
  emptyHint,
  searchPlaceholder = 'Search…',
  actions,
  renderRowActions,
  limit,
}) {
  const list = useList(path, limit ? { limit } : undefined);
  const allColumns = renderRowActions
    ? [...columns, { key: '_actions', header: 'Actions', render: (row) => renderRowActions(row, { reload: list.reload }) }]
    : columns;

  const statusOptions = statuses.map((s) => ({
    value: s,
    label: s.replaceAll('_', ' '),
  }));

  return (
    <>
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      <Card>
        <PageToolbar
          search={(
            <label className="field field--inline" style={{ width: '100%' }}>
              <span className="sr-only">Search</span>
              <SearchBox
                placeholder={searchPlaceholder}
                defaultValue={list.params.search}
                onChange={(e) => list.setSearch(e.target.value)}
              />
            </label>
          )}
          filters={statuses.length > 0 && (
            <label className="field field--inline">
              <span className="sr-only">Filter by status</span>
              <Select
                value={list.params.status}
                onChange={(e) => list.setStatus(e.target.value)}
                placeholder="All statuses"
                options={statusOptions}
              />
            </label>
          )}
        />
        {list.status === 'loading' && list.items.length === 0 && <LoadingState />}
        {list.status === 'error' && <ErrorState error={list.error} onRetry={list.reload} />}
        {list.status === 'ready' && list.items.length === 0 && <EmptyState title={emptyTitle} hint={emptyHint} />}
        {list.items.length > 0 && (
          <DataTable
            caption={title}
            columns={allColumns}
            rows={list.items}
            pagination={list.pagination}
            onPage={list.setPage}
          />
        )}
      </Card>
    </>
  );
}

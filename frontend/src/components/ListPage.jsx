import { useList } from '../hooks/useList.js';
import PageHeader from './PageHeader.jsx';
import DataTable from './DataTable.jsx';
import { EmptyState, ErrorState, LoadingState } from './states.jsx';

/** Generic server-paginated list view: search, status filter, loading / empty / error states. */
export default function ListPage({
  title, subtitle, path, columns, statuses = [], emptyTitle, emptyHint, searchPlaceholder = 'Search…', actions, renderRowActions, limit,
}) {
  const list = useList(path, limit ? { limit } : undefined);
  const allColumns = renderRowActions
    ? [...columns, { key: '_actions', header: 'Actions', render: (row) => renderRowActions(row, { reload: list.reload }) }]
    : columns;
  return (
    <>
      <PageHeader title={title} subtitle={subtitle} actions={actions} />
      <section className="card">
        <div className="toolbar">
          <label className="field field--inline">
            <span className="sr-only">Search</span>
            <input type="search" placeholder={searchPlaceholder} defaultValue={list.params.search} onChange={(e) => list.setSearch(e.target.value)} />
          </label>
          {statuses.length > 0 && (
            <label className="field field--inline">
              <span className="sr-only">Filter by status</span>
              <select value={list.params.status} onChange={(e) => list.setStatus(e.target.value)}>
                <option value="">All statuses</option>
                {statuses.map((s) => <option key={s} value={s}>{s.replaceAll('_', ' ')}</option>)}
              </select>
            </label>
          )}
        </div>
        {list.status === 'loading' && list.items.length === 0 && <LoadingState />}
        {list.status === 'error' && <ErrorState error={list.error} onRetry={list.reload} />}
        {list.status === 'ready' && list.items.length === 0 && <EmptyState title={emptyTitle} hint={emptyHint} />}
        {list.items.length > 0 && <DataTable caption={title} columns={allColumns} rows={list.items} pagination={list.pagination} onPage={list.setPage} />}
      </section>
    </>
  );
}

import React from 'react';
import { EmptyState, LoadingState } from './States.jsx';

/**
 * LDS v1.0 Table Component
 * Accessible data table with sticky header support and responsive scrolling.
 */
export function Table({
  children,
  caption,
  stickyHeader = false,
  className = '',
  ...props
}) {
  return (
    <div className={`table-wrap ${stickyHeader ? 'table-wrap--sticky' : ''}`}>
      <table className={`table ${className}`.trim()} {...props}>
        {caption && <caption className="sr-only">{caption}</caption>}
        {children}
      </table>
    </div>
  );
}

export function TableHead({ children, className = '', ...props }) {
  return <thead className={className} {...props}>{children}</thead>;
}

export function TableRow({ children, className = '', hover = true, ...props }) {
  return <tr className={`${hover ? 'table-row--hover' : ''} ${className}`.trim()} {...props}>{children}</tr>;
}

export function TableHeaderCell({ children, numeric = false, className = '', ...props }) {
  return (
    <th
      scope="col"
      className={`${numeric ? 'num' : ''} ${className}`.trim()}
      {...props}
    >
      {children}
    </th>
  );
}

export function TableCell({ children, numeric = false, mono = false, className = '', ...props }) {
  const classes = [
    numeric ? 'num' : '',
    mono ? 'mono' : '',
    className,
  ].filter(Boolean).join(' ');

  return (
    <td className={classes || undefined} {...props}>
      {children}
    </td>
  );
}

/**
 * LDS v1.0 Pagination Component
 */
export function Pagination({
  page = 1,
  totalPages = 1,
  total = 0,
  onPage,
  disabled = false,
  className = '',
}) {
  if (!onPage || totalPages <= 1 && total === 0) return null;

  return (
    <nav className={`pager ${className}`.trim()} aria-label="Pagination">
      <span className="muted">
        Page {page} of {totalPages} · {total} total
      </span>
      <div>
        <button
          type="button"
          className="btn"
          disabled={disabled || page <= 1}
          onClick={() => onPage(page - 1)}
        >
          Previous
        </button>
        <button
          type="button"
          className="btn"
          disabled={disabled || page >= totalPages}
          onClick={() => onPage(page + 1)}
        >
          Next
        </button>
      </div>
    </nav>
  );
}

/**
 * LDS v1.0 DataGrid Component
 * Fully managed enterprise grid taking columns, rows, pagination, and empty/loading states.
 */
export function DataGrid({
  caption,
  columns = [],
  rows = [],
  pagination,
  onPage,
  loading = false,
  emptyTitle = 'No data available',
  emptyHint = 'No records match the current criteria.',
  className = '',
}) {
  if (loading && rows.length === 0) {
    return <LoadingState label="Loading data…" />;
  }

  if (!loading && rows.length === 0) {
    return <EmptyState title={emptyTitle} hint={emptyHint} />;
  }

  return (
    <div className={`lds-data-grid ${className}`.trim()}>
      <Table caption={caption}>
        <TableHead>
          <TableRow hover={false}>
            {columns.map((c) => (
              <TableHeaderCell key={c.key} numeric={c.numeric}>
                {c.header}
              </TableHeaderCell>
            ))}
          </TableRow>
        </TableHead>
        <tbody>
          {rows.map((row, idx) => {
            const key = row._id ?? row.id ?? idx;
            return (
              <TableRow key={key}>
                {columns.map((c) => (
                  <TableCell
                    key={c.key}
                    numeric={c.numeric}
                    mono={c.mono}
                  >
                    {c.render ? c.render(row) : (row[c.key] ?? '—')}
                  </TableCell>
                ))}
              </TableRow>
            );
          })}
        </tbody>
      </Table>
      {pagination && onPage && (
        <Pagination
          page={pagination.page}
          totalPages={pagination.totalPages}
          total={pagination.total}
          onPage={onPage}
        />
      )}
    </div>
  );
}

export default {
  Table,
  TableHead,
  TableRow,
  TableHeaderCell,
  TableCell,
  Pagination,
  DataGrid,
};

import React from 'react';
import {
  Table,
  TableHead,
  TableRow,
  TableHeaderCell,
  TableCell,
  Pagination,
} from '../design-system/index.js';

/**
 * Shared DataTable component consuming LauncherDesk Design System (LDS v1.0).
 */
export default function DataTable({ caption, columns, rows, pagination, onPage }) {
  return (
    <div>
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
          {rows.map((row) => {
            const key = row._id ?? row.id;
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
      {pagination && (
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

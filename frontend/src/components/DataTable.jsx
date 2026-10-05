export default function DataTable({ caption, columns, rows, pagination, onPage }) {
  return (
    <div>
      <div className="table-wrap">
        <table className="table">
          <caption className="sr-only">{caption}</caption>
          <thead>
            <tr>{columns.map((c) => <th key={c.key} scope="col" className={c.numeric ? 'num' : undefined}>{c.header}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row._id ?? row.id}>
                {columns.map((c) => <td key={c.key} className={c.numeric ? 'num' : c.mono ? 'mono' : undefined}>{c.render ? c.render(row) : row[c.key] ?? '—'}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {pagination && (
        <nav className="pager" aria-label="Pagination">
          <span className="muted">Page {pagination.page} of {pagination.totalPages} · {pagination.total} total</span>
          <div>
            <button type="button" className="btn" disabled={pagination.page <= 1} onClick={() => onPage(pagination.page - 1)}>Previous</button>
            <button type="button" className="btn" disabled={pagination.page >= pagination.totalPages} onClick={() => onPage(pagination.page + 1)}>Next</button>
          </div>
        </nav>
      )}
    </div>
  );
}

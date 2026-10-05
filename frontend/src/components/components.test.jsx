import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import StatusBadge from './StatusBadge.jsx';
import DataTable from './DataTable.jsx';
import ConfirmDialog from './ConfirmDialog.jsx';
import { EmptyState, ErrorState } from './states.jsx';
import { formatMoney } from '../utils/format.js';

describe('shared components', () => {
  it('status badge shows readable text, not just colour', () => {
    render(<StatusBadge status="READY_FOR_FILING" />);
    expect(screen.getByText('Ready for filing')).toBeInTheDocument();
  });

  it('data table paginates through callbacks', async () => {
    const onPage = vi.fn();
    render(<DataTable caption="Things" columns={[{ key: 'name', header: 'Name' }]} rows={[{ _id: '1', name: 'Alpha' }]} pagination={{ page: 1, totalPages: 3, total: 25 }} onPage={onPage} />);
    expect(screen.getByRole('table', { name: 'Things' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPage).toHaveBeenCalledWith(2);
  });

  it('confirm dialog is accessible and cancellable with Escape', async () => {
    const onCancel = vi.fn();
    render(<ConfirmDialog open title="Archive product?" message="This keeps invoice history." confirmLabel="Archive" onConfirm={vi.fn()} onCancel={onCancel} />);
    expect(screen.getByRole('alertdialog', { name: 'Archive product?' })).toBeInTheDocument();
    await userEvent.keyboard('{Escape}');
    expect(onCancel).toHaveBeenCalled();
  });

  it('error and empty states render guidance', () => {
    render(<><ErrorState error={{ status: 500, message: 'Boom' }} onRetry={() => {}} /><EmptyState title="Nothing here" hint="Add something" /></>);
    expect(screen.getByRole('alert')).toHaveTextContent('Boom');
    expect(screen.getByText('Nothing here')).toBeInTheDocument();
  });

  it('formats money from exact decimal strings for display only', () => {
    expect(formatMoney('1234.50')).toContain('1,234.50');
    expect(formatMoney(undefined)).toBe('—');
  });
});

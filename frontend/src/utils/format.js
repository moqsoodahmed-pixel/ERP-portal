/** Display-only formatting. Money arrives from the API as exact decimal strings; no arithmetic is done in the browser. */
const inr = new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', minimumFractionDigits: 2 });
export const formatMoney = (value) => (value === undefined || value === null || value === '' ? '—' : inr.format(Number(value)));
export const formatDate = (value) => (value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—');
export const formatDateTime = (value) => (value ? new Date(value).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' }) : '—');

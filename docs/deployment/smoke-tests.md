# Production smoke-test checklist

Manual checklist to run against a freshly deployed environment (EC2 or Render) before considering a
deploy complete, and after any restore ([backup-restore.md](./backup-restore.md)). See
`backend/tests/api/smoke.test.js` for the automated subset that runs in CI against a test database — this
checklist additionally covers things that need a real browser/real Tally-like config and so aren't fully
automatable against a disposable test DB.

## Health
- [ ] `GET /health` → `200`
- [ ] `GET /ready` → `200`
- [ ] `GET /version` → expected version string

## Auth
- [ ] Log in with a valid account
- [ ] Refresh token flow keeps the session alive past access-token expiry
- [ ] Logout invalidates the session (refreshing after logout fails)

## Master Admin
- [ ] Platform dashboard loads
- [ ] Client list loads; can view a client's detail

## Client (Admin/User)
- [ ] Dashboard loads
- [ ] Business profile loads/saves
- [ ] Product list loads; can create a product
- [ ] Customer list loads; can create a customer
- [ ] Create a draft invoice
- [ ] Issue the invoice (draft → issued transition)
- [ ] Download/view the invoice PDF

## Tally
- [ ] Tally configuration screen loads (no plaintext credential ever shown)
- [ ] Sync status for a prior sync attempt displays correctly

## GST
- [ ] Filing list loads
- [ ] Filing issue list loads

## Vendor (GST_VENDOR)
- [ ] Can see only assigned client(s)
- [ ] Can view (not modify) filings for the assigned client
- [ ] Invoice access is read-only (no issue/cancel controls visible, and the underlying API rejects a
      direct write attempt)

## Reports
- [ ] Dashboard aggregates render
- [ ] Report filters apply correctly
- [ ] CSV export downloads and opens without a spreadsheet "external data"/formula warning

## Notifications
- [ ] Unread count badge is correct
- [ ] Marking a notification read updates the badge

## Security (spot-check, full coverage is in the automated regression suite)
- [ ] Accessing a protected route while logged out → `401`
- [ ] Accessing another tenant's resource by guessing/editing an ID in the URL → `403`/`404` per
      existing convention, never the other tenant's data

import { Link } from 'react-router-dom';

export default function ForbiddenPage() {
  return (
    <main className="center-page">
      <p className="code">403</p>
      <h1>Access restricted</h1>
      <p className="muted">Your account does not have permission to view this area. Contact your administrator if you need access.</p>
      <Link className="btn btn--primary" to="/">Back to your workspace</Link>
    </main>
  );
}

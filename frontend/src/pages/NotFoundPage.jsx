import { Link } from 'react-router-dom';

export default function NotFoundPage() {
  return (
    <main className="center-page">
      <p className="code">404</p>
      <h1>Page not found</h1>
      <p className="muted">The page you are looking for does not exist or has moved.</p>
      <Link className="btn btn--primary" to="/">Go to your workspace</Link>
    </main>
  );
}

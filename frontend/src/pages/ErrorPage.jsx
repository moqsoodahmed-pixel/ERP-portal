export default function ErrorPage() {
  return (
    <main className="center-page">
      <h1>Something went wrong</h1>
      <p className="muted">An unexpected error occurred. Your data has not been changed.</p>
      <button type="button" className="btn btn--primary" onClick={() => window.location.assign('/')}>Return to start</button>
    </main>
  );
}

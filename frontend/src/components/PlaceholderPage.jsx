import PageHeader from './PageHeader.jsx';

/** Honest placeholder: states plainly that the module is not built yet and when it is planned. */
export default function PlaceholderPage({ title, phase, description }) {
  return (
    <>
      <PageHeader title={title} />
      <section className="card placeholder">
        <p className="badge badge--neutral">Not implemented</p>
        <p>{description}</p>
        <p className="muted">Planned for {phase}. The navigation, routing and permission checks for this area are already in place.</p>
      </section>
    </>
  );
}

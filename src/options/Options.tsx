/**
 * Options placeholder ("Research Ledger" direction, see docs/design.md).
 *
 * Scaffold only: no list/search/filter/delete/re-analyze UX yet. The real
 * library management UI arrives in later issues.
 */
export function Options() {
  return (
    <main
      style={{
        maxWidth: 720,
        margin: '0 auto',
        padding: '32px 24px',
        fontFamily: 'ui-serif, Georgia, "Times New Roman", serif',
        color: '#3a342b',
        background: '#faf6ee',
        minHeight: '100vh',
      }}
    >
      <h1 style={{ fontSize: 22, margin: '0 0 6px' }}>Bookmark AI — Library</h1>
      <p style={{ fontSize: 14, margin: 0, color: '#6b6253' }}>
        Scaffold placeholder. The Research Ledger (list, search, filter,
        re-analyze) is not implemented yet.
      </p>
    </main>
  )
}

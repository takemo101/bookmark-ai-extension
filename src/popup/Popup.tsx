/**
 * Popup placeholder ("Bookmark Receipt" direction, see docs/design.md).
 *
 * Scaffold only: no Save flow, extraction, AI, or Drive wiring yet. The real
 * save-current-tab orchestration arrives in later issues.
 */
export function Popup() {
  return (
    <main
      style={{
        width: 320,
        padding: '16px 18px',
        fontFamily:
          'ui-serif, Georgia, "Times New Roman", serif',
        color: '#3a342b',
        background: '#faf6ee',
      }}
    >
      <h1 style={{ fontSize: 16, margin: '0 0 4px' }}>Bookmark AI</h1>
      <p style={{ fontSize: 13, margin: 0, color: '#6b6253' }}>
        Scaffold placeholder. Save &amp; Analyze is not wired up yet.
      </p>
    </main>
  )
}

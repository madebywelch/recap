/**
 * The readable refusal for the engine handshake
 * (docs/desktop-app-spec.md §Engine contract): when the bundled engine's
 * envelope is newer than the app understands — or fails contract
 * validation at all — the app says so and renders nothing, rather than
 * silently fall back to fixture data and pretend everything is fine.
 */
export default function EngineRefusal({ message: _message }: { message: string }) {
  return (
    <div className="refusal-shell">
      <div className="titlebar" data-tauri-drag-region />
      <div className="folio-scroll">
        <div className="sheet">
          <div className="kicker">Recap couldn&rsquo;t start</div>
          <h1 className="display">Something isn&rsquo;t working.</h1>
          <p className="dek">Recap couldn&rsquo;t verify the information it needs to open.</p>
          <p className="quiet-note">
            To avoid showing information that may be incorrect, Recap has stopped.
            Try reinstalling the app.
          </p>
        </div>
      </div>
    </div>
  );
}

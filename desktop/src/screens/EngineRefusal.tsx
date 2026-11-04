import { SUPPORTED_ENGINE_MAJOR } from "../fixtures";

/**
 * The readable refusal for the engine handshake
 * (docs/desktop-app-spec.md §Engine contract): when the bundled engine's
 * envelope is newer than the app understands — or fails contract
 * validation at all — the app says so and renders nothing, rather than
 * silently fall back to fixture data and pretend everything is fine.
 */
export default function EngineRefusal({ message }: { message: string }) {
  return (
    <div className="refusal-shell">
      <div className="titlebar" data-tauri-drag-region />
      <div className="folio-scroll">
        <div className="sheet">
          <div className="kicker">Engine contract</div>
          <h1 className="display">This app can&rsquo;t trust its engine.</h1>
          <p className="dek">{message}</p>
          <p className="quiet-note">
            The engine ships bundled with the app and the two version together, so a
            failed handshake means the engine beside this app isn&rsquo;t the one it was
            built with — a mixed install, or a sidecar swapped by hand. Rather than show
            you data it can&rsquo;t validate, the app stops here. Reinstall recap; this
            build understands engine contract major {SUPPORTED_ENGINE_MAJOR}.
          </p>
        </div>
      </div>
    </div>
  );
}

import { useEffect, useState } from "react";
import { type Capabilities, commands } from "./bindings";

export function App() {
  const [capabilities, setCapabilities] = useState<Capabilities | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    commands.probeCapabilities().then((result) => {
      if (result.status === "ok") setCapabilities(result.data);
      else setError(result.error.message);
    });
  }, []);

  return (
    <main style={{ padding: "2rem" }}>
      <h1>skills-hub</h1>
      {error && <p style={{ color: "var(--text-error)" }}>{error}</p>}
      {capabilities && (
        <dl>
          <dt>home</dt>
          <dd>{capabilities.home}</dd>
          <dt>platform</dt>
          <dd>{capabilities.platform}</dd>
          <dt>symlinks</dt>
          <dd>{capabilities.symlinksSupported ? "supported" : "unavailable"}</dd>
          <dt>version</dt>
          <dd>{capabilities.appVersion}</dd>
        </dl>
      )}
    </main>
  );
}

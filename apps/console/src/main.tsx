import { StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import type { Health } from "@quai/api"
import { fetchHealth } from "./client.ts"

function App() {
  const [health, setHealth] = useState<Health | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchHealth().then(setHealth, (e: unknown) => setError(String(e)))
  }, [])

  return (
    <main style={{ fontFamily: "system-ui", padding: 24 }}>
      <h1>Quai</h1>
      {health && <p>Server {health.version} · up for {health.uptimeSeconds} s</p>}
      {error && <p role="alert">Server unreachable: {error}</p>}
      {!health && !error && <p>Connecting to the server…</p>}
    </main>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

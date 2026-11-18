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
      {health && <p>Serveur {health.version} · en route depuis {health.uptimeSeconds} s</p>}
      {error && <p role="alert">Serveur injoignable : {error}</p>}
      {!health && !error && <p>Connexion au serveur…</p>}
    </main>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

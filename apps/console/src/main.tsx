import type { Health } from "@quai/api"
import { StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { call } from "./client.ts"
import { FlowsPage } from "./pages/Flows.tsx"
import { IphonesPage } from "./pages/Iphones.tsx"
import { PushKeyPanel } from "./pages/Settings.tsx"
import "./styles.css"

const pages = {
  iphones: { label: "iPhones", render: () => <IphonesPage /> },
  flows: { label: "Flows", render: () => <FlowsPage /> },
  settings: {
    label: "Settings",
    render: () => (
      <>
        <h1>Settings</h1>
        <PushKeyPanel />
      </>
    )
  }
} as const
type Page = keyof typeof pages

const fromHash = (): Page => {
  const hash = window.location.hash.slice(1)
  return hash in pages ? (hash as Page) : "iphones"
}

function App() {
  const [page, setPage] = useState<Page>(fromHash)
  const [health, setHealth] = useState<Health | null>(null)
  const [down, setDown] = useState(false)

  useEffect(() => {
    const onHash = () => setPage(fromHash())
    window.addEventListener("hashchange", onHash)
    call((c) => c.system.health()).then(setHealth, () => setDown(true))
    return () => window.removeEventListener("hashchange", onHash)
  }, [])

  return (
    <div className="layout">
      <nav className="nav" aria-label="Console">
        <div className="brand"><img src="/icon.svg" alt="" />Quai</div>
        {(Object.keys(pages) as Array<Page>).map((p) => (
          <a key={p} className="nav-link" href={`#${p}`} aria-current={page === p ? "page" : undefined}>{pages[p].label}</a>
        ))}
        <p className="muted nav-foot">
          {health ? <><span className="dot" style={{ background: "var(--ok)" }} /> Quai {health.version}</> : down ? "Server unreachable" : "…"}
        </p>
      </nav>
      <main>{pages[page].render()}</main>
    </div>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

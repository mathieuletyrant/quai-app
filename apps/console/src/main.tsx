import type { Health } from "@quai/api"
import { StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { call } from "./client.ts"
import { FlowsPage } from "./pages/flows/FlowsPage.tsx"
import { IphonesPage } from "./pages/Iphones.tsx"
import { SettingsPage } from "./pages/Settings.tsx"
import "./styles.css"

const pages = {
  iphones: { label: "iPhones", render: () => <IphonesPage /> },
  flows: { label: "Flows", render: () => <FlowsPage /> },
  settings: { label: "Settings", render: () => <SettingsPage /> }
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
    <div className="mx-auto flex min-h-screen max-w-[1440px] flex-col md:flex-row">
      <nav
        aria-label="Console"
        className="flex shrink-0 flex-row items-center gap-1 border-b border-line px-4 py-3 md:sticky md:top-0 md:h-screen md:w-60 md:flex-col md:items-stretch md:border-r md:border-b-0 md:py-6"
      >
        <div className="mr-3 flex items-center gap-2.5 px-3 text-lg font-bold md:mr-0 md:pb-5">
          <img src="/icon.svg" alt="" className="size-[30px] rounded-[9px]" />
          Quai
        </div>
        {(Object.keys(pages) as Array<Page>).map((p) => (
          <a
            key={p}
            href={`#${p}`}
            aria-current={page === p ? "page" : undefined}
            className="flex h-10 items-center rounded-xl px-3 text-sm font-semibold text-[#c7c7cc] transition hover:text-text aria-[current=page]:bg-raised aria-[current=page]:text-text"
          >
            {pages[p].label}
          </a>
        ))}
        <p className="ml-auto hidden items-center gap-2 px-3 text-[13px] text-muted sm:flex md:mt-auto md:ml-0 md:pt-6">
          {health
            ? <><span className="size-2 rounded-full bg-ok" /> Quai {health.version}</>
            : down ? <><span className="size-2 rounded-full bg-danger" /> Server unreachable</> : "…"}
        </p>
      </nav>
      <main className="flex min-w-0 flex-1 flex-col gap-6 px-4 pt-6 pb-12 md:px-8 md:pt-7">{pages[page].render()}</main>
    </div>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

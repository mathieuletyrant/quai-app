import type { Health } from "@quai/api"
import { type ReactNode, StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { call, type HomeStatus, probeHome, useFixCount, useFixCountProbe, useHome, useHomeProbe } from "./client.ts"
import { FixesPage } from "./pages/Fixes.tsx"
import { FlowsPage } from "./pages/flows/FlowsPage.tsx"
import { IphonesPage } from "./pages/Iphones.tsx"
import { JournalPage } from "./pages/journal/JournalPage.tsx"
import { RequestsPage } from "./pages/Requests.tsx"
import { SettingsPage } from "./pages/Settings.tsx"
import { Button, Drawer, Icon, type IconName, Logo, type NavItem, NavList, Sidebar, StatusDot, type Tone, TopBar } from "./ui"
import "./styles.css"

const pages = {
  iphones: { label: "iPhones", icon: "phone", render: () => <IphonesPage /> },
  fixes: { label: "To fix", icon: "wrench", render: () => <FixesPage /> },
  requests: { label: "Requests", icon: "person", render: () => <RequestsPage /> },
  flows: { label: "Flows", icon: "flows", render: () => <FlowsPage /> },
  journal: { label: "Journal", icon: "journal", render: () => <JournalPage /> },
  settings: { label: "Settings", icon: "settings", render: () => <SettingsPage /> }
} as const satisfies Record<string, { label: string; icon: IconName; render: () => ReactNode }>
type Page = keyof typeof pages

const fromHash = (): Page => {
  const hash = window.location.hash.slice(1)
  return hash in pages ? (hash as Page) : "iphones"
}

const homeLabel: Record<HomeStatus, { readonly tone: Tone; readonly text: string }> = {
  checking: { tone: "neutral", text: "Checking…" },
  online: { tone: "ok", text: "Connected" },
  offline: { tone: "danger", text: "Offline" }
}

/** Where Quai Home stands: unknown while Quai Cloud, which would know, doesn't answer. */
const homeState = (status: HomeStatus, cloudDown: boolean) => cloudDown ? { tone: "neutral" as const, text: "Unknown" } : homeLabel[status]

/** What the phone top bar's dot says to screen readers: "Quai Home: connected". */
const homeDotLabel = (status: HomeStatus, cloudDown: boolean) => `Quai Home: ${homeState(status, cloudDown).text.toLowerCase()}`

/** Every destination, with the count of things to fix on its own. */
const navItems = (fixes: number | null): ReadonlyArray<NavItem> =>
  (Object.keys(pages) as Array<Page>).map((id) => ({ id, label: pages[id].label, icon: pages[id].icon, count: id === "fixes" ? fixes : null }))

/** "v0.12.1" for a release, the version as is otherwise ("dev"). */
const versionLabel = (version: string) => /^\d/.test(version) ? `v${version}` : version

/** Where Quai Cloud stands: its version once it answered. */
const cloudLabel = (health: Health | null, cloudDown: boolean): { readonly tone: Tone; readonly text: ReactNode } => {
  if (health) return { tone: "ok", text: <span className="font-mono text-mini">{versionLabel(health.version)}</span> }
  if (cloudDown) return { tone: "danger", text: "Unreachable" }
  return { tone: "neutral", text: "Checking…" }
}

/** One of Quai's two parts, its icon and where it stands. */
function Part({ icon, name, tone, pulse = false, children }: { icon: IconName; name: string; tone: Tone; pulse?: boolean; children: ReactNode }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-7 shrink-0 place-items-center rounded-item bg-raised text-muted"><Icon name={icon} size={15} /></span>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="text-small font-semibold">{name}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-caption text-muted">
          <StatusDot tone={tone} pulse={pulse} />
          {children}
        </p>
      </div>
    </div>
  )
}

/** Where Quai Home and Quai Cloud stand, at the foot of the sidebar. */
function Connection({ health, cloudDown }: { health: Health | null; cloudDown: boolean }) {
  const { status } = useHome()
  const home = homeState(status, cloudDown)
  const cloud = cloudLabel(health, cloudDown)
  return (
    <div className="flex flex-col gap-2.5 rounded-card border border-line bg-panel p-3">
      <Part icon="home" name="Quai Home" tone={home.tone} pulse={status === "online" && !cloudDown}>{home.text}</Part>
      <div className="border-t border-line pt-2.5">
        <Part icon="cloud" name="Quai Cloud" tone={cloud.tone}>{cloud.text}</Part>
      </div>
    </div>
  )
}

function Wordmark() {
  return <span className="text-brand font-bold tracking-title">Quai</span>
}

/** The sidebar's head: the logo, the name, and what this is. */
function Brand() {
  return (
    <a href="#iphones" className="mb-5 flex items-center gap-2.5 rounded-control px-2 py-1">
      <Logo />
      <Wordmark />
      <span className="ml-auto rounded-md border border-line-strong px-1.5 py-0.5 text-micro font-semibold tracking-tag text-muted uppercase">Console</span>
    </a>
  )
}

/** The phone top bar's logo, back to the first page. */
function HomeLink() {
  return <a href="#iphones" aria-label="Quai, iPhones" className="rounded-logo"><Logo /></a>
}

/** Across the top of every page while Quai Home isn't linked: what still works, and a retry. */
function OfflineBanner() {
  const [checking, setChecking] = useState(false)
  return (
    <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-danger/25 bg-danger-soft/50 px-4 py-2.5 md:px-8">
      <Icon name="unlink" size={16} className="text-danger-text" />
      <p className="min-w-0 flex-1 text-body text-text-2">
        <span className="font-semibold text-text">Quai Home is offline.</span>{" "}
        <span className="hidden text-muted sm:inline">iPhones and flows are kept at home: they can't be read or changed until it reconnects to Quai Cloud.</span>
      </p>
      <Button
        variant="secondary"
        size="sm"
        icon="refresh"
        disabled={checking}
        onClick={() => {
          setChecking(true)
          void probeHome().finally(() => setChecking(false))
        }}
      >
        {checking ? "Checking…" : "Retry"}
      </Button>
    </div>
  )
}

function App() {
  const [page, setPage] = useState<Page>(fromHash)
  const [health, setHealth] = useState<Health | null>(null)
  const [cloudDown, setCloudDown] = useState(false)
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = () => setMenuOpen(false)
  const { status } = useHome()
  const fixes = useFixCount()
  useHomeProbe()
  useFixCountProbe()

  useEffect(() => {
    const onHash = () => setPage(fromHash())
    window.addEventListener("hashchange", onHash)
    call((c) => c.system.health()).then(setHealth, () => setCloudDown(true))
    return () => window.removeEventListener("hashchange", onHash)
  }, [])

  const nav = (onNavigate?: () => void) => <NavList label="Console" items={navItems(fixes)} current={page} onNavigate={onNavigate} />
  const connection = <Connection health={health} cloudDown={cloudDown} />
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar brand={<Brand />} footer={connection}>{nav()}</Sidebar>
      <TopBar
        logo={<HomeLink />}
        title={pages[page].label}
        status={<StatusDot tone={homeState(status, cloudDown).tone} label={homeDotLabel(status, cloudDown)} />}
        menuOpen={menuOpen}
        onMenu={() => setMenuOpen(true)}
      />
      <Drawer open={menuOpen} label="Menu" onClose={closeMenu} footer={connection}>{nav(closeMenu)}</Drawer>

      <main className="flex min-w-0 flex-1 flex-col">
        {status === "offline" && <OfflineBanner />}
        <div key={page} className="flex min-w-0 flex-1 flex-col">{pages[page].render()}</div>
      </main>
    </div>
  )
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
)

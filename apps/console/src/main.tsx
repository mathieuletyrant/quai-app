import type { HomeOverview } from "@quai/api"
import { type ReactNode, StrictMode, useEffect, useState } from "react"
import { createRoot } from "react-dom/client"
import { callHome, type LinkStatus, probeLink, refreshSession, useLink, useLinkProbe, useSession } from "./client.ts"
import { useLoad } from "./load.ts"
import { AlertsPage } from "./pages/Alerts.tsx"
import { FlowsPage } from "./pages/flows/FlowsPage.tsx"
import { IphonesPage } from "./pages/Iphones.tsx"
import { JournalPage } from "./pages/journal/JournalPage.tsx"
import { ServicesPage } from "./pages/Services.tsx"
import { SettingsPage } from "./pages/Settings.tsx"
import { loadOverview } from "./pages/setup.tsx"
import { LockedPage, SignInPage } from "./pages/SignIn.tsx"
import {
  Button,
  Drawer,
  Icon,
  type IconName,
  Logo,
  type NavItem,
  NavList,
  Sidebar,
  StatusDot,
  type Tone,
  TopBar
} from "./ui"
import "./styles.css"

/** The console is for setting Quai up, in the order it's done; living with it happens in the app. */
const pages = {
  settings: { label: "Settings", icon: "settings", render: () => <SettingsPage /> },
  services: { label: "Services", icon: "server", render: () => <ServicesPage /> },
  flows: { label: "Flows", icon: "flows", render: () => <FlowsPage /> },
  alerts: { label: "Alerts", icon: "bell", render: () => <AlertsPage /> },
  iphones: { label: "iPhones", icon: "phone", render: () => <IphonesPage /> },
  journal: { label: "Journal", icon: "journal", render: () => <JournalPage /> }
} as const satisfies Record<string, { label: string; icon: IconName; render: () => ReactNode }>
type Page = keyof typeof pages

const fromHash = (): Page => {
  const hash = window.location.hash.slice(1)
  return hash in pages ? (hash as Page) : "settings"
}

/** Quai Home's link to Quai Cloud, as the console last saw it. */
const cloudLabel: Record<LinkStatus, { readonly tone: Tone; readonly text: string }> = {
  checking: { tone: "neutral", text: "Checking…" },
  online: { tone: "ok", text: "Connected" },
  offline: { tone: "danger", text: "Not connected" }
}

/** Where Quai Cloud stands: not set at all, or the link's state. */
const cloudState = (status: LinkStatus, overview: HomeOverview | null) =>
  overview !== null && !overview.cloud.configured ? { tone: "warn" as const, text: "Not set" } : cloudLabel[status]

/** What the phone top bar's dot says to screen readers: "Quai Cloud: connected". */
const cloudDotLabel = (status: LinkStatus, overview: HomeOverview | null) =>
  `Quai Cloud: ${cloudState(status, overview).text.toLowerCase()}`

/** Every destination, in the order Quai is set up. */
const navItems: ReadonlyArray<NavItem> = (Object.keys(pages) as Array<Page>).map((id) => ({
  id,
  label: pages[id].label,
  icon: pages[id].icon
}))

/** "v0.12.1" for a release, the version as is otherwise ("dev"). */
const versionLabel = (version: string) => /^\d/.test(version) ? `v${version}` : version

/** Quai Home serves this console, so it runs: its version once it answered. */
const homeVersion = (overview: HomeOverview | null) =>
  overview === null ? "…" : <span className="font-mono text-mini">{versionLabel(overview.version)}</span>

/** One of Quai's two parts, its icon and where it stands. */
function Part(
  { icon, name, tone, pulse = false, children }: {
    icon: IconName
    name: string
    tone: Tone
    pulse?: boolean
    children: ReactNode
  }
) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid size-7 shrink-0 place-items-center rounded-item bg-raised text-muted">
        <Icon name={icon} size={15} />
      </span>
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
function Connection({ overview }: { overview: HomeOverview | null }) {
  const { status } = useLink()
  const cloud = cloudState(status, overview)
  return (
    <div className="flex flex-col gap-2.5 rounded-card border border-line bg-panel p-3">
      <Part icon="home" name="Quai Home" tone="ok">{homeVersion(overview)}</Part>
      <div className="border-t border-line pt-2.5">
        <Part icon="cloud" name="Quai Cloud" tone={cloud.tone} pulse={status === "online"}>{cloud.text}</Part>
      </div>
    </div>
  )
}

function Wordmark() {
  return <span className="text-brand font-bold tracking-title">Quai</span>
}

/** The head of the sidebar and the phone menu: the logo, the name, and what this is for. */
function Brand() {
  return (
    <a href="#settings" className="flex items-center gap-2.5 rounded-control px-2 py-1">
      <Logo />
      <Wordmark />
      <span className="ml-auto rounded-md border border-line-strong px-1.5 py-0.5 text-micro font-semibold tracking-tag text-muted uppercase">
        Setup
      </span>
    </a>
  )
}

/** Across the top of every page while Quai Home isn't linked to its Quai Cloud: what that stops, and a retry. */
function OfflineBanner() {
  const [checking, setChecking] = useState(false)
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-danger/25 bg-danger-soft/50 px-4 py-2.5 md:px-8"
    >
      <Icon name="unlink" size={16} className="text-danger-text" />
      <p className="min-w-0 flex-1 text-body text-text-2">
        <span className="font-semibold text-text">Quai Cloud isn't reachable.</span>{" "}
        <span className="hidden text-muted sm:inline">
          Everything here still works. Until Quai Home links to it again, the app can't reach this home from outside and
          nothing is pushed.
        </span>
      </p>
      <Button
        variant="secondary"
        size="sm"
        icon="refresh"
        disabled={checking}
        onClick={() => {
          setChecking(true)
          void probeLink().finally(() => setChecking(false))
        }}
      >
        {checking ? "Checking…" : "Retry"}
      </Button>
    </div>
  )
}

/** The phone top bar's logo, back to the first page. */
function HomeLink() {
  return (
    <a href="#settings" aria-label="Quai, Settings" className="rounded-logo">
      <Logo size={26} />
    </a>
  )
}

function App() {
  const [page, setPage] = useState<Page>(fromHash)
  const overview = useLoad(loadOverview, [])
  const [menuOpen, setMenuOpen] = useState(false)
  const closeMenu = () => setMenuOpen(false)
  const { status } = useLink()
  useLinkProbe()

  useEffect(() => {
    const onHash = () => setPage(fromHash())
    window.addEventListener("hashchange", onHash)
    return () => window.removeEventListener("hashchange", onHash)
  }, [])

  const nav = (onNavigate?: () => void) => (
    <NavList label="Console" items={navItems} current={page} onNavigate={onNavigate} />
  )
  const footer = (
    <div className="flex flex-col gap-3">
      <Connection overview={overview.data} />
      <SignOut />
    </div>
  )
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <Sidebar brand={<Brand />} footer={footer}>{nav()}</Sidebar>
      <TopBar
        logo={<HomeLink />}
        title={pages[page].label}
        status={
          <StatusDot tone={cloudState(status, overview.data).tone} label={cloudDotLabel(status, overview.data)} />
        }
        menuOpen={menuOpen}
        onMenu={() => setMenuOpen(true)}
      />
      <Drawer open={menuOpen} label="Menu" brand={<Brand />} onClose={closeMenu} footer={footer}>
        {nav(closeMenu)}
      </Drawer>

      <main className="flex min-w-0 flex-1 flex-col">
        {status === "offline" && overview.data?.cloud.configured === true && <OfflineBanner />}
        <div key={page} className="flex min-w-0 flex-1 flex-col">{pages[page].render()}</div>
      </main>
    </div>
  )
}

/** Ends this browser's session. */
function SignOut() {
  const signOut = () => void callHome((api) => api.session.signOut()).finally(refreshSession)
  return <Button variant="secondary" icon="signOut" className="w-full" onClick={signOut}>Sign out</Button>
}

/** The console once signed in; Quai Home's password first. */
function Root() {
  const session = useSession()
  useEffect(() => void refreshSession(), [])
  if (session === "locked") return <LockedPage />
  if (session === "signedOut") return <SignInPage />
  if (session === "signedIn") return <App />
  return null
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Root />
  </StrictMode>
)

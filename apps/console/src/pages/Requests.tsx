import type { MediaRequest, MediaRequests } from "@quai/api"
import { useCallback, useEffect, useState } from "react"
import { call, isHomeOffline, useHome } from "../client.ts"
import { Badge, Button, Callout, EmptyState, errorText, HomeOfflineState, IconTile, type Notice, PageBar, PageBody, Panel, PosterThumb, Skeleton, Toast } from "../ui"

/** "Julie · Series · Seasons 1, 2 · 4K · 3 h ago" */
const facts = (r: MediaRequest) => {
  const ago = r.requestedAt === undefined ? null : Math.max(0, Math.round((Date.now() / 1000 - r.requestedAt) / 60))
  return [
    r.requester,
    r.kind === "movie" ? "Movie" : "Series",
    r.seasons.length > 0 ? `${r.seasons.length === 1 ? "Season" : "Seasons"} ${r.seasons.join(", ")}` : null,
    r.is4k ? "4K" : null,
    ago === null ? null : ago < 60 ? `${ago} min ago` : ago < 2880 ? `${Math.round(ago / 60)} h ago` : `${Math.round(ago / 1440)} days ago`
  ].filter(Boolean).join(" · ")
}

/** Seerr's requests waiting for approval: approve or decline each one. */
export function RequestsPage() {
  const [list, setList] = useState<MediaRequests | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [busy, setBusy] = useState<number | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const { epoch } = useHome()

  const refresh = useCallback(() => {
    call((c) => c.consoleRequests.list()).then((l) => {
      setList(l)
      setError(null)
    }, setError)
  }, [])
  useEffect(() => refresh(), [refresh, epoch])

  const decide = async (r: MediaRequest, decision: "approve" | "decline") => {
    if (decision === "decline" && !window.confirm(`Decline ${r.requester}'s request for “${r.title}”?`)) return
    setBusy(r.id)
    try {
      const id = { params: { id: String(r.id) } }
      await call((c) => decision === "approve" ? c.consoleRequests.approve(id) : c.consoleRequests.decline(id))
      setNotice({ ok: true, text: `${decision === "approve" ? "Approved" : "Declined"}: ${r.title}` })
      setList((l) => l === null ? l : { ...l, items: l.items.filter((i) => i.id !== r.id) })
      refresh()
    } catch (e) {
      setNotice({ ok: false, text: errorText(e) })
    } finally {
      setBusy(null)
    }
  }

  const offline = isHomeOffline(error)
  const items = list?.items ?? null
  return (
    <>
      <PageBar
        title="Requests"
        subtitle={items === null ? "Seerr's requests waiting for your approval." : items.length === 0 ? "Nothing waits for approval" : `${items.length} waiting for approval`}
      >
        <Button variant="secondary" icon="refresh" onClick={refresh}>Refresh</Button>
      </PageBar>
      <PageBody>
        {error !== null && !offline && <Callout tone="danger" icon="alert" title="Couldn't read the requests">{errorText(error)}</Callout>}
        {list?.status === "unavailable" && <Callout tone="warn" icon="unlink">Seerr didn't answer: its requests are missing.</Callout>}
        <Panel flush>
          {offline && list === null
            ? <HomeOfflineState what="Seerr is read through Quai Home: its requests" />
            : list === null
            ? <div className="flex flex-col gap-3 p-5">{[0, 1].map((i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
            : list.status === "notConfigured"
            ? (
              <EmptyState icon="person" title="No Seerr">
                Give Quai Home Seerr's address and API key (QUAI_SEERR_URL, QUAI_SEERR_API_KEY) to approve requests from here and from the iPhone.
              </EmptyState>
            )
            : list.items.length === 0
            ? <EmptyState icon="check" title="Nothing waits">Requests made by an auto-approved account never wait, so they never show here.</EmptyState>
            : (
              <ul className="divide-y divide-line">
                {list.items.map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-5 py-4">
                    <PosterThumb src={r.posterUrl} fallback={<IconTile icon="person" className="text-[#8B8CF8]" />} />
                    <div className="min-w-[min(100%,14rem)] flex-1">
                      <p className="flex items-center gap-2 text-[14.5px] font-semibold [overflow-wrap:anywhere]">
                        {r.title}{r.year !== undefined && <span className="font-normal text-muted">{r.year}</span>}
                        {r.is4k && <Badge tone="info">4K</Badge>}
                      </p>
                      <p className="mt-0.5 text-[13px] text-muted">{facts(r)}</p>
                    </div>
                    <div className="flex gap-2">
                      <Button icon="check" disabled={busy !== null} onClick={() => decide(r, "approve")}>{busy === r.id ? "…" : "Approve"}</Button>
                      <Button variant="danger" icon="x" disabled={busy !== null} onClick={() => decide(r, "decline")}>Decline</Button>
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </Panel>
      </PageBody>
      <Toast notice={notice} onDone={() => setNotice(null)} />
    </>
  )
}

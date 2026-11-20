import type { MediaRequest, MediaRequests } from "@quai/api"
import { useState } from "react"
import { call, useHome } from "../client.ts"
import { duration, minutesSince } from "../format.ts"
import { useLoad } from "../load.ts"
import {
  Async,
  Badge,
  Button,
  Callout,
  EmptyState,
  ErrorCallout,
  errorText,
  HomeOfflineState,
  IconTile,
  MediaItem,
  MediaList,
  type Notice,
  PageBar,
  PageBody,
  Panel,
  PosterThumb,
  SkeletonList,
  Toast
} from "../ui"

type Decision = "approve" | "decline"

const seasons = (numbers: ReadonlyArray<number>) =>
  numbers.length === 0 ? null : `${numbers.length === 1 ? "Season" : "Seasons"} ${numbers.join(", ")}`

/** "Julie · Series · Seasons 1, 2 · 4K · 3 h ago" */
const facts = (r: MediaRequest) =>
  [
    r.requester,
    r.kind === "movie" ? "Movie" : "Series",
    seasons(r.seasons),
    r.is4k ? "4K" : null,
    r.requestedAt === undefined ? null : `${duration(minutesSince(r.requestedAt))} ago`
  ].filter(Boolean).join(" · ")

const subtitle = (list: MediaRequests | null) => {
  if (list === null) return "Seerr's requests waiting for your approval."
  if (list.items.length === 0) return "Nothing waits for approval"
  return `${list.items.length} waiting for approval`
}

/** Seerr's requests waiting for approval: approve or decline each one. */
export function RequestsPage() {
  const { epoch } = useHome()
  const requests = useLoad(() => call((c) => c.consoleRequests.list()), [epoch])
  const [busy, setBusy] = useState<number | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  const decide = async (r: MediaRequest, decision: Decision) => {
    if (decision === "decline" && !window.confirm(`Decline ${r.requester}'s request for “${r.title}”?`)) return
    setBusy(r.id)
    try {
      const id = { params: { id: String(r.id) } }
      await call((c) => decision === "approve" ? c.consoleRequests.approve(id) : c.consoleRequests.decline(id))
      setNotice({ ok: true, text: `${decision === "approve" ? "Approved" : "Declined"}: ${r.title}` })
      requests.setData((l) => ({ ...l, items: l.items.filter((i) => i.id !== r.id) }))
      requests.refresh()
    } catch (e) {
      setNotice({ ok: false, text: errorText(e) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <PageBar title="Requests" subtitle={subtitle(requests.data)}>
        <Button variant="secondary" icon="refresh" onClick={requests.refresh}>Refresh</Button>
      </PageBar>
      <PageBody>
        <ErrorCallout unlessOffline error={requests.error} title="Couldn't read the requests" />
        {requests.data?.status === "unavailable" && <Callout tone="warn" icon="unlink">Seerr didn't answer: its requests are missing.</Callout>}
        <Panel flush>
          <Async
            state={requests}
            loading={<SkeletonList count={2} />}
            offline={<HomeOfflineState what="Seerr is read through Quai Home: its requests" />}
          >
            {(list) => <RequestList list={list} busy={busy} onDecide={decide} />}
          </Async>
        </Panel>
      </PageBody>
      <Toast notice={notice} onDone={() => setNotice(null)} />
    </>
  )
}

function RequestList({ list, busy, onDecide }: { list: MediaRequests; busy: number | null; onDecide: (r: MediaRequest, decision: Decision) => void }) {
  if (list.status === "notConfigured") {
    return (
      <EmptyState icon="person" title="No Seerr">
        Give Quai Home Seerr's address and API key (QUAI_SEERR_URL, QUAI_SEERR_API_KEY) to approve requests from here and from the iPhone.
      </EmptyState>
    )
  }
  if (list.items.length === 0) {
    return <EmptyState icon="check" title="Nothing waits">Requests made by an auto-approved account never wait, so they never show here.</EmptyState>
  }
  return (
    <MediaList>
      {list.items.map((r) => (
        <RequestRow key={r.id} request={r} deciding={busy === r.id} locked={busy !== null} onDecide={(decision) => onDecide(r, decision)} />
      ))}
    </MediaList>
  )
}

/** One request: its poster, title and facts, and Approve / Decline, `locked` while any decision runs. */
function RequestRow({ request: r, deciding, locked, onDecide }: {
  request: MediaRequest
  deciding: boolean
  locked: boolean
  onDecide: (decision: Decision) => void
}) {
  return (
    <MediaItem
      poster={<PosterThumb src={r.posterUrl} fallback={<IconTile icon="person" className="text-requests" />} />}
      title={
        <>
          {r.title}
          {r.year !== undefined && <span className="font-normal text-muted">{r.year}</span>}
          {r.is4k && <Badge tone="info">4K</Badge>}
        </>
      }
      detail={facts(r)}
      actions={
        <>
          <Button icon="check" disabled={locked} onClick={() => onDecide("approve")}>{deciding ? "…" : "Approve"}</Button>
          <Button variant="danger" icon="x" disabled={locked} onClick={() => onDecide("decline")}>Decline</Button>
        </>
      }
    />
  )
}

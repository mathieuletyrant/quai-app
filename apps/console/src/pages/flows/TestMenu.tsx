import type { DeviceId } from "@quai/api"
import { useState } from "react"
import { Button, Popover } from "../../ui.tsx"

export interface Phone {
  readonly id: DeviceId
  readonly name: string
}

/** Plays the flow's test on the iPhones ticked here (all of them by default). */
export function TestMenu({ phones, onTest }: {
  phones: ReadonlyArray<Phone>
  onTest: (deviceIds: ReadonlyArray<DeviceId>) => void
}) {
  const [chosen, setChosen] = useState<ReadonlySet<DeviceId> | null>(null)
  const ticked = chosen ?? new Set(phones.map((p) => p.id))
  const toggle = (id: DeviceId) => {
    const next = new Set(ticked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setChosen(next)
  }

  return (
    <Popover
      align="right"
      className="w-64 p-3"
      trigger={({ open, toggle: flip }) => (
        <Button
          variant="secondary"
          disabled={phones.length === 0}
          title={phones.length === 0 ? "Pair an iPhone first" : undefined}
          aria-expanded={open}
          onClick={flip}
        >
          ▶ Test
        </Button>
      )}
    >
      {(close) => (
        <>
          <p className="px-1 pb-1 text-xs font-semibold text-muted">Play a test on</p>
          {phones.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1.5 text-sm hover:bg-white/5">
              <input type="checkbox" className="size-4 accent-accent" checked={ticked.has(p.id)} onChange={() => toggle(p.id)} />
              {p.name}
            </label>
          ))}
          <Button size="sm" className="mt-1" disabled={ticked.size === 0} onClick={() => { onTest([...ticked]); close() }}>
            Send the test
          </Button>
        </>
      )}
    </Popover>
  )
}

import type { DeviceId } from "@quai/api"
import { useState } from "react"
import { Button, MenuLabel, Popover } from "../../ui.tsx"

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
      className="w-72 p-2"
      trigger={({ open, toggle: flip }) => (
        <Button
          variant="secondary"
          disabled={phones.length === 0}
          title={phones.length === 0 ? "Pair an iPhone first" : undefined}
          aria-expanded={open}
          onClick={flip}
          icon="play"
        >
          Test
        </Button>
      )}
    >
      {(close) => (
        <>
          <MenuLabel>Play a test on</MenuLabel>
          {phones.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-2.5 rounded-[8px] px-2.5 py-2 text-[13px] transition-colors hover:bg-white/6">
              <input type="checkbox" className="size-4 accent-accent" checked={ticked.has(p.id)} onChange={() => toggle(p.id)} />
              <span className="truncate">{p.name}</span>
            </label>
          ))}
          <p className="px-2.5 pt-1 pb-2 text-[12px] leading-relaxed text-faint">Plays every step in about 30 s. Lock the iPhone to watch.</p>
          <Button size="sm" disabled={ticked.size === 0} onClick={() => { onTest([...ticked]); close() }}>
            Send the test{ticked.size > 1 ? ` to ${ticked.size} iPhones` : ""}
          </Button>
        </>
      )}
    </Popover>
  )
}

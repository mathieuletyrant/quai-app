import type { DeviceId } from "@quai/api"
import { useState } from "react"
import { Button } from "../../ui.tsx"

export interface Phone {
  readonly id: DeviceId
  readonly name: string
}

/** Plays the flow's test on the iPhones ticked here (all of them by default). */
export function TestMenu({ phones, disabled, onTest }: {
  phones: ReadonlyArray<Phone>
  disabled: boolean
  onTest: (deviceIds: ReadonlyArray<DeviceId>) => void
}) {
  const [open, setOpen] = useState(false)
  const [chosen, setChosen] = useState<ReadonlySet<DeviceId> | null>(null)
  const ticked = chosen ?? new Set(phones.map((p) => p.id))
  const toggle = (id: DeviceId) => {
    const next = new Set(ticked)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setChosen(next)
  }

  return (
    <div className="relative">
      <Button
        variant="secondary"
        size="sm"
        disabled={disabled || phones.length === 0}
        title={phones.length === 0 ? "Pair an iPhone first" : disabled ? "Save first" : undefined}
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        Test…
      </Button>
      {open && (
        <div className="absolute right-0 z-30 mt-2 flex w-64 flex-col gap-1 rounded-2xl border border-white/12 bg-raised p-3 shadow-2xl">
          <p className="px-1 pb-1 text-xs font-semibold text-muted">Play a test on</p>
          {phones.map((p) => (
            <label key={p.id} className="flex cursor-pointer items-center gap-2.5 rounded-lg px-1 py-1.5 text-sm hover:bg-white/5">
              <input type="checkbox" className="size-4 accent-accent" checked={ticked.has(p.id)} onChange={() => toggle(p.id)} />
              {p.name}
            </label>
          ))}
          <Button
            size="sm"
            className="mt-1"
            disabled={ticked.size === 0}
            onClick={() => {
              onTest([...ticked])
              setOpen(false)
            }}
          >
            Send the test
          </Button>
        </div>
      )}
    </div>
  )
}

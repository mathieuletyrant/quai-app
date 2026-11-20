import type { DeviceId } from "@quai/api"
import { useState } from "react"
import { Button, MenuLabel, Popover } from "../../ui"

export interface Phone {
  readonly id: DeviceId
  readonly name: string
}

/** "Send the test", "Send the test to 3 iPhones" */
const sendLabel = (count: number) => count > 1 ? `Send the test to ${count} iPhones` : "Send the test"

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
          {phones.map((p) => <PhoneOption key={p.id} phone={p} ticked={ticked.has(p.id)} onToggle={() => toggle(p.id)} />)}
          <p className="px-2.5 pt-1 pb-2 text-caption leading-relaxed text-faint">Plays every step in about 30 s. Lock the iPhone to watch.</p>
          <Button size="sm" disabled={ticked.size === 0} onClick={() => { onTest([...ticked]); close() }}>
            {sendLabel(ticked.size)}
          </Button>
        </>
      )}
    </Popover>
  )
}

function PhoneOption({ phone, ticked, onToggle }: { phone: Phone; ticked: boolean; onToggle: () => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2.5 rounded-item px-2.5 py-2 text-body transition-colors hover:bg-white/6">
      <input type="checkbox" className="size-4 accent-accent" checked={ticked} onChange={onToggle} />
      <span className="truncate">{phone.name}</span>
    </label>
  )
}

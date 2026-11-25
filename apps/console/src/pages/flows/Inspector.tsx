import { type CatalogAction, type CatalogEvent, defaultStartsAt, stepShows } from "@quai/api"
import { shortMinutes } from "../../format.ts"
import {
  Callout,
  Chip,
  Field,
  FieldGroup,
  FieldNote,
  IconButton,
  Input,
  InspectorSection as Section,
  Segmented,
  Select
} from "../../ui"
import { type Draft, type DraftStep, eventOption, type EventType, palette, showLabels, skippedFor } from "./draft.ts"
import { IconPicker } from "./IconPicker.tsx"

type Change = (change: (draft: Draft) => void) => void

/** A length to choose, or Never. */
const minutesOption = (minutes: number) => minutes === 0 ? "Never" : shortMinutes(minutes)

const mediaTypeOptions = [{ value: "any", label: "All" }, { value: "movie", label: "Movies" }, {
  value: "series",
  label: "Series"
}] as const

/** "TV Salon, iPad" → ["TV Salon", "iPad"] */
const deviceList = (text: string) => text.split(",").map((name) => name.trim()).filter(Boolean)

/** The flow's look and which activities it follows. */
export function FlowPanel({ flow, onChange }: { flow: Draft; onChange: Change }) {
  return (
    <Section title="Flow">
      <Field label="Name">
        <Input
          className="font-semibold"
          value={flow.name}
          maxLength={40}
          onChange={(event) =>
            onChange((draft) => {
              draft.name = event.target.value
            })}
        />
      </Field>
      <Field label="Color">
        <ColorSwatches
          value={flow.color}
          onChange={(color) =>
            onChange((draft) => {
              draft.color = color
            })}
        />
      </Field>
      <FieldGroup label="Icon">
        <IconPicker
          label="Flow icon"
          value={flow.icon}
          color={flow.color}
          onChange={(icon) =>
            onChange((draft) => {
              draft.icon = icon
            })}
        />
      </FieldGroup>
      <FilterFields flow={flow} onChange={onChange} />
    </Section>
  )
}

/** The flow colours to pick from: the iPhone draws the activity in the one chosen. */
function ColorSwatches({ value, onChange }: { value: string; onChange: (color: string) => void }) {
  return (
    <div className="flex flex-wrap gap-2.5">
      {palette.map((color) => (
        <button
          key={color}
          type="button"
          aria-label={color}
          aria-pressed={value === color}
          onClick={() => onChange(color)}
          className="size-7 rounded-full ring-offset-2 ring-offset-panel transition hover:scale-110 aria-pressed:ring-2 aria-pressed:ring-white"
          style={{ background: color }}
        />
      ))}
    </div>
  )
}

/** Which activities of its kind the flow follows: titles, a start time, Jellyfin devices. */
function FilterFields({ flow, onChange }: { flow: Draft; onChange: Change }) {
  switch (flow.subject) {
    case "media":
    case "request":
      return (
        <FieldGroup label="Titles">
          <Segmented
            label="Titles"
            value={flow.filter.mediaType ?? "any"}
            options={mediaTypeOptions}
            onChange={(mediaType) =>
              onChange((draft) => {
                draft.filter.mediaType = mediaType
              })}
          />
        </FieldGroup>
      )
    case "day":
      return (
        <Field
          label="Starts at"
          hint="In the iPhones' time zone. Earlier when a release airs before; ends when all are here, or at midnight."
        >
          <Input
            type="time"
            value={flow.filter.startsAt ?? defaultStartsAt}
            onChange={(event) =>
              onChange((draft) => {
                if (/^\d{2}:\d{2}$/.test(event.target.value)) draft.filter.startsAt = event.target.value
              })}
          />
        </Field>
      )
    case "playback":
      return (
        <Field label="Jellyfin devices" hint="Comma-separated, as Jellyfin names them. Empty: every device.">
          <Input
            value={(flow.filter.devices ?? []).join(", ")}
            placeholder="TV Salon, iPad"
            onChange={(event) =>
              onChange((draft) => {
                draft.filter.devices = deviceList(event.target.value)
              })}
          />
        </Field>
      )
  }
}

/** One step: its name and icon, the event that enters it, what it shows, its buttons. */
export function StepPanel(props: {
  flow: Draft
  index: number
  events: ReadonlyArray<CatalogEvent>
  actions: ReadonlyArray<CatalogAction>
  onChange: (step: DraftStep) => void
  onMove: (delta: -1 | 1) => void
  onRemove: () => void
}) {
  const { flow, index, events } = props
  const step = flow.steps[index]!
  const usedBy = (type: EventType) => flow.steps.findIndex((other, position) => position !== index && other.on === type)
  const clash = usedBy(step.on)
  const skipped = skippedFor(flow, events.find((event) => event.type === step.on))
  const stepActions = step.actions ?? []
  const toggleAction = (type: CatalogAction["type"]) =>
    props.onChange({
      ...step,
      actions: stepActions.includes(type) ? stepActions.filter((action) => action !== type) : [...stepActions, type]
    })
  const toggleShow = (key: keyof DraftStep["show"]) =>
    props.onChange({ ...step, show: { ...step.show, [key]: !step.show[key] } })

  return (
    <Section
      title={`Step ${index + 1}`}
      actions={
        <>
          <IconButton
            icon="arrowUp"
            label="Move up"
            className="size-8"
            disabled={index === 0}
            onClick={() => props.onMove(-1)}
          />
          <IconButton
            icon="arrowDown"
            label="Move down"
            className="size-8"
            disabled={index === flow.steps.length - 1}
            onClick={() => props.onMove(1)}
          />
          <IconButton
            icon="trash"
            label="Remove step"
            className="size-8 hover:bg-danger-soft hover:text-danger-text"
            disabled={flow.steps.length <= 1}
            onClick={props.onRemove}
          />
        </>
      }
    >
      <Field label="Name">
        <Input
          className="font-semibold"
          value={step.label}
          maxLength={24}
          onChange={(event) => props.onChange({ ...step, label: event.target.value })}
        />
      </Field>
      <Field label="Starts when">
        <Select
          invalid={clash >= 0}
          value={step.on}
          onChange={(event) => props.onChange({ ...step, on: event.target.value as EventType })}
        >
          {events.map((event) => {
            const other = usedBy(event.type)
            return (
              <option key={event.type} value={event.type}>
                {eventOption(event)}
                {other >= 0 ? ` (step ${other + 1})` : ""}
              </option>
            )
          })}
        </Select>
      </Field>
      {clash >= 0 && <FieldNote tone="danger">Step {clash + 1} already starts on this event.</FieldNote>}
      {skipped && <FieldNote tone="warn">{skipped}</FieldNote>}
      {stepShows[flow.subject].length > 0 && (
        <FieldGroup label="Shows">
          <div className="flex flex-wrap gap-2">
            {stepShows[flow.subject].map((key) => (
              <Chip
                key={key}
                pressed={step.show[key] === true}
                color={flow.color}
                onClick={() => toggleShow(key)}
              >
                {showLabels[key]}
              </Chip>
            ))}
          </div>
        </FieldGroup>
      )}
      {flow.subject === "playback" && (
        <Callout icon="info">
          A pause, from Jellyfin or the button, keeps this step: it says Paused, holds the bar and the button turns to
          Play. To see it, switch the preview to Paused.
        </Callout>
      )}
      {props.actions.length > 0 && (
        <FieldGroup label="Buttons">
          <div className="flex flex-wrap gap-2">
            {props.actions.map((action) => (
              <Chip
                key={action.type}
                pressed={stepActions.includes(action.type)}
                color={flow.color}
                onClick={() => toggleAction(action.type)}
              >
                {action.label}
              </Chip>
            ))}
          </div>
        </FieldGroup>
      )}
      <FieldGroup label="Icon">
        <IconPicker
          label="Step icon"
          value={step.icon}
          color={flow.color}
          onChange={(icon) => props.onChange({ ...step, icon })}
        />
      </FieldGroup>
    </Section>
  )
}

/** How the activity ends and how long it stays. */
export function EndPanel(
  { flow, events, onChange }: { flow: Draft; events: ReadonlyArray<CatalogEvent>; onChange: Change }
) {
  const optional =
    (key: "stalledAfterMinutes" | "expireAfterMinutes") => (event: React.ChangeEvent<HTMLSelectElement>) =>
      onChange((draft) => {
        const minutes = Number(event.target.value)
        if (minutes === 0) delete draft[key]
        else draft[key] = minutes
      })
  const setEndOn = (event: React.ChangeEvent<HTMLSelectElement>) =>
    onChange((draft) => {
      if (event.target.value === "") delete draft.endOn
      else draft.endOn = event.target.value as EventType
    })
  const several = flow.steps.length > 1
  const endEvents = events.filter((event) => !flow.steps.some((step) => step.on === event.type))
  return (
    <Section title="Ends">
      <Field label={several ? "Ends at the last step, or when" : "Ends when"}>
        <Select value={flow.endOn ?? ""} onChange={setEndOn}>
          <option value="">{several ? "Nothing else" : "The last step is reached"}</option>
          {endEvents.map((event) => <option key={event.type} value={event.type}>{eventOption(event)}</option>)}
        </Select>
      </Field>
      <Field label="Stays on screen after the end">
        <Select
          value={flow.lingerMinutes}
          onChange={(event) =>
            onChange((draft) => {
              draft.lingerMinutes = Number(event.target.value)
            })}
        >
          {[0, 1, 5, 15, 30, 60].map((minutes) => (
            <option key={minutes} value={minutes}>{minutes === 0 ? "No" : `${minutes} min`}</option>
          ))}
        </Select>
      </Field>
      {flow.subject === "media" && (
        <Field label="Turns grey with no progress for">
          <Select value={flow.stalledAfterMinutes ?? 0} onChange={optional("stalledAfterMinutes")}>
            {[0, 30, 60, 120, 240].map((minutes) => (
              <option key={minutes} value={minutes}>{minutesOption(minutes)}</option>
            ))}
          </Select>
        </Field>
      )}
      {flow.subject !== "request" && (
        <Field label="Ends anyway with no news for">
          <Select value={flow.expireAfterMinutes ?? 0} onChange={optional("expireAfterMinutes")}>
            {[0, 15, 60, 240, 1440].map((minutes) => (
              <option key={minutes} value={minutes}>{minutesOption(minutes)}</option>
            ))}
          </Select>
        </Field>
      )}
    </Section>
  )
}

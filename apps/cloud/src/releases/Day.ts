/**
 * Days and times in the home's time zone, from epoch milliseconds. Pure: the clock is the
 * caller's (`Clock`), the zone an IANA name.
 */

/** Whether the runtime knows this time zone. */
export const isTimeZone = (zone: string): boolean => {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: zone })
    return true
  } catch {
    return false
  }
}

const formatters = new Map<string, Intl.DateTimeFormat>()
const formatter = (zone: string) => {
  let f = formatters.get(zone)
  if (f === undefined) {
    f = new Intl.DateTimeFormat("en-US", {
      timeZone: zone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit"
    })
    formatters.set(zone, f)
  }
  return f
}

interface Parts {
  readonly year: number
  readonly month: number
  readonly day: number
  readonly hour: number
  readonly minute: number
  readonly second: number
}

const partsOf = (ms: number, zone: string): Parts => {
  const parts = Object.fromEntries(formatter(zone).formatToParts(new Date(ms)).map((p) => [p.type, p.value]))
  return {
    year: Number(parts["year"]),
    month: Number(parts["month"]),
    day: Number(parts["day"]),
    hour: Number(parts["hour"]),
    minute: Number(parts["minute"]),
    second: Number(parts["second"])
  }
}

const pad = (n: number) => n.toString().padStart(2, "0")

/** The local day at that instant: "2026-11-20". */
export const dayOf = (ms: number, zone: string): string => {
  const p = partsOf(ms, zone)
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`
}

/** Minutes past local midnight at that instant. */
export const minuteOfDay = (ms: number, zone: string): number => {
  const p = partsOf(ms, zone)
  return p.hour * 60 + p.minute
}

/** How far ahead of UTC the zone is at that instant, in milliseconds. */
const offsetAt = (ms: number, zone: string) => {
  const p = partsOf(ms, zone)
  return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - Math.floor(ms / 1000) * 1000
}

/** The instant a local time ("18:00") of a day happens; a time a DST jump skips comes an hour later. */
export const instantOf = (day: string, time: string, zone: string): number => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number]
  const [hh, mm] = time.split(":").map(Number) as [number, number]
  const wall = Date.UTC(y, m - 1, d, hh, mm)
  const first = wall - offsetAt(wall, zone)
  return wall - offsetAt(first, zone)
}

/** The next day: "2026-11-21". */
export const nextDay = (day: string): string => {
  const [y, m, d] = day.split("-").map(Number) as [number, number, number]
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10)
}

/** The day's instants: from local midnight to the next one. */
export const dayRange = (day: string, zone: string): { readonly start: number; readonly end: number } => ({
  start: instantOf(day, "00:00", zone),
  end: instantOf(nextDay(day), "00:00", zone)
})

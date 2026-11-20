/** Formatting the console shares across pages: plain text, out of the markup. */

/** "4 min", "3 h", "2 days": hours up to two days. */
export const duration = (minutes: number) =>
  minutes < 60 ? `${minutes} min` : minutes < 2880 ? `${Math.round(minutes / 60)} h` : `${Math.round(minutes / 1440)} days`

/** Whole minutes since a Unix time in seconds, never negative. */
export const minutesSince = (epochSeconds: number) => Math.max(0, Math.round((Date.now() / 1000 - epochSeconds) / 60))

/** "30 min", "2 h": a setting's length in minutes, whole hours past one. */
export const shortMinutes = (minutes: number) => minutes < 60 ? `${minutes} min` : `${minutes / 60} h`


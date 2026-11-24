/** What the Worker holds for Quai Cloud: its vars from wrangler.jsonc and its secrets. */
export interface CloudSettings {
  readonly QUAI_VERSION?: string
  readonly QUAI_CLOUD_PUBLIC_URL?: string
  readonly QUAI_MAX_HOMES?: string
  readonly QUAI_HOME_ID?: string
  readonly QUAI_TZ?: string
  readonly QUAI_APNS_TOPIC?: string
  readonly QUAI_APNS_KEY?: string
  readonly QUAI_APNS_KEY_ID?: string
  readonly QUAI_APNS_TEAM_ID?: string
}

const names = [
  "QUAI_VERSION",
  "QUAI_CLOUD_PUBLIC_URL",
  "QUAI_MAX_HOMES",
  "QUAI_HOME_ID",
  "QUAI_TZ",
  "QUAI_APNS_TOPIC",
  "QUAI_APNS_KEY",
  "QUAI_APNS_KEY_ID",
  "QUAI_APNS_TEAM_ID",
] as const satisfies ReadonlyArray<keyof CloudSettings>

/**
 * The container's environment: Quai Cloud's own `QUAI_*` settings, the ones that are set and not
 * blank. An unset APNs secret leaves Quai Cloud without pushes rather than with a broken key.
 */
export const containerEnvironment = (settings: CloudSettings): Record<string, string> => {
  const environment: Record<string, string> = { QUAI_PORT: "8787" }
  for (const name of names) {
    const value = settings[name]?.trim()
    if (value) environment[name] = value
  }
  return environment
}

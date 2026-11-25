/** What the Worker holds for Quai Cloud: its vars from wrangler.jsonc and its secrets. */
export interface CloudSettings {
  readonly QUAI_CLOUD_PUBLIC_URL?: string
  readonly QUAI_MAX_HOMES?: string
  readonly QUAI_HOME_ID?: string
  readonly QUAI_TZ?: string
  readonly QUAI_APNS_TOPIC?: string
  readonly QUAI_APNS_KEY?: string
  readonly QUAI_APNS_KEY_ID?: string
  readonly QUAI_APNS_TEAM_ID?: string
}

/**
 * Not `QUAI_VERSION`: the image carries its own (built with it), so a container a rollout restarts
 * on the new image never shows the version the previous deployment started it with.
 */
const names = [
  "QUAI_CLOUD_PUBLIC_URL",
  "QUAI_MAX_HOMES",
  "QUAI_HOME_ID",
  "QUAI_TZ",
  "QUAI_APNS_TOPIC",
  "QUAI_APNS_KEY",
  "QUAI_APNS_KEY_ID",
  "QUAI_APNS_TEAM_ID"
] as const satisfies ReadonlyArray<keyof CloudSettings>

/**
 * Node's heap limit, in MiB, for the `lite` instance (`wrangler.jsonc`: 256 MiB in all). Node doesn't size its heap to
 * the container: without a limit the heap grows until the container is killed; with one, the garbage collector works
 * harder first. The rest of the 256 MiB is for what lives outside the heap (code, buffers, the WebSocket frames).
 */
export const heapLimitMiB = 160

/**
 * The container's environment: Quai Cloud's own `QUAI_*` settings, the ones that are set and not
 * blank, and Node's heap limit. An unset APNs secret leaves Quai Cloud without pushes rather than with a broken key.
 */
export const containerEnvironment = (settings: CloudSettings): Record<string, string> => {
  const environment: Record<string, string> = {
    QUAI_PORT: "8787",
    NODE_OPTIONS: `--max-old-space-size=${heapLimitMiB}`
  }
  for (const name of names) {
    const value = settings[name]?.trim()
    if (value) environment[name] = value
  }
  return environment
}

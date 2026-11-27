import { type CloudLink, isHostedCloud } from "@quai/api"
import type { LinkStatus } from "../client.ts"

/**
 * Whether the Settings page has something to show: the Cloud isn't set yet, or it is one of the
 * user's own (its address, its push key, its public address). Quai's hosted Cloud has nothing to
 * set: what it says (linked, its version) is at the foot of the sidebar, what needs doing at the
 * top of every page. Unknown until Quai Home answered: shown, so the first page doesn't jump.
 */
export const needsSettings = (cloud: CloudLink | null): boolean =>
  cloud === null || !cloud.configured || !isHostedCloud(cloud)

/** "v0.12.1" for a release, the version as is otherwise ("dev"). */
export const versionLabel = (version: string) => /^\d/.test(version) ? `v${version}` : version

/** Where Quai Cloud stands, in the sidebar's words: its version while linked, else the link's state. */
export const cloudStateOf = (
  status: LinkStatus,
  cloud: CloudLink | null
): { readonly tone: "neutral" | "ok" | "warn" | "danger"; readonly text: string } => {
  if (cloud !== null && !cloud.configured) return { tone: "warn", text: "Not set" }
  if (status === "checking") return { tone: "neutral", text: "Checking…" }
  if (status === "offline") return { tone: "danger", text: "Not connected" }
  // An older Cloud doesn't say its version: linked all the same.
  return { tone: "ok", text: cloud?.version === undefined ? "Connected" : versionLabel(cloud.version) }
}

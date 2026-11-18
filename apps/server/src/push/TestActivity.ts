import type { DownloadContentState } from "@quai/api"
import type { Push } from "../engine/DownloadEngine.ts"

/** One beat of the demo: wait, then push. */
export interface Beat {
  readonly afterMs: number
  readonly push: Push
}

const megabytes = (n: number) => n * 1_048_576

/**
 * A fake download for the app's test button, about 45 s from search to ready. It goes through
 * the same per-iPhone filtering as real activities, so hidden steps stay hidden.
 */
export const testScript = (mediaKey: string): ReadonlyArray<Beat> => {
  const title = "Big Buck Bunny (test)"
  const content = (c: Omit<DownloadContentState, "stalled">): DownloadContentState => ({ ...c, stalled: false })
  const update = (afterMs: number, c: Omit<DownloadContentState, "stalled">): Beat => ({
    afterMs,
    push: { _tag: "Update", mediaKey, title, content: content(c) }
  })
  const progress = [0.08, 0.21, 0.37, 0.52, 0.68, 0.83, 0.95, 1]
  return [
    { afterMs: 0, push: { _tag: "Start", attributes: { mediaKey, title }, content: content({ step: "searching" }) } },
    update(5_000, { step: "downloading", progress: 0 }),
    ...progress.map((p, i) =>
      update(4_000, {
        step: "downloading",
        progress: p,
        bytesPerSecond: megabytes(9 + (i % 3) * 3),
        remainingSeconds: Math.round((1 - p) * 40)
      })
    ),
    update(3_000, { step: "importing" }),
    {
      afterMs: 5_000,
      push: { _tag: "End", mediaKey, content: content({ step: "available" }), dismissAt: 0 }
    }
  ]
}

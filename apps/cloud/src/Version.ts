import { Context, Layer } from "effect"

/** Facts about the running process, as a Layer so tests can pin them. */
export class ServerInfo extends Context.Service<ServerInfo, {
  readonly version: string
  readonly startedAt: number
}>()("quai/ServerInfo") {
  static readonly layer = Layer.sync(ServerInfo, () => ({
    version: process.env.QUAI_VERSION ?? "dev",
    startedAt: Date.now()
  }))
}

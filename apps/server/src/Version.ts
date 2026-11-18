import { Context, Layer } from "effect"

/** Infos sur le processus en cours ; un Layer pour pouvoir les figer en test. */
export class ServerInfo extends Context.Service<ServerInfo, {
  readonly version: string
  readonly startedAt: number
}>()("quai/ServerInfo") {
  static readonly layer = Layer.sync(ServerInfo, () => ({
    version: process.env.QUAI_VERSION ?? "dev",
    startedAt: Date.now()
  }))
}

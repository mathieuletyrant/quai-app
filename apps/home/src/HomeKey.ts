import { Context, Effect, FileSystem, Layer } from "effect"
import { HomeProtocol } from "@quai/api"
import { createHash, createHmac, createPrivateKey, createPublicKey, generateKeyPairSync, type KeyObject, sign } from "node:crypto"
import { dirname, join } from "node:path"
import { HomeConfig } from "./Config.ts"
import { HomeKeyError } from "./Errors.ts"

/** The home id: the fingerprint of its public key (SPKI DER, base64), first 32 hex chars of SHA-256. */
export const homeId = (publicKey: string) =>
  createHash("sha256").update(Buffer.from(publicKey, "base64")).digest("hex").slice(0, 32)

/**
 * The home's Ed25519 key pair, created on first start. It is the home's identity: the cloud
 * recognizes a home by a signed challenge, and Quai Home derives its other secrets from it.
 */
export class HomeKey extends Context.Service<HomeKey, {
  /** SPKI DER, base64, as Hello carries it. */
  readonly publicKey: string
  readonly homeId: string
  /** Signs a Challenge nonce (as `challengePayload`) and returns the signature (base64). */
  readonly sign: (nonce: string) => string
  /** The secret webhooks carry in their URL: stable across restarts, since the URL lives in Radarr and Sonarr. */
  readonly webhookToken: string
}>()("quai-home/HomeKey") {
  /** Reads the key at `path` (PEM), or creates it there (mode 0600). */
  static readonly make = (path: string) =>
    Effect.gen(function*() {
      const fs = yield* FileSystem.FileSystem
      const fail = (message: string) => (cause: unknown) => new HomeKeyError({ message, cause })
      const exists = yield* fs.exists(path).pipe(Effect.mapError(fail(`could not read ${path}`)))
      if (!exists) {
        const pem = yield* Effect.try({
          try: () => generateKeyPairSync("ed25519").privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
          catch: fail("could not create the home key")
        })
        yield* fs.makeDirectory(dirname(path), { recursive: true }).pipe(
          Effect.andThen(fs.writeFileString(path, pem, { flag: "wx", mode: 0o600 })),
          Effect.mapError(fail(`could not write ${path}`))
        )
        yield* Effect.logInfo("created the home key")
      }
      const pem = yield* fs.readFileString(path).pipe(Effect.mapError(fail(`could not read ${path}`)))
      const privateKey = yield* Effect.try({
        try: () => createPrivateKey(pem),
        catch: fail(`${path} is not a private key`)
      })
      if (privateKey.asymmetricKeyType !== "ed25519") {
        return yield* Effect.fail(new HomeKeyError({ message: `${path} is not an Ed25519 key` }))
      }
      return fromPrivateKey(privateKey)
    })

  static readonly layer = Layer.effect(
    HomeKey,
    Effect.gen(function*() {
      const { dataDir } = yield* HomeConfig
      return yield* HomeKey.make(join(dataDir, "home.key"))
    })
  )
}

const fromPrivateKey = (privateKey: KeyObject): HomeKey["Service"] => {
  const publicKey = createPublicKey(privateKey).export({ type: "spki", format: "der" }).toString("base64")
  const raw = Buffer.from(privateKey.export({ format: "jwk" }).d!, "base64url")
  return {
    publicKey,
    homeId: homeId(publicKey),
    sign: (nonce) => sign(null, Buffer.from(HomeProtocol.challengePayload(nonce)), privateKey).toString("base64"),
    webhookToken: createHmac("sha256", raw).update("webhooks").digest("hex").slice(0, 32)
  }
}

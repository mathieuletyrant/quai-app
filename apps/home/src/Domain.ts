import { HomeApp } from "@quai/domain/App.ts"
import { answerRelayed } from "@quai/domain/home/ConsoleRelay.ts"
import { HomeLink } from "@quai/domain/home/HomeLink.ts"
import { PublicAccess } from "@quai/domain/PublicAccess.ts"
import { Apns } from "@quai/domain/push/Apns.ts"
import { ServerInfo } from "@quai/domain/Version.ts"
import { Effect, Layer, Option, Redacted } from "effect"
import { HttpRouter } from "effect/http"
import { Link } from "./Link.ts"
import { LocalHome } from "./LocalHome.ts"

/** The topic the console shows while no Cloud has said its own. */
const defaultTopic = "com.mathieuletyrant.quai"

/**
 * The domain's pushes, sent by Quai Cloud with its key: Quai Home builds each one and asks for it
 * over the link. The key's settings are what the Cloud last said in its Welcome; with no Cloud
 * linked, no key.
 */
const CloudApns = Layer.effect(
  Apns,
  Effect.map(Effect.service(Link), (link): Apns["Service"] => ({
    configured: Effect.sync(() => link.welcome()?.push.configured ?? false),
    get settings() {
      return link.welcome()?.push ?? { configured: false, topic: defaultTopic }
    },
    send: link.push
  }))
)

/** How the app reaches Quai Cloud from outside, as the Cloud last said in its Welcome: for the pairing QR code. */
const CloudPublicAccess = Layer.effect(
  PublicAccess,
  Effect.map(Effect.service(Link), (link): PublicAccess["Service"] => {
    const current = () => {
      const access = link.welcome()?.publicAccess
      return PublicAccess.make(
        Option.fromNullishOr(access?.url),
        (access?.headers ?? []).map((header) => ({ name: header.name, value: Redacted.make(header.value) }))
      )
    }
    return {
      get url() {
        return current().url
      },
      get headers() {
        return current().headers
      },
      get settings() {
        return current().settings
      }
    }
  })
)

/**
 * Quai, run by Quai Home for its home (ADR 3): the domain's services and routes on the home
 * answered in place (`LocalHome`), with Quai Cloud for the pushes. Its routes are on a router of
 * their own, on no port: they answer the console's requests (`LocalHome.console`) and the app's,
 * which Quai Cloud relays over the link.
 */
export const DomainLive = Layer.effectDiscard(
  Effect.gen(function*() {
    const router = yield* HttpRouter.HttpRouter
    const link = yield* Link
    yield* link.answerApp((request) => answerRelayed(router, request, { fromConsole: false }))
  })
).pipe(
  Layer.provideMerge(HomeApp),
  // Its own router: Quai Home's port serves the webhooks, `/home-api` and the console's files on another.
  Layer.provide(Layer.fresh(HttpRouter.layer)),
  Layer.provide(Layer.mergeAll(
    Layer.effect(HomeLink, Effect.map(Effect.service(LocalHome), (local) => local.link)),
    CloudApns,
    CloudPublicAccess,
    ServerInfo.layer
  ))
)

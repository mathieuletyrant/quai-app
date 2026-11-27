import { describe, expect, it } from "@effect/vitest"
import { Schema } from "effect"
import * as HomeId from "../src/HomeId.ts"
import { HomeProtocol } from "../src/index.ts"

describe("home id", () => {
  it("is the first 32 hex chars of the SHA-256 of the public key (SPKI DER)", () => {
    // A fixed Ed25519 key, so the id can't change under a home that already linked with it.
    expect(HomeId.homeId("MCowBQYDK2VwAyEAGb9ECWmEzf6FQbrBZ9w7lshQhqowtrbLDFw4rXAxZuE=")).toBe(
      "a1e9156054e04fac899ae9f275132cdc"
    )
  })
})

describe("app relay", () => {
  it("relays the API's routes, never the console's nor a path that climbs out", () => {
    expect(HomeProtocol.isAppPath("/api/library")).toBe(true)
    expect(HomeProtocol.isAppPath("/api/upcoming?days=7")).toBe(true)
    expect(HomeProtocol.isAppPath("/console-api/devices")).toBe(false)
    expect(HomeProtocol.isAppPath("/api/../console-api/devices")).toBe(false)
    expect(HomeProtocol.isAppPath("/home")).toBe(false)
  })
})

describe("protocol", () => {
  it("a Cloud serves the Quai Homes that run Quai, from protocol 13 on", () => {
    expect(HomeProtocol.minProtocolVersion).toBe(13)
    expect(HomeProtocol.protocolVersion).toBeGreaterThanOrEqual(HomeProtocol.minProtocolVersion)
  })

  it("a Hello from protocol 13, with the services it no longer needs to say, still reads", () => {
    const hello = {
      _tag: "Hello",
      protocol: 13,
      homeVersion: "2.5.0",
      publicKey: "key",
      services: ["radarr"],
      webUrls: { radarr: ["http://umbrel.local:7878"] }
    }
    expect(Schema.decodeUnknownSync(HomeProtocol.HomeMessage)(hello)).toEqual({
      _tag: "Hello",
      protocol: 13,
      homeVersion: "2.5.0",
      publicKey: "key"
    })
  })
})

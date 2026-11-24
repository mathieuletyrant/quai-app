import { describe, expect, it } from "vitest"
import { containerEnvironment } from "../src/environment.ts"

describe("containerEnvironment", () => {
  it("passes Quai Cloud its settings and the port it listens on", () => {
    expect(containerEnvironment({
      QUAI_VERSION: "0.23.0",
      QUAI_PUBLIC_URL: "https://cloud.quai.stream",
      QUAI_MAX_HOMES: "25",
      QUAI_APNS_KEY: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      QUAI_APNS_KEY_ID: "ABCDE12345",
      QUAI_APNS_TEAM_ID: "FGHIJ67890",
    })).toEqual({
      QUAI_PORT: "8787",
      QUAI_VERSION: "0.23.0",
      QUAI_PUBLIC_URL: "https://cloud.quai.stream",
      QUAI_MAX_HOMES: "25",
      QUAI_APNS_KEY: "-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----",
      QUAI_APNS_KEY_ID: "ABCDE12345",
      QUAI_APNS_TEAM_ID: "FGHIJ67890",
    })
  })

  it("leaves out what is unset or blank, so Quai Cloud runs without pushes", () => {
    expect(containerEnvironment({ QUAI_APNS_KEY: "  ", QUAI_APNS_KEY_ID: "" })).toEqual({ QUAI_PORT: "8787" })
  })

  it("passes nothing that isn't a Quai Cloud setting", () => {
    const env = { QUAI_PUBLIC_URL: "https://cloud.quai.stream", CLOUDFLARE_API_TOKEN: "secret" }
    expect(containerEnvironment(env)).not.toHaveProperty("CLOUDFLARE_API_TOKEN")
  })
})

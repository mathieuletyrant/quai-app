// The hosted Quai Cloud on Cloudflare: one container running the generic `cloud` image, behind a
// Worker on cloud.quai.stream. Quai Cloud keeps its homes' links in memory, so every request goes
// to the same instance. A Quai Home's WebSocket keeps the container awake; with none open, it
// sleeps after an hour and starts again on the next request. The container and the Durable Object
// in front of it both stay in the EU. It stores nothing, so a restart only
// makes each Quai Home reconnect.
import { Container } from "@cloudflare/containers"
import { type CloudSettings, containerEnvironment } from "./environment.ts"

interface Env extends CloudSettings {
  readonly QUAI_CLOUD: DurableObjectNamespace<QuaiCloud>
}

export class QuaiCloud extends Container<Env> {
  override defaultPort = 8787
  override sleepAfter = "1h"
  override pingEndpoint = "localhost/api/health"

  // eslint-disable-next-line @typescript-eslint/no-empty-object-type -- the type Container's constructor takes
  constructor(ctx: DurableObjectState<{}>, env: Env) {
    super(ctx, env)
    this.envVars = containerEnvironment(env)
  }
}

export default {
  fetch: (request, env) => env.QUAI_CLOUD.jurisdiction("eu").getByName("quai-cloud").fetch(request)
} satisfies ExportedHandler<Env>

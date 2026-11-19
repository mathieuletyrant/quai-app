/** The Relay's version, sent in Hello so the Core can adapt to older Relays. Set by the image build. */
export const relayVersion = process.env.QUAI_VERSION ?? "dev"

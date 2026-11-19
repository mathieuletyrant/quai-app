/** The agent's version, sent in Hello so the cloud can adapt to older agents. Set by the image build. */
export const agentVersion = process.env.QUAI_VERSION ?? "dev"

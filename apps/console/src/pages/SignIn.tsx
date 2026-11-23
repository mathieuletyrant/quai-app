import { type FormEvent, useState } from "react"
import { callHome, refreshSession } from "../client.ts"
import { Button, CenteredCard, Code, ErrorCallout, Field, Input, Logo } from "../ui"

/** The console's password is Quai Home's `QUAI_HOME_PASSWORD`. */
export function SignInPage() {
  const [password, setPassword] = useState("")
  const [error, setError] = useState<unknown>(null)
  const [signingIn, setSigningIn] = useState(false)

  const signIn = async (event: FormEvent) => {
    event.preventDefault()
    setSigningIn(true)
    setError(null)
    try {
      await callHome((c) => c.session.signIn({ payload: { password } }))
      await refreshSession()
    } catch (e) {
      setError(e)
    } finally {
      setSigningIn(false)
    }
  }

  return (
    <CenteredCard title={<span className="flex items-center gap-3"><Logo />Quai</span>}>
      <form onSubmit={signIn} className="flex flex-col gap-4">
        <ErrorCallout error={error} />
        <Field label="Password" hint={<>Quai Home's <Code>QUAI_HOME_PASSWORD</Code>.</>}>
          <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus required />
        </Field>
        <Button type="submit" disabled={signingIn}>{signingIn ? "Signing in…" : "Sign in"}</Button>
      </form>
    </CenteredCard>
  )
}

/** No `QUAI_HOME_PASSWORD`: nothing to sign in with, and the console holds the services' keys. */
export function LockedPage() {
  return (
    <CenteredCard title={<span className="flex items-center gap-3"><Logo />Quai</span>}>
      <p className="text-body leading-relaxed text-muted">
        The console is locked until Quai Home has a password. Set <Code>QUAI_HOME_PASSWORD</Code> on Quai Home, restart it, then reload this page.
      </p>
    </CenteredCard>
  )
}

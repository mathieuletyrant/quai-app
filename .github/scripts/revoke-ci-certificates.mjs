// Revokes the development certificates Xcode creates on each CI run ("Created via API"): every
// fresh runner asks Apple for a new one to sign the archive, and the account allows only a few.
// Leaves every other certificate alone (yours, and the cloud-managed distribution one).
// Env: ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH (the .p8).
import { createSign } from "node:crypto"
import { readFileSync } from "node:fs"

const { ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_PATH } = process.env
const b64 = (data) => Buffer.from(data).toString("base64url")
const now = Math.floor(Date.now() / 1000)
const unsigned = `${b64(JSON.stringify({ alg: "ES256", kid: ASC_KEY_ID, typ: "JWT" }))}.${b64(JSON.stringify({ iss: ASC_ISSUER_ID, iat: now, exp: now + 600, aud: "appstoreconnect-v1" }))}`
const signature = createSign("SHA256").update(unsigned).sign({ key: readFileSync(ASC_KEY_PATH), dsaEncoding: "ieee-p1363" })
const headers = { Authorization: `Bearer ${unsigned}.${b64(signature)}` }
const api = "https://api.appstoreconnect.apple.com/v1/certificates"

const response = await fetch(`${api}?limit=200`, { headers })
if (!response.ok) throw new Error(`listing certificates: HTTP ${response.status} ${await response.text()}`)
const all = (await response.json()).data
for (const c of all) console.log(`${c.id} ${c.attributes.certificateType} name=${JSON.stringify(c.attributes.name)} displayName=${JSON.stringify(c.attributes.displayName)}`)
// Development certificates Xcode made through the API key; the Apple Developer site lists them as
// "Created via API". Distribution ones and the ones made by hand are never touched.
const createdByCi = (c) => [c.attributes.name, c.attributes.displayName].some((n) => /created via api/i.test(n ?? ""))
const ci = all.filter((c) => /DEVELOPMENT/.test(c.attributes.certificateType) && createdByCi(c))
for (const certificate of ci) {
  const revoked = await fetch(`${api}/${certificate.id}`, { method: "DELETE", headers })
  console.log(`${revoked.ok ? "revoked" : `could not revoke (HTTP ${revoked.status})`} ${certificate.id}, expiring ${certificate.attributes.expirationDate}`)
}
console.log(`${ci.length} CI development certificate(s) found.`)

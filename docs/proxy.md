# Quai Cloud behind a reverse proxy

At home the app talks to Quai Cloud on the local address the console was opened with
(`http://umbrel.local:3078`, say). Away from home it needs a public address: put Quai Cloud behind
a reverse proxy, and tell Quai about it with two variables.

| Env | |
|---|---|
| `QUAI_PUBLIC_URL` | The public address, e.g. `https://quai.example.com`. Added to the pairing QR code after the local one. |
| `QUAI_PUBLIC_HEADERS` | The headers the proxy requires from the app, if any. |

Nothing in Quai is tied to one proxy: any proxy that lets a client in with fixed request headers
works (Cloudflare Access service tokens, Pangolin, Authentik or Authelia header tokens, an nginx
`map` on a secret header…).

## What to expose

It depends on what the proxy checks.

- **The proxy guards every path** (Cloudflare Access, Authentik, Pangolin…): expose the whole of
  Quai Cloud. The app gets in with its access headers, and you can open the console from outside
  by signing in to the proxy (Google login, say). `/home` being reachable is harmless: nothing gets
  past the proxy without a login or the headers, and Quai Home connects on the home network anyway.
- **The proxy checks nothing** (a plain tunnel or port forward): expose **only `/api/*`**. It is
  what the app calls, and every route of it but `/api/health` and the pairing needs the device
  token. Keep `/console-api/*`, the console and `/home` on the home network: they have no login of
  their own and rely on the host's (Umbrel's at home), and whoever reaches them can pair an iPhone.

## `QUAI_PUBLIC_HEADERS`

`Name: value` pairs, separated by `;` or line breaks, so the whole list fits in one settings field:

```sh
QUAI_PUBLIC_HEADERS="CF-Access-Client-Id: 1a2b3c.access; CF-Access-Client-Secret: 4d5e6f…"
```

- A value can't hold a `;` or a line break; spaces around names and values are trimmed.
- Names are HTTP tokens (letters, digits, `-` and a few symbols). Each name once.
- Refused, because Quai or HTTP itself sets them: `Authorization` (the device token is
  `Authorization: Bearer`), `Proxy-Authorization`, `Host`, `Content-Type`, `Content-Length`,
  `Cookie`, and the hop-by-hop headers (`Connection`, `Keep-Alive`, `Transfer-Encoding`,
  `Upgrade`, `TE`, `Trailer`, `Expect`…).

A malformed value stops Quai Cloud at startup with a message naming the entry. Values are never
logged nor shown: the console's Settings page and pairing panel list the header names only.

### What the app does with them

- They travel in the pairing QR code (`quai://pair?…&header=Name%3A%20value`), with the addresses.
  Apps that predate them ignore that part.
- The app keeps them in the Keychain with its device token, and sends them on every request to
  Quai Cloud: the screens, the token reports, and the Live Activity buttons (Play/Pause, Stop),
  which run in the background.
- It sends them to every address it tries, the local one included. That is simpler than tying
  them to one address and harmless: Quai ignores them, and every address is already trusted with
  the device token, a bigger secret.
- When a request is refused by the proxy (a 401 or 403 that isn't Quai's JSON, or a login page),
  the app says "Blocked by your proxy: check the access headers" rather than a generic error.
- Settings → Connection lists the addresses and the header names, and lets the user add or remove
  headers by hand, for a proxy set up after pairing. Showing a new QR code in the console and
  pairing again brings them too.

## Example: Cloudflare Access with a service token

1. In Cloudflare Zero Trust, **Access → Service credentials → Service tokens**: create a token for
   Quai. Copy its Client ID and Client Secret (the secret is shown once).
2. **Access → Applications**: add a self-hosted application for `quai.example.com` (every path)
   with two policies: an **Allow** policy for you (your email, signed in with Google or any login
   method) to open the console, and a **Service Auth** policy whose rule includes that service
   token, for the app.
3. In the tunnel (**Networks → Tunnels → Public hostnames**), route `quai.example.com` to Quai
   Cloud (`http://<host>:8787`, the container's port, not one that goes through the host's own
   login).
4. Set on Quai Cloud and restart it:

   ```sh
   QUAI_PUBLIC_URL=https://quai.example.com
   QUAI_PUBLIC_HEADERS="CF-Access-Client-Id: <client id>; CF-Access-Client-Secret: <client secret>"
   ```

5. In the console, **iPhones → Pair an iPhone**: the panel says which access headers the code
   carries. Scan it. An iPhone already paired either pairs again, or gets the two headers typed in
   Settings → Connection → Access headers.

Check from outside: `curl https://quai.example.com/api/health` is refused, and the same with
`-H "CF-Access-Client-Id: …" -H "CF-Access-Client-Secret: …"` answers `{"status":"ok",…}`.

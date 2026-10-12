# @murkio/html

Murkio identity for the browser. It draws the login canvas your team designed in
the Murkio dashboard and runs the whole sign-in: password login, signup with the
email code, two-step verification, password reset and social sign-in. Plain web
components, so it works in any page; the React, Vue, Svelte, Angular and Next
packages are thin wrappers around it.

The only setting is your **publishable key** (`pk_...`). Add your site's origin to
the application's allowed origins in the dashboard.

## Plain HTML (script tag)

```html
<head>
  <script src="https://cdn.jsdelivr.net/npm/@murkio/html@0.1.0/dist/murkio.js"
          integrity="sha384-..." crossorigin="anonymous"
          data-murkio-key="pk_..." defer></script>
</head>
<body>
  <murkio-identity-canvas></murkio-identity-canvas>
</body>
```

Pin the exact version and its `integrity` (from `dist/sri.json` of that version):
the script runs on your login page.

Optional attributes on the script: `data-murkio-api` (API URL), `data-murkio-locale`,
`data-murkio-after-login` (where to go after signing in) and
`data-murkio-oauth-redirect` (social sign-in return URL; it must be in the
application's redirect URLs, and defaults to the current page).

The canvas comes signed by your application's key, and the SDK checks it against the
application's JWKS before drawing it. There is nothing to configure: a canvas that does not
verify is replaced by the default one. Once an application has sent a signature, an unsigned
canvas is refused, and so is an older version than the one already seen. To refuse an unsigned
canvas even the first time, add `data-murkio-require-signed-canvas` (or `requireSignedCanvas`
in `init()`). Browsers without Ed25519 in WebCrypto draw the canvas as received.

## Your own layout

Use the components and style them with your own classes (Tailwind works: the
`class` goes to the real `<input>`/`<button>`):

```html
<murkio-identity-email-input class="input" placeholder="you@example.com"></murkio-identity-email-input>
<murkio-identity-password-input class="input"></murkio-identity-password-input>
<murkio-identity-keep-logged label="Keep me signed in"></murkio-identity-keep-logged>
<murkio-identity-login-button class="btn">Sign in</murkio-identity-login-button>
<murkio-identity-register-button class="btn btn-ghost">Create account</murkio-identity-register-button>
<murkio-identity-error></murkio-identity-error>
```

Components on a page share one form; add `form="name"` to keep two forms apart.
The email-code, 2FA and reset screens open in a dialog with your canvas theme.

## JavaScript

```ts
import { init } from '@murkio/html';
import '@murkio/html/define'; // registers the <murkio-identity-*> elements

const murkio = init({ publishableKey: 'pk_...' });

murkio.onAuthChange((claims) => console.log(claims ? `signed in as ${claims.sub}` : 'signed out'));
const user = await murkio.getUser();            // email, roles, 2FA (POST /v1/me, cached)
const response = await murkio.fetch('/api/orders'); // your API, with Authorization: Bearer <access token>
await murkio.signOut();
```

Events (bubbling, composed) on the canvas and on the buttons: `murkio-login`,
`murkio-error` (`detail.code`), `murkio-step` (`detail.step`: `verify_email`,
`mfa`, `mfa_enroll`, `recovery_codes`, `forgot`, `reset`).

Canvas attributes: `screen="sign_up"`, `locale="pt-BR"`, `light-dom` (renders
without a shadow root, for password managers that do not look inside one).

## Sessions

- The tokens live in `localStorage`, one record shared by all tabs. Refreshes run
  once across tabs (Web Locks), because the API revokes a session whose refresh
  token is presented twice.
- **Keep me signed in** off: the session ends when the browser closes. The server
  session itself still lasts its full time; the SDK logs it out on the next visit.
- The access token is mirrored in a cookie (`__Host-murkio_session_<hash>`, 15 min)
  so your backend (`@murkio/node`, the Go SDK, `@murkio/next`) knows who is signed in
  when it renders a page. `cookieDomain` shares it with subdomains; only turn it on
  when every subdomain is yours, since any of them could then set that cookie.
- Tokens in `localStorage` can be read by a script injected into your page (XSS).
  Keep a strict Content Security Policy on the login page.

## Security of the canvas

The canvas is data, never code: the SDK checks it again before drawing (the same
rules as the server, `spec/canvas`), builds the DOM with `textContent` and the
CSSOM only, allows `https` links and images and site-relative links, and falls back
to the default canvas when the published one is not usable.

## Developing

```sh
npm ci     # also builds the package (the `prepare` script)
npm test
```

The tests read the contract, the vectors and the fixtures every Murkio SDK shares (the
native SDKs run the same cases), and the bundle carries the error translations and the
default canvas from them. That copy (`spec/`) and the checks in `infra/pipeline/` are kept
in the Murkio identity service and synced from there, so they are not edited here.

The backend SDKs pin the Subresource Integrity hash of `dist/murkio.js`
(`dist/sri.json`): a change to the bundle is followed by a sync in the identity service
(`node libs/scripts/sync-cdn.mjs`).

Every pull request runs the workflows in `.github/workflows`. The same checks, locally:

| Workflow | What it runs |
| --- | --- |
| Build | `npm run build`, `npm run package:check` (publint) and `npm pack --dry-run`, on Node.js 20 and 24 |
| Format | `npm run format:check` (Biome; `npm run format` fixes) |
| Lint | `npm run lint` (Biome), `npm run typecheck` (strict TypeScript) |
| Tests | `npm test` on Node.js 20 and 24 |
| Quality & Governance Checks | `for check in infra/pipeline/*.py; do python3 "$check"; done` |
| Security | `npm audit --omit=dev`, `npm audit --audit-level=high`, `npm audit signatures`, `gitleaks git .`, `zizmor --pedantic .` |
| CodeQL, Dependency Review | run by GitHub on the pull request |

Security reports: see [SECURITY.md](SECURITY.md).

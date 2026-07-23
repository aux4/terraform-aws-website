# package-seo — CloudFront Lambda@Edge (origin-request)

Injects per-package SEO metadata into the aux4 hub SPA shell on CloudFront
cache-miss for the `/r/public/packages/*` routes. CloudFront then caches the
generated response per-path, so the work runs at most once per package URL per
edge cache.

This exists because every hub package page serves the identical empty SPA shell
with the same `<title>aux4 hub — CLI Package Registry</title>`. Crawlers see 85
duplicate-titled pages. This function rewrites the shell's `<head>` (and,
optionally, injects the rendered README body) so each package page is unique and
indexable, without changing the client — the injected values mirror the
client-side react-helmet logic so the crawler-visible metadata and the hydrated
DOM agree.

## Handler contract

| | |
|---|---|
| Entrypoint | `index.handler` |
| Runtime | `nodejs20.x` (any Lambda@Edge-supported Node) |
| Trigger | CloudFront **origin-request** on the `/r/public/packages/*` cache behavior |
| Event | `event.Records[0].cf.request` |
| Env vars | **none** (Lambda@Edge forbids them — see Configuration below) |
| Dependencies | none (Node built-ins `https`/`http` only) |
| Failure mode | **fail open** — returns the original request unchanged on any error |

### Flow

1. Parse the request URI into `{ scope, name, version }`. Non-package paths,
   non-`GET`/`HEAD` methods, and malformed segments return the request unchanged
   (passthrough).
2. Concurrently fetch (`Promise.allSettled`):
   - the spec: `GET {apiBase}/packages/public/{scope}/{name}/{version}/spec`
   - the SPA shell: `index.html` from the CloudFront **origin** (S3), so the
     content-hashed Vite asset references are always current and never drift.
   - the README (best-effort): `.../spec/README.md`
3. If either the spec or the shell fetch fails, **return the request** (fail
   open). The README is optional; its failure is swallowed.
4. Inject into the shell `<head>` (rewriting existing tags in place — no
   duplicates):
   - unique `<title>` — `"{scope}/{name}[ · {version}] · aux4 hub"`
   - `<meta name="description">` — the spec description + install hint
   - `og:title` / `og:description` / `og:url`
   - `twitter:title` / `twitter:description` / `twitter:url`
   - `<link rel="canonical">` (version-less base URL)
   - a `SoftwareApplication` JSON-LD block (replaces the shell's site-level
     `WebApplication` block)
5. **Stretch:** the rendered README is appended as a hidden crawler-only
   `<div id="package-readme" hidden aria-hidden="true">…</div>` before `</body>`
   (React renders into `#root` and never touches this sibling).
6. Return a generated `200` response with
   `Cache-Control: public, max-age=3600` and an `X-Package-Seo: injected` marker
   header (used for deploy verification).

### Client parity (do not drift)

The title/description/canonical mirror the client so crawler + hydrated DOM
agree. Source of truth:

- `hub.aux4.io/src/component/WebsiteMetadata.jsx` — `addTitleSuffix` →
  `"{title} · aux4 hub"`
- `hub.aux4.io/src/page/PackagePage.jsx:107-113` — title, description
  (`{description} — Install with: aux4 aux4 pkger install {scope}/{name}`), and
  the version-less canonical URL.

The em-dash in the description is intentional — it matches the client string
verbatim so the two never diverge.

## Configuration (no env vars)

Config is baked into the code (`CONFIG` in `index.js`) with the production hub
values:

```js
apiBase:    "https://api.hub.aux4.io/v1"
siteOrigin: "https://hub.aux4.io"
```

To override without editing this file (e.g. to reuse the module for a dev
distribution), drop a `config.json` next to `index.js` inside the packaged zip:

```json
{
  "apiBase": "https://dev.api.hub.aux4.io/v1",
  "siteOrigin": "https://dev.hub.aux4.io"
}
```

`index.js` does `Object.assign(CONFIG, require("./config.json"))` inside a
try/catch, so the file is optional. This keeps the module generic without
templating a JS file full of `${…}` template literals.

## Packaging

The Terraform module (`../../package-seo-edge.tf`) builds the deployment zip at
plan time from this directory with `data "archive_file"`, so the artifact always
matches the source and no stale binary is ever committed to git
(`lambda-edge/package-seo.zip` is `.gitignore`d):

```hcl
data "archive_file" "package_seo_edge" {
  count       = var.enable_package_seo_edge ? 1 : 0
  type        = "zip"
  source_dir  = "${path.module}/lambda-edge/package-seo"
  excludes    = ["test", "test/**", "README.md", "package.json"]
  output_path = "${path.module}/lambda-edge/package-seo.zip"
}

# consumed by aws_lambda_function.package_seo_edge:
#   filename         = data.archive_file.package_seo_edge[0].output_path
#   source_code_hash = data.archive_file.package_seo_edge[0].output_base64sha256
```

Only `index.js` (and an optional `config.json`) ships in the zip; the `test/`,
`README.md`, and `package.json` are dev-only and excluded.

To build the zip by hand for local inspection (matching the tf output path):

```bash
cd lambda-edge/package-seo
zip -q ../package-seo.zip index.js
```

## Tests

Pure functions (path parsing, metadata assembly, HTML injection, markdown
rendering) are unit-tested with the Node built-in test runner — no dependencies:

```bash
cd lambda-edge/package-seo
node --test
```

The tests assert the duplicate-title killer (exactly one `<title>`, exactly one
JSON-LD block, no leftover `WebApplication`), attribute escaping, README safety
(raw HTML escaped, only `http(s)` links emitted), and client-parity of the
title/description/canonical strings.

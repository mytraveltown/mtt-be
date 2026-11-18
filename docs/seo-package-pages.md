# Package page link previews (server-side meta tags)

## Why

The frontend is a single-page app. WhatsApp, Facebook, LinkedIn and X do not run JavaScript
when they build a link preview, so they only see the default tags in `index.html`.
`GET /api/seo/package/:idOrSlug` returns the built `index.html` with the package's title,
description, canonical URL and Open Graph / Twitter tags already in the `<head>`.
The React app then loads as usual and its SEO component takes over the tags.

| Tag | Value |
| --- | --- |
| `<title>`, `og:title`, `twitter:title` | Package name + ` \| MyTravelTown` |
| `description`, `og:description`, `twitter:description` | Package description (plain text, first 160 characters), or a trip summary when empty |
| `og:image`, `twitter:image` | `https://mytraveltown.com/mytraveltown-logo.png` |

Only `published` packages get package tags. Drafts keep the site defaults, and unknown packages return 404 with the default page.

## Environment variables

| Name | Default | Purpose |
| --- | --- | --- |
| `FRONTEND_INDEX_PATH` | `/var/www/html/index.html` | Built frontend `index.html` used as the template |
| `FRONTEND_URL` | `https://mytraveltown.com` | Base for canonical, `og:url` and `og:image` |

The template is re-read only when the file changes, so a frontend deploy is picked up without restarting the backend.

## Apache (one-time server change)

Add this inside the site's `<VirtualHost *:443>`, before any SPA fallback rule.
It reuses the existing `/api` reverse proxy (`mod_proxy_http`). Replace `<PORT>` with the backend `PORT`.

```apache
RewriteEngine On
# Package pages: HTML with package meta tags, rendered by the backend
RewriteRule ^/package/([^/]+)/?$ http://127.0.0.1:<PORT>/api/seo/package/$1 [P,L]
```

`/package/:id/book` does not match and is still served by the SPA fallback. Then:

```bash
sudo apachectl configtest && sudo systemctl reload apache2
```

## Verify

```bash
curl -s https://mytraveltown.com/package/<slug> | grep -E 'og:(title|description|image)'
```

Then paste a package link into https://developers.facebook.com/tools/debug/ and click "Scrape Again" to refresh any cached preview.

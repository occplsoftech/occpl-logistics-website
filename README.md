# OCCPL Logistics website

The public website of **OCCPL Logistics Pvt. Ltd.** (pro.occpllogistics.com), redesigned in the same look as the
OCCPL staff app (crimson gradient, indigo accent, Outfit font), with **live tracking** from the OCCPL courier platform.

## Pages
Home · About · Services · Track (with **Scan to track**) · Branches · Customer Tools (volumetric weight, conversion
factors, rate enquiry) · Pickup Request · Business Opportunities · Careers · Contact · FAQ · Prohibited Items ·
Terms & Conditions · Privacy Policy · Pricing · Cancellation & Refund Policy · Shipping & Delivery Policy · 404. Content comes from the old WordPress site.

## How tracking works
The Track page calls the courier platform's **public** endpoints (no login, no keys):

| Action | Endpoint |
|---|---|
| Track | `GET /api/v1/track/{number}` (AWB or shipment number) |
| See full details / proof of delivery | `POST /api/v1/track/{number}/verify` `{ "phoneLast4": "1234" }` (receiver's mobile) |
| Raise a complaint | `POST /api/v1/track/{number}/tickets` `{ phoneLast4, subject, message }` (opens a ticket in the staff app) |

The browser calls `/api/v1/track/...` on the website's own domain; nginx forwards only that path to the backend
(`nginx.conf.template`), so the backend needs no CORS change. To call the backend directly instead, set `apiBase` in
`assets/js/config.js` and add the website's domain to the backend's allowed CORS origins.

**Rate calculator** (Customer Tools): `POST /api/v1/public/rates` `{ originPincode, destinationPincode, actualWeightKg, declaredValue }`
(optional `pieces`, `lengthCm`, `widthCm`, `heightCm`, `cod`) answers the zone tariff's options; 20 a minute per visitor.

**Old shipments:** when the courier platform answers 404, the page asks the old website's system through
`/api/old-track/{awb}` (nginx forwards it to `occplserver.azurewebsites.net/track-status`, 20 a minute per visitor) and shows the
same fields as the old website, **including the consignee's address, phone and proof photo, without verification**.

**Scan to track** opens the phone or laptop camera and reads the barcode / QR on the receipt or label. It uses the
browser's built-in barcode reader; browsers without one (e.g. iPhone Safari) load a ZXing-based reader from
cdn.jsdelivr.net the first time Scan is used. The camera needs HTTPS (or localhost).

Enquiry forms (rate, pickup, contact, partners, careers) open the visitor's email app addressed to
info@occpllogistics.com; the website stores nothing.

## Develop
```bash
node build.mjs          # src/layout.html + src/pages/*.html -> dist/ (clean URLs), sitemap.xml, robots.txt
node serve.mjs          # http://localhost:8080, tracking forwarded to COURIER_API (default the dev backend)
```
No dependencies. Edit pages in `src/pages/` (the first line is the page's title and description), styles in
`assets/css/site.css`, behaviour in `assets/js/site.js`.

## Deploy
```bash
docker build -t occpl-website --build-arg SITE_URL=https://pro.occpllogistics.com .
docker run -p 80:80 -e COURIER_API=https://<courier backend> -e COURIER_API_HOST=<courier backend host> occpl-website
```
Old WordPress addresses (`/about-us/`, `/contact-us/`, `/track-your-order/`, `/branch-locator/`, …) redirect to the
new pages.

### Dev server (pro.occpllogistics.com)
`deploy/docker-compose.yml` runs this site as its own Compose project (`occpl-website`) beside the courier platform and
publishes no ports. `deploy/pro-occpllogistics.caddy` is the platform Caddy's site block; add it only once the DNS A
record points at the server, and run `caddy validate` before reloading.

**Auto deploy:** cron on the server runs `deploy/auto-deploy.sh` every 2 minutes. When main changes it builds the image,
smoke-tests a candidate, switches, checks the public site and rolls back on failure. No keys or GitHub secrets.
The installed copies of the script and Compose file are in `~/occpl-website-auto/` and are **not** updated by merges:
copy them by hand after changing them here. There: `deployed` and `failed` hold commit SHAs (delete `failed` to retry) and `deploy.log`
is the log. To stop auto deploy, remove its line from `crontab -e`.

**Deploy on merge:** `.github/workflows/deploy.yml` runs on every push to main (or by hand from the Actions tab) and deploys
at once instead of waiting for cron. It connects with the `WEBSITE_DEPLOY_KEY` repository secret, whose public key is in the
server's `~/.ssh/authorized_keys` as `command="/home/occpl/occpl-website-auto/hook-deploy.sh",restrict`, so that key can
only start a deploy. `deploy/hook-deploy.sh` runs `auto-deploy.sh` (same lock as cron), then fails the job if main did not
go live. Without the secret the job skips and cron still deploys. The installed hook is a hand-made copy, like the others.

## SEO
The build adds canonical links, social tags, robots rules, the sitemap and JSON-LD (breadcrumbs, FAQ, services).
Change the domain with `SITE_URL`. 404 is `noindex`.

## Credits
India map outline: [svg-maps](https://github.com/VictorCazanave/svg-maps) by Victor Cazanave, CC BY 4.0.
Font: Outfit, SIL Open Font License (`assets/fonts/OFL.txt`).

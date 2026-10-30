# THRYFTLY

Storefront for THRYFTLY, which sells one-off reworked vintage. It's a small Node app with an admin panel, Razorpay checkout, Qikink print-on-demand fulfilment, and an AI try-on that runs on a local Ollama model.

| Part | Where |
|---|---|
| Exchanges, invoices | `exchange.html`, `invoice.html`, `src/invoice.js`, `src/pages.js` |
| Storefront (home, product, cart/checkout) | `index.html`, `product.html`, `checkout.html`, `src/main.js`, `src/checkout.js` |
| 3D scroll motion | GSAP ScrollTrigger in `src/main.js` (`SCRUB` sets how smooth it feels) |
| AI try-on | `src/tryon.js` (in-browser compositing) + `/api/tryon` (Ollama vision model) |
| Admin panel | `/admin` → `admin.html`, `src/admin.js` |
| API + server | `server/index.js` (Express), data in `DATA_DIR/db.json`, images in `DATA_DIR/uploads` |
| Integrations | `server/integrations.js`: Qikink, Razorpay, Ollama |

## Shopping features

What a customer gets, besides browsing, cart and checkout:

| Feature | Where | Set up in admin |
|---|---|---|
| **Search** with instant results (press `/` anywhere) | search icon in the header | — |
| **Filters** by size, colour, price and in-stock, plus "top rated" sort | Shop all | — |
| **Notify me** on a sold-out size: one email when it's back | product page, sold-out sizes | **Waitlist** tab (most-wanted sizes, CSV). Emails go out when you raise the stock in Products, and hourly |
| **Delivery estimate** ("get it by Fri 30 Oct – Thu 5 Nov") and a **PIN code check** that names the city | product page, checkout (PIN fills city + state) | Site content → Delivery promise |
| **Reviews** with stars, fit ("runs large"), verified-buyer badge and your replies; star ratings in Google results | product page → Reviews | **Reviews** tab. Buyers' reviews go live at once (switchable); others wait for you. Delivered emails ask for one |
| **Exchanges & returns portal**: pick the pieces, the reason and the new size | `/exchange.html`, linked from Track order, Account, footer and the delivered email | **Returns** tab: approve / reject / done, with a message that's emailed to the customer. Window in Site content (0 = off) |
| **Order progress** (confirmed → printing → shipped → delivered) and **invoice** download | Track order, Account | Site content → Invoices (legal name, GSTIN, GST rate) |
| **WhatsApp button** that opens a chat (with the product link on product pages) | bottom-right, every page | Site content → WhatsApp & popup (needs the WhatsApp number under Contact) |
| **Sign-up popup** for first-time visitors, shows the welcome code | after a delay, once per visitor | Site content → WhatsApp & popup (off by default) |
| Product page: details / shipping / exchanges / care in fold-outs, a sticky add-to-cart bar on phones | product page | Shipping and Returns text come from Pages |

**GST on invoices.** Prices include GST. With a rate set, each invoice line shows the taxable value and the tax inside it: CGST + SGST when the customer is in the same state as the address under Contact details, IGST otherwise. Rates for clothing depend on the price per piece; check the right setting with your accountant before turning it on.

## Before going live

- [ ] Admin → Site content: currency `INR` / `₹`, shipping fee, delivery days, exchange window, contact details (email, WhatsApp, address), invoice details.
- [ ] Admin → Pages: replace every `[bracket]` in the policies. Razorpay checks these before it activates live payments.
- [ ] Netlify environment variables (table below), with **live** Razorpay and Qikink keys, and `SITE_URL` set to the real domain.
- [ ] Razorpay webhook pointing at `/api/webhooks/razorpay`.
- [ ] Email: Admin → Site content → **Send me a test email**; then `npm run setup:auth` for the sign-in emails.
- [ ] Place one real order with a small amount, check it reaches Qikink, then refund it from Admin → Orders.
- [ ] Point an uptime monitor (UptimeRobot, Better Stack…) at `https://your-domain/api/health`. It answers `{"ok":true,…}` with which services are switched on.
- [ ] Google Search Console: submit `/sitemap.xml`. Merchant Center: add `/feeds/google.xml`.

Every push runs the build and `npm run check` on GitHub Actions (`.github/workflows/ci.yml`).

## Run locally

```bash
npm install
cp .env.example .env      # then fill it in (see below)
npm run dev               # site on http://localhost:5173, API on :3000
```

Admin panel: http://localhost:5173/admin. It uses the `ADMIN_PASSWORD` from `.env`.

## Production

```bash
npm ci
npm run build
NODE_ENV=production npm start         # serves dist/ + API on $PORT
```

Or use Docker. Keep `/data` on a volume, because it holds the database and uploaded images. The image has a health check on `/api/health`:

```bash
docker build -t thryftly .
docker run -d -p 3000:3000 --env-file .env -v thryftly-data:/data thryftly
```

Put it behind HTTPS (Caddy, nginx, or your host's proxy). In production the server refuses to start without `ADMIN_PASSWORD` and `SESSION_SECRET`.

## Deploy on Netlify + Supabase

Netlify serves the pages from `dist/` and runs the API as one function (`netlify/functions/api.mjs`). Netlify has no permanent disk, so the database and images live in **Supabase** (one table plus one Storage bucket). Both free tiers are enough to start with.

**1. Supabase (Thryftly's account)**
1. Create a project. Region: Mumbai (ap-south-1).
2. Open **SQL Editor**, paste [supabase/schema.sql](supabase/schema.sql) and press **Run**. This creates the `thryftly` table and the public `uploads` image bucket.
3. Go to **Project Settings → API Keys** and copy the **Project URL** and a **secret key** (`sb_secret_…`, or the legacy `service_role` key). The secret key stays on the server only: never put it in front-end code or share it.

**2. Copy the current shop into Supabase (once, from this computer)**
1. Add `SUPABASE_URL=…` and `SUPABASE_SECRET_KEY=…` to `.env`.
2. Run `npm run push:supabase`. It uploads every image in `data/uploads` (about 1,370 files, 93 MB) and every product, setting, page, drop and order in `data/db.json`. Running it again skips images that are already there and makes Supabase match this computer again.
3. From now on, Supabase is the shop's data. While those two lines are in `.env`, `npm run dev` on this computer also works on the live data. Remove them to go back to the local `data/` folder.

**3. Netlify (Thryftly's account)**
1. **Add new site → Import an existing project →** GitHub → `thryftly-arch/Thryftly-Web-App`. The build settings come from `netlify.toml`, so leave them as they are.
2. Before the first deploy, add these in **Site configuration → Environment variables**:

| Variable | Value |
|---|---|
| `ADMIN_PASSWORD` | the admin password (the one in your local `.env`) |
| `SESSION_SECRET` | a random 96-character string (the one in your local `.env`) |
| `SUPABASE_URL` | from step 1 |
| `SUPABASE_SECRET_KEY` | from step 1 |
| `SUPABASE_PUBLISHABLE_KEY` | from step 1 (`sb_publishable_…`): turns on customer accounts |
| `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM`, `OWNER_EMAIL` | see **Emails** below |
| `SITE_URL` | `https://your-domain`, no trailing slash |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Razorpay dashboard |
| `QIKINK_BASE_URL`, `QIKINK_CLIENT_ID`, `QIKINK_CLIENT_SECRET` | Qikink dashboard (live: `https://api.qikink.com`) |

3. Deploy. Then in Razorpay, point the webhook to `https://your-domain/api/webhooks/razorpay`.
4. Open `https://your-domain/admin` and sign in with `ADMIN_PASSWORD`. To change the password, edit the variable in Netlify and redeploy.

**4. Customer accounts (Supabase Auth)**
Customers sign in on `/account.html` with email and password. Supabase stores and checks the passwords; this site never sees them. Signed-in customers get their saved pieces on every device and a list of their orders with a **Reorder** button. Orders placed while signed in are linked to the account. Earlier guest orders show up too, once the customer has confirmed their email.
1. In Supabase, open **Authentication → URL Configuration**. Set **Site URL** to your site address and add `https://your-domain/account.html` and `http://localhost:5173/account.html` under **Redirect URLs**.
2. **Emails.** Supabase's built-in mailer only sends to your own team's addresses and only a few per hour, so customers won't receive confirmation or reset emails until you add your own SMTP. Go to **Authentication → Emails → SMTP Settings**; the free tiers of Resend or Brevo work. Until then, turn **Confirm email** off (**Authentication → Sign In / Providers → Email**) so people can sign up and sign in straight away. Note that "forgot password" won't deliver without SMTP.
3. Optional later: **Google sign-in** is a provider switch in the same place.

**5. Speed**
- Product data is cached at Netlify's edge for a minute and refreshed in the background, so pages don't wait on the function or the database. Admin saves clear that cache straight away.
- Images load straight from Supabase's CDN.
- In Netlify, go to **Site configuration → Functions → Region** and pick **Mumbai (ap-south-1)**, next to the Supabase database, if your plan offers it. The default region is in the US, which adds about 0.5 s every time the function talks to the database.

What's different on Netlify:
- **Shopify import is turned off.** It copies images for minutes, and a Netlify function stops after about 10 seconds. Run imports from your computer with the Supabase lines in `.env` (`npm run dev` → `localhost:5173/admin`); they land straight in the live shop. Adding and editing products, image uploads (up to about 5 MB each), drops, pages and orders all work on the live site.
- **The AI stylist is off**, because Ollama can't run on Netlify. Try-on still places the garment over the customer's photo. To turn the stylist on, run Ollama on a machine you control and set `OLLAMA_URL` to its address.
- The WooCommerce receiver logs go to Netlify's function log, not to `data/woo-log.jsonl`.

`npm run check` tests payments, imports, reviews, back-in-stock alerts, exchanges, and the Supabase backend and the Netlify function against a fake Supabase on localhost (reads, changed-rows-only saves, deletes, image uploads, admin sign-in).

## Emails (from thryftly@gmail.com)

Every email the shop sends comes from your own address, in the THRYFTLY style:

| Email | Goes to | When |
|---|---|---|
| Order confirmed | customer | payment goes through |
| New order | you (`OWNER_EMAIL`) | payment goes through, with a warning if it didn't reach Qikink |
| Shipped, with tracking link | customer | Qikink adds tracking (checked every hour) |
| Delivered, with exchange + review links | customer | Qikink marks it delivered |
| Back in stock | customer | a size they asked about can be bought again |
| Exchange request received / decision | customer | they send a request / you approve, reject or finish it in Admin → Returns |
| New exchange request | you | a customer sends one |
| Refund | customer | you press **Cancel & refund** in Admin → Orders |
| Welcome + code | customer | first time they open their account |
| Drop list welcome + code | subscriber | they join the drop list (has an unsubscribe link) |
| Message received / new message | customer / you | contact form |
| You left something behind | customer | checkout started, not paid, 1–72 h ago (once; the link restores the cart) |
| Confirm email, reset password, magic link, email change | customer | Supabase Auth, same design (see below) |

**Gmail setup (about 5 minutes):**
1. Sign in to thryftly@gmail.com. Go to **Google Account → Security** and turn on **2-Step Verification**.
2. Go to **Security → App passwords** (or search "App passwords"), create one named "THRYFTLY site", and copy the 16-character password.
3. Add these to `.env` and to Netlify's environment variables:
   `SMTP_USER=thryftly@gmail.com`, `SMTP_PASS=<the app password>`, `MAIL_FROM=THRYFTLY <thryftly@gmail.com>`, `OWNER_EMAIL=<where order alerts should go>`.
4. Admin → Site content → **Send me a test email**.

Gmail allows about 500 emails a day. If you outgrow that or want a @thryftly.in address, switch to a domain email with Resend, Brevo or Zoho: only `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER` and `SMTP_PASS` change.

**Supabase sign-up emails (confirm link went to localhost, sender was Supabase):** both are Supabase settings. One command sets them all:
1. Create a personal access token at supabase.com/dashboard/account/tokens and put it in `.env` as `SUPABASE_ACCESS_TOKEN` (local only, never on Netlify).
2. Set `SITE_URL` in `.env` to the live address, and fill in the SMTP lines above.
3. Run `npm run setup:auth`. It sets the Site URL and allowed redirect links, makes Supabase send through thryftly@gmail.com, and installs the branded templates.

Without a token, `npm run setup:auth` writes the templates to `supabase/templates/`. Then do it by hand in Supabase:
- **Authentication → URL Configuration:** set Site URL to your live address, and add `https://<site>/account.html` under Redirect URLs.
- **Authentication → Emails → SMTP Settings:** host `smtp.gmail.com`, port `465`, username thryftly@gmail.com, the app password, sender THRYFTLY.
- **Authentication → Emails → Templates:** paste each file in.

## Moved over from Shopify

Your Shopify export used these, and they all exist here now:
- **Size charts:** the 8 chart types (terry, oversized hoodie, hoodie, zip hoodie, oversized sweatshirt, oversized shirt, classic, acid wash) are under Admin → **Size charts**, already linked to the 76 products that had them. The images lived in the Shopify theme, so upload each chart once; the SIZE CHART button appears on product pages as soon as a chart has an image.
- **Discount codes:** Admin → **Discounts** (percentage, fixed amount, free shipping, minimum order, total uses, once per customer, start/end dates). Shopify links like `/discount/WELCOME10` still work. Recreate **WELCOME10** there with the same terms you had on Shopify, and set it as the welcome code under Site content → Emails.
- **Old links:** `/products/<handle>`, `/collections/…`, `/pages/…`, `/policies/…`, `/cart` and `/account` redirect (301) to the new pages, so Google rankings, Instagram bios and old WhatsApp links keep working.
- **SEO:** `/sitemap.xml` and `/robots.txt`. Product pages carry their title, description, photo, price and Google Product data (from each product's SEO fields), so links shared on WhatsApp and Instagram show a proper preview.
- **Google Shopping:** a Merchant Center feed at `/feeds/google.xml` (every colour × size, with the Google categories from Shopify). In Merchant Center, add it as a scheduled-fetch feed.
- **Analytics:** paste your GA4 ID and Meta Pixel ID in Admin → Site content → Analytics. Page views, product views, add to cart, checkout and purchases are tracked.
- **Customers:** Admin → **Customers** lists everyone who has ordered, made an account or joined the drop list, with orders and total spent. Exports to CSV, and so do orders.
- **Refunds:** Admin → Orders → **Cancel & refund** refunds through Razorpay and emails the customer.

Not carried over: the review fields (empty on every product), gift cards (none), and the "conversation starters" app.

## Setting up each integration

### Payments: Razorpay
1. In the Razorpay Dashboard, go to **Settings → API Keys** and generate a key pair. Test keys start with `rzp_test_`. Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
2. Go to **Settings → Webhooks** and add `https://YOUR-DOMAIN/api/webhooks/razorpay` with the events `payment.captured` and `order.paid`. Set the same secret as `RAZORPAY_WEBHOOK_SECRET`. The webhook confirms the order even if the customer closes the tab right after paying.
3. In Admin → Site content, set the currency to `INR` and the symbol to `₹`. USD only works if international payments are enabled on your Razorpay account.

Prices are always recalculated on the server. Payments are only accepted with a valid Razorpay signature, and `npm run check` tests that signature check.

### Moving off Shopify (do this before closing the store)
1. In Shopify Admin → **Products → Export**, choose **All products**, and export as a **CSV for Excel, Numbers, or other spreadsheet programs**.
2. In this admin, go to Products → **Import Shopify CSV**.

Your real export (144 products, 4,577 variants, about 1,370 images) imports in roughly 4 minutes. Images are fetched as 1600px WebP, about 90 MB in total. Every product comes across with its description, colours, sizes, the variant SKUs Qikink created when it pushed the product, prices (including higher prices on bigger sizes), the gallery images and a mockup for each colour. Images are **copied onto this server**, because Shopify's image links stop working once the store closes. Re-importing updates existing products without downloading the same images again. Products that were active on Shopify, with a SKU on every variant, go live straight away.

Qikink's SKUs are its own random IDs (e.g. `v-9xuj1CC…`), not a pattern, so they can't be generated for new products; they have to come from Qikink. New products after the move: create the product in Qikink, then in Admin → Products add it with **+ New product**. Use **Make colour × size rows**, paste the SKUs from Qikink, and upload the mockups. Each colour has its own image slot.

### Fulfilment: Qikink
Qikink's API ([docs](https://documenter.getpostman.com/view/26157218/2sBYAysUHS)) only covers authentication and orders. There is **no product catalogue endpoint**, so products are brought in like this:
1. In the Qikink dashboard, export **My Products** as a CSV. Go to Admin → Products → **Import Qikink CSV**. Each product is created **hidden**, with its name, selling price, size range, print type and Qikink cost (the admin shows your margin). Importing the same file again skips products that are already there.
2. The CSV has no colour names and no per-variant SKUs. Open each imported product, type its colours and press **Make colour × size rows**, then paste each variant's SKU from Qikink. Customers can't buy a variant without a SKU.
3. Tick **Live on site**.

When an order is paid, it goes to Qikink as a prepaid order. The order number is 14 characters of `a-z0-9`, within Qikink's 15-character limit, and the address is merged into Qikink's single 90-character address line. If sending fails, the order shows **FULFILMENT FAILED** in Admin → Orders with the reason and a **RETRY** button. **Sync Qikink status** fetches each order's status and courier tracking link.

`QIKINK_BASE_URL` is `https://sandbox.qikink.com` for testing and `https://api.qikink.com` for live. The `client_secret` is different for sandbox and live, while the ClientId is the same. Live API access has to be requested in the Qikink dashboard under Integration → Custom API. The rate limit is 60 requests per minute.

**Qikink "Push to store" through a WordPress bridge (new products, the Shopify way).** Qikink pushes only to Shopify or WooCommerce, and connecting this site to Qikink directly stops at Cloudflare's bot check on Qikink's side. So a small WordPress + WooCommerce site with Qikink's official plugin receives the pushes, and this shop reads new products from it every hour (or Admin → QIKINK PUSH → **Sync now**). They arrive hidden, with colours, sizes, Qikink SKUs, prices and mockups (mockups are copied into this shop's storage). Paid orders still go straight to Qikink from this shop, so the WordPress site never gets an order and nothing is printed twice.
1. Get a small WordPress site with HTTPS on any host; a subdomain like `sync.yourdomain` is ideal. Customers never see it.
2. Install **WooCommerce** and Qikink's plugin (**Qikink – Print on Demand & Drop Shipping**). In Settings → Permalinks pick anything except "Plain".
3. In the Qikink plugin page, log in with your Qikink email and OTP, then press **Approve**.
4. WooCommerce → Settings → Advanced → REST API → **Add key** with **Read** permission.
5. In Netlify add `WC_URL` (the WordPress address), `WC_KEY` and `WC_SECRET`, then redeploy. Admin → QIKINK PUSH should say CONNECTED.
6. In Qikink → My Products, push products to the WooCommerce store, then **Sync now** (or wait for the hourly sync) and tick them Live in Products.

### AI try-on: Ollama, no API keys
The garment cut-out is placed over the customer's photo in the browser. Nothing is uploaded until they press **Ask the AI stylist**. That sends the combined image to a local Ollama vision model, which replies with fit and styling notes.

```bash
ollama pull gemma3:4b     # or any vision model; set OLLAMA_MODEL to match
```

Ollama has to be reachable from the server (`OLLAMA_URL`). If it's down, try-on still works; only the stylist notes are switched off. For the best results, upload a transparent PNG of each garment in the product's **Try-on cut-out** slot.

Ollama models can't generate photoreal try-on images. That would need a dedicated diffusion try-on model (such as IDM-VTON) running on a GPU server, and could be added behind the same `/api/tryon` endpoint later.

## 3D garment models (switched off)
The 3D viewer is off (`USE_3D = false` in `src/main.js`), so these models in `public/models/` aren't shown and need no credit on the site. If you switch it back on, their CC BY 4.0 licence requires this credit somewhere visible (it used to sit under the footer):

> 3D garments: "T Shirt" by funlab117 (https://sketchfab.com/3d-models/t-shirt-c1a3e5eb9b5445f4b7d4be82f1127eba), "Oversized hoodie" by Mug (https://sketchfab.com/3d-models/oversized-hoodie-4f687fc4c4714de2a721e1aab2020fc8), "SWEATSHIRT" by CONCEAL (https://sketchfab.com/3d-models/sweatshirt-7c442e696c96455d848d964e79e29464). CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/), simplified and recoloured.

## Known limits
- Local mode keeps the database in one JSON file that is rewritten on every change, which is fine for one server process. In Supabase mode, each request reloads the whole shop (one quick query) and saves only the rows that changed. That holds up to a few thousand orders; past that, the routes should query only what they need.
- If two customers pay for the same last item at the same moment, the second order is flagged **OVERSOLD** in Admin, and you refund it from Razorpay.

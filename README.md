# THRYFTLY

Storefront for THRYFTLY, which sells one-off reworked vintage. It's a small Node app with an admin panel, Razorpay checkout, Qikink print-on-demand fulfilment, and an AI try-on that runs on a local Ollama model.

| Part | Where |
|---|---|
| Storefront (home, product, cart/checkout) | `index.html`, `product.html`, `checkout.html`, `src/main.js`, `src/checkout.js` |
| 3D scroll motion | GSAP ScrollTrigger in `src/main.js` (`SCRUB` sets how smooth it feels) |
| AI try-on | `src/tryon.js` (in-browser compositing) + `/api/tryon` (Ollama vision model) |
| Admin panel | `/admin` → `admin.html`, `src/admin.js` |
| API + server | `server/index.js` (Express), data in `DATA_DIR/db.json`, images in `DATA_DIR/uploads` |
| Integrations | `server/integrations.js`: Qikink, Razorpay, Ollama |

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

Or use Docker. Keep `/data` on a volume, because it holds the database and uploaded images:

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
| `SITE_URL` | `https://your-domain`, no trailing slash |
| `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET` | Razorpay dashboard |
| `QIKINK_BASE_URL`, `QIKINK_CLIENT_ID`, `QIKINK_CLIENT_SECRET` | Qikink dashboard (live: `https://api.qikink.com`) |

3. Deploy. Then in Razorpay, point the webhook to `https://your-domain/api/webhooks/razorpay`.
4. Open `https://your-domain/admin` and sign in with `ADMIN_PASSWORD`. To change the password, edit the variable in Netlify and redeploy.

What's different on Netlify:
- **Shopify import is turned off.** It copies images for minutes, and a Netlify function stops after about 10 seconds. Run imports from your computer with the Supabase lines in `.env` (`npm run dev` → `localhost:5173/admin`); they land straight in the live shop. Adding and editing products, image uploads (up to about 5 MB each), drops, pages and orders all work on the live site.
- **The AI stylist is off**, because Ollama can't run on Netlify. Try-on still places the garment over the customer's photo. To turn the stylist on, run Ollama on a machine you control and set `OLLAMA_URL` to its address.
- The WooCommerce receiver logs go to Netlify's function log, not to `data/woo-log.jsonl`.

`npm run check` tests the Supabase backend and the Netlify function against a fake Supabase on localhost (reads, changed-rows-only saves, deletes, image uploads, admin sign-in).

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

**Experimental: Qikink "Push to store".** The site can pose as a WooCommerce store so Qikink pushes new products (colours, sizes, SKUs, mockups) straight in, hidden until you tick Live. It hasn't been tested against a live Qikink account yet. See [docs/qikink-woocommerce.md](docs/qikink-woocommerce.md).

### AI try-on: Ollama, no API keys
The garment cut-out is placed over the customer's photo in the browser. Nothing is uploaded until they press **Ask the AI stylist**. That sends the combined image to a local Ollama vision model, which replies with fit and styling notes.

```bash
ollama pull gemma3:4b     # or any vision model; set OLLAMA_MODEL to match
```

Ollama has to be reachable from the server (`OLLAMA_URL`). If it's down, try-on still works; only the stylist notes are switched off. For the best results, upload a transparent PNG of each garment in the product's **Try-on cut-out** slot.

Ollama models can't generate photoreal try-on images. That would need a dedicated diffusion try-on model (such as IDM-VTON) running on a GPU server, and could be added behind the same `/api/tryon` endpoint later.

## Known limits
- Local mode keeps the database in one JSON file that is rewritten on every change, which is fine for one server process. In Supabase mode, each request reloads the whole shop (one quick query) and saves only the rows that changed. That holds up to a few thousand orders; past that, the routes should query only what they need.
- If two customers pay for the same last item at the same moment, the second order is flagged **OVERSOLD** in Admin, and you refund it from Razorpay.
- Order confirmation emails are not sent yet. Razorpay can email receipts: turn that on in its dashboard.

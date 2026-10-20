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

## Setting up each integration

### Payments: Razorpay
1. In the Razorpay Dashboard, go to **Settings → API Keys** and generate a key pair. Test keys start with `rzp_test_`. Set `RAZORPAY_KEY_ID` and `RAZORPAY_KEY_SECRET`.
2. Go to **Settings → Webhooks** and add `https://YOUR-DOMAIN/api/webhooks/razorpay` with the events `payment.captured` and `order.paid`. Set the same secret as `RAZORPAY_WEBHOOK_SECRET`. The webhook confirms the order even if the customer closes the tab right after paying.
3. In Admin → Site content, set the currency to `INR` and the symbol to `₹`. USD only works if international payments are enabled on your Razorpay account.

Prices are always recalculated on the server. Payments are only accepted with a valid Razorpay signature, and `npm run check` tests that signature check.

### Fulfilment: Qikink
Qikink's API covers authentication and orders only. It has **no product catalogue endpoint**. So:
1. Create and list your products in Qikink as usual ("My Products").
2. In Admin → Products, give each size the **SKU of the matching Qikink product**.
3. When an order is paid, it goes to Qikink automatically as a prepaid order. If that fails (for example a missing SKU), the order shows **FULFILMENT FAILED** in Admin → Orders with the reason and a **RETRY** button.

`QIKINK_BASE_URL` is `https://sandbox.qikink.com` for testing and `https://api.qikink.com` for live orders. The admin header shows which one is active.

### AI try-on: Ollama, no API keys
The garment cut-out is placed over the customer's photo in the browser. Nothing is uploaded until they press **Ask the AI stylist**. That sends the combined image to a local Ollama vision model, which replies with fit and styling notes.

```bash
ollama pull gemma3:4b     # or any vision model; set OLLAMA_MODEL to match
```

Ollama has to be reachable from the server (`OLLAMA_URL`). If it's down, try-on still works; only the stylist notes are switched off. For the best results, upload a transparent PNG of each garment in the product's **Try-on cut-out** slot.

Ollama models can't generate photoreal try-on images. That would need a dedicated diffusion try-on model (such as IDM-VTON) running on a GPU server, and could be added behind the same `/api/tryon` endpoint later.

## Known limits
- The database is a single JSON file that is rewritten on every change. That's fine for one server process and a boutique-sized catalogue. Move to Postgres or SQLite if you run several instances or have tens of thousands of orders.
- If two customers pay for the same last item at the same moment, the second order is flagged **OVERSOLD** in Admin, and you refund it from Razorpay.
- Order confirmation emails are not sent yet. Razorpay can email receipts: turn that on in its dashboard.

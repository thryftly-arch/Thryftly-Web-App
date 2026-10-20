# Qikink → THRYFTLY via a fake WooCommerce store

Goal: Qikink's **Push to store** button sends new products straight into this site, the way it did with Shopify, so nobody types colours or SKUs.

## Verdict: conditional GO

**Go** to build a small WooCommerce-compatible receiver and try it with the live Qikink account. It's about 200 lines, and if Qikink rejects it nothing else in the app is affected.

It's only *conditional* because the second half, the requests Qikink sends when it pushes a product, is not published anywhere. The receiver is built to WooCommerce's public REST v3 schema and **logs every request it gets**. The first real push will show whether it works.

If Qikink refuses the connection, the fallback is safe: run a throwaway WordPress + WooCommerce install with the real plugin, let Qikink push into it, and import from its REST API (same mapping code). The CSV/Shopify imports keep working either way.

## What the plugin actually does (v1.1.2, read from SVN trunk + tags/1.1.2; the two are identical apart from the version header)

The plugin is ~200 lines of PHP (`huepress.php`, `Qikink.js`). It does **not** talk to WooCommerce's product code at all. Its only job is to hand the store URL and API keys to Qikink:

1. **Status check** (every time the admin page opens): `POST https://fulfilment.qikink.com/index.php/autoc/check_install`, form field `encrypted_data` = encrypt(`{"Store_URL": get_site_url()}`). A reply with `client_id` (+ `client_business_name`) means the store is already connected.
2. **Username**: the owner types their Qikink login. The field says "username", but the plugin runs it through `sanitize_email`, so in practice it is the account **email**. `POST …/autoc/wp_plugin`, `encrypted_data` = encrypt(`{"EmailId": <username>, "store_url": get_site_url()}`). Reply `{status, client_id}` or `{status:false, msg}`. Qikink emails an OTP.
3. **OTP**: `POST …/autoc/wp_plugin_otp`, `encrypted_data` = encrypt(`{"otp", "client_id"}`). Reply `{status}`.
4. **Keys**: the browser opens WooCommerce's own key-granting page:
   `{site}/wc-auth/v1/authorize?app_name=Qikink&scope=read_write&user_id=<client_id>&return_url={site}/wp-admin/admin.php?page=qikink&callback_url=https://fulfilment.qikink.com/index.php/Autoc/get_woocommerce_keys`
   When the owner clicks Approve, **WooCommerce core** (not the plugin) creates a read/write key and `POST`s JSON to the callback URL:
   `{"key_id": n, "user_id": "<client_id>", "consumer_key": "ck_…", "consumer_secret": "cs_…", "key_permissions": "read_write"}`.
   This is WooCommerce's documented [app auth endpoint](https://woocommerce.github.io/woocommerce-rest-api-docs/#authentication-endpoint).
5. On deactivation: `POST …/autoc/wordpress_uninstall` with the encrypted `Store_URL`.

The "encryption" is `openssl_encrypt(json, 'AES-128-CTR', 'qikinkhuepress', 0, '8929770667187677')`, with the key and IV hard-coded in the GPL source. So it's base64 AES-128-CTR, key `qikinkhuepress` NUL-padded to 16 bytes. All four calls are made server-side by WordPress, so our Express server can make exactly the same calls.

**Answers to the specific questions:**
- *How are the URL + keys handed over?* An encrypted server-to-server POST for the URL and username, then WooCommerce's standard `wc-auth/v1/authorize` → JSON POST of `consumer_key`/`consumer_secret` to Qikink's callback. No OAuth redirect to qikink.com.
- *How does Qikink authenticate afterwards?* **Not visible**: that code runs on Qikink's servers. WooCommerce accepts HTTP Basic (`ck:cs`) or `?consumer_key=&consumer_secret=` over HTTPS, and OAuth 1.0a only over plain HTTP. Qikink's backend is PHP/CodeIgniter, and the usual PHP client (`automattic/woocommerce`) uses Basic auth over HTTPS. The receiver accepts both HTTPS methods.
- *Which REST endpoints does Qikink call to push?* **Not documented.** Qikink's help pages ([integrate](https://qikink.com/help/integrations/integrating-your-woocommerce-store/), [push products](https://qikink.com/help/integrations/push-products-to-your-shopify-or-woo-commerce-store/)) only say that sizes and colours sync as variants and that orders sync back. The standard way any WooCommerce integrator does this, and so what the receiver implements, is:
  - `POST /wp-json/wc/v3/products`: `{name, type:"variable", status, description, short_description, regular_price?, sku?, categories:[{id}|{name}], tags, images:[{src}], attributes:[{name|id, options:[…], variation:true, visible:true}]}`
  - `POST /wp-json/wc/v3/products/{id}/variations` (or `/variations/batch` `{create:[…]}`): `{sku, regular_price, attributes:[{name|id, option}], image:{src}, manage_stock, stock_quantity}`
  - possibly `products/attributes` (+ `/terms`), `products/categories`, `products/tags`, `system_status`, `webhooks`, and `GET orders` for order sync.

## Risks

1. **Undocumented and unverified.** Push request shapes are a best guess from the WooCommerce schema. The receiver logs every call to `data/woo-log.jsonl`, so one real push shows what Qikink really sends, and the mapping can be adjusted if needed.
2. **Qikink may check that it's really WordPress.** For example it could fetch `/wp-json/`, `/wp-json/wc/v3/system_status` or `X-WP-Total` headers, or look at the `Server` and HTML of the home page. The receiver answers the first three. If Qikink scrapes the site HTML or needs `/wp-admin`, it fails, and we fall back to the real WordPress bridge.
3. **It can change without notice.** Qikink can move the endpoints or the hard-coded key, or start validating the WooCommerce version, at any time. The keys flow is WooCommerce core, so it's unlikely to change. The `autoc/*` calls are Qikink-private.
4. **Terms of use.** We would be acting as a WordPress install on Qikink's private plugin endpoints. It's the owner's own account and store, but it's worth a one-line email to Qikink support ("can we connect a custom store via your WooCommerce flow?"). They may even point to a supported option.
5. **Orders.** Qikink "syncs orders" from WooCommerce, presumably by polling `GET orders` or registering a webhook. This site already sends paid orders to Qikink through its order API, so the receiver deliberately returns **no orders**. Otherwise every order would be printed twice.
6. **One store URL per Qikink account.** Connecting this site may replace an existing Shopify/Woo link in Qikink. Disconnect Shopify first, after the Shopify import.

## What's implemented (see `server/index.js`, section "WooCommerce-compatible receiver")

- `/wp-json/wc/v3/*` (also `?rest_route=/wc/v3/…`), guarded by `WOO_CONSUMER_KEY` / `WOO_CONSUMER_SECRET` from `.env` (Basic auth or query params).
- `products` CRUD + `batch`, `products/{id}/variations` CRUD + `batch`. Any other collection (attributes, terms, categories, tags, webhooks) is stored and echoed back with an id. `GET orders` returns `[]`. `system_status` and `/wp-json/` give minimal answers.
- Mapping: attribute named *colour/color* → `color`, *size* → `label`, variation `sku` + `regular_price` → our size row, variation `image` → `colorImages[COLOUR]`, product images → front/back/detail/onBody. Images are downloaded with the existing `downloadImage` and reused across pushes. Re-pushes update in place, matched by Woo product id or SKU. **New products always land hidden** (`active:false`).
- Admin endpoints doing the plugin's handshake (signed-in admin only): `GET /api/admin/qikink/woo/status`, `POST /api/admin/qikink/woo/connect {email}` → returns Qikink's `client_id` and emails an OTP, `POST /api/admin/qikink/woo/otp {otp, client_id}`. The last one POSTs our consumer key/secret to Qikink's callback exactly as WooCommerce does. There are no admin-panel buttons yet: during the live test, call them from the browser console on /admin (`fetch('/api/admin/qikink/woo/connect', {method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({email:'…'})}).then(r=>r.json())`). Add buttons once the flow is proven.
- Not handled: OAuth1 auth (plain-HTTP only, so deploy over HTTPS), and matching a push to a product already imported from Shopify. Re-pushing an old product creates a new hidden copy, so push only new products.
- The AES payload format was checked by reading the PHP, not against a real PHP run. If `connect` comes back with a decryption-style error, that's the first thing to look at.
- Self-check: `npm run check` starts the server on a temp data dir and replays a typical push (variable product → variation batch → re-push) against it.

## Needs a real test with the live Qikink account

1. Deploy over HTTPS with `SITE_URL`, `WOO_CONSUMER_KEY`, `WOO_CONSUMER_SECRET` set.
2. Run connect → OTP → keys from the admin endpoints, then confirm Qikink's dashboard shows WooCommerce as connected (`…/woo/status` shows the business name).
3. Push one product and read `data/woo-log.jsonl`: check the auth style, endpoints and body shape, and whether Qikink checked anything we 404'd.
4. Check that the product appears hidden in Admin with every colour × size, SKU, price and colour image. Tick Live, then place a test order and confirm Qikink accepts the pushed SKUs.
5. Check Qikink doesn't also create orders from its WooCommerce sync (it should see none).

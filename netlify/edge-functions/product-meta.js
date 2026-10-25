// Product pages are filled in by JavaScript, but WhatsApp, Instagram, Google and friends read the raw HTML.
// This puts each product's title, description, photo, price and Google's Product data into the page
// before it leaves Netlify's edge. The product JSON comes from the (edge-cached) API.
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

export default async (req, context) => {
  const url = new URL(req.url), slug = url.searchParams.get('p');
  const page = await context.next();
  if (!slug) return page;
  let p;
  try { const r = await fetch(new URL('/api/products/' + encodeURIComponent(slug), url)); if (r.ok) p = await r.json(); } catch { /* serve the page as is */ }
  if (!p) return page;

  const title = `${p.seoTitle || p.name} — THRYFTLY`;
  const desc = (p.seoDescription || p.description || `${p.name} by THRYFTLY. Printed to order, shipped across India.`).replace(/\s+/g, ' ').slice(0, 300);
  const image = p.images?.front || Object.values(p.colorImages || {})[0] || '';
  const link = `${url.origin}/product.html?p=${encodeURIComponent(p.slug)}`;
  const inStock = p.sizes.some(s => s.available);
  const ld = { '@context': 'https://schema.org', '@type': 'Product', name: p.name, description: desc, image: image ? [image] : [], sku: p.slug, brand: { '@type': 'Brand', name: 'THRYFTLY' },
    offers: { '@type': 'Offer', url: link, priceCurrency: p.currency || 'INR', price: p.price, availability: `https://schema.org/${inStock ? 'InStock' : 'OutOfStock'}`, itemCondition: 'https://schema.org/NewCondition' } };
  // Star ratings in Google results, from the published reviews.
  if (p.reviews?.count) {
    ld.aggregateRating = { '@type': 'AggregateRating', ratingValue: p.reviews.avg, reviewCount: p.reviews.count, bestRating: 5, worstRating: 1 };
    ld.review = p.reviews.list.slice(0, 5).map(r => ({ '@type': 'Review', author: { '@type': 'Person', name: r.name }, datePublished: r.at.slice(0, 10), reviewRating: { '@type': 'Rating', ratingValue: r.rating, bestRating: 5 }, reviewBody: r.body }));
  }
  const tags = `<link rel="canonical" href="${esc(link)}">
<meta property="og:type" content="product"><meta property="og:site_name" content="THRYFTLY"><meta property="og:title" content="${esc(title)}"><meta property="og:description" content="${esc(desc)}"><meta property="og:url" content="${esc(link)}">${image ? `<meta property="og:image" content="${esc(image)}">` : ''}
<meta property="product:price:amount" content="${esc(p.price)}"><meta property="product:price:currency" content="${esc(p.currency || 'INR')}">
<meta name="twitter:card" content="summary_large_image"><meta name="twitter:title" content="${esc(title)}"><meta name="twitter:description" content="${esc(desc)}">${image ? `<meta name="twitter:image" content="${esc(image)}">` : ''}
<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\u003c')}</script>`;

  const html = (await page.text())
    .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
    .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`)
    .replace('</head>', tags + '\n</head>');
  const headers = new Headers(page.headers);
  headers.delete('content-length');
  return new Response(html, { status: page.status, headers });
};

export const config = { path: ['/product.html', '/product'] };

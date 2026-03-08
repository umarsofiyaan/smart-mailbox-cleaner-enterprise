import { useEffect } from 'react';

const SITE_NAME = 'Smart Mailbox Cleaner';
const SITE_URL = 'https://smart-mailbox-cleaner.umarsofiyaan.shop';
const DEFAULT_OG_IMAGE = `${SITE_URL}/icon-512.png`;

function upsertMeta(selector, attributes) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement('meta');
    document.head.appendChild(el);
  }
  Object.entries(attributes).forEach(([key, value]) => {
    if (value != null) el.setAttribute(key, value);
  });
}

function upsertLink(selector, attributes) {
  let el = document.head.querySelector(selector);
  if (!el) {
    el = document.createElement('link');
    document.head.appendChild(el);
  }
  Object.entries(attributes).forEach(([key, value]) => {
    if (value != null) el.setAttribute(key, value);
  });
}

export default function SEOHead({
  title,
  description,
  path = '/',
  robots = 'index,follow',
  image = DEFAULT_OG_IMAGE,
  type = 'website',
  jsonLd = null,
}) {
  useEffect(() => {
    const fullTitle = title ? `${title} | ${SITE_NAME}` : SITE_NAME;
    const canonical = `${SITE_URL}${path}`;

    document.title = fullTitle;

    upsertMeta('meta[name="description"]', { name: 'description', content: description });
    upsertMeta('meta[name="robots"]', { name: 'robots', content: robots });

    upsertMeta('meta[property="og:title"]', { property: 'og:title', content: fullTitle });
    upsertMeta('meta[property="og:description"]', { property: 'og:description', content: description });
    upsertMeta('meta[property="og:url"]', { property: 'og:url', content: canonical });
    upsertMeta('meta[property="og:image"]', { property: 'og:image', content: image });
    upsertMeta('meta[property="og:type"]', { property: 'og:type', content: type });
    upsertMeta('meta[property="og:site_name"]', { property: 'og:site_name', content: SITE_NAME });

    upsertMeta('meta[name="twitter:card"]', { name: 'twitter:card', content: 'summary_large_image' });
    upsertMeta('meta[name="twitter:title"]', { name: 'twitter:title', content: fullTitle });
    upsertMeta('meta[name="twitter:description"]', { name: 'twitter:description', content: description });
    upsertMeta('meta[name="twitter:image"]', { name: 'twitter:image', content: image });

    upsertLink('link[rel="canonical"]', { rel: 'canonical', href: canonical });

    let schemaEl = document.head.querySelector('script[data-seo-schema="true"]');
    if (jsonLd) {
      if (!schemaEl) {
        schemaEl = document.createElement('script');
        schemaEl.type = 'application/ld+json';
        schemaEl.setAttribute('data-seo-schema', 'true');
        document.head.appendChild(schemaEl);
      }
      schemaEl.textContent = JSON.stringify(jsonLd);
    } else if (schemaEl) {
      schemaEl.remove();
    }
  }, [title, description, path, robots, image, type, jsonLd]);

  return null;
}


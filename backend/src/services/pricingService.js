// src/services/pricingService.js
// Region-aware pricing with country detection by IP.

const logger = require('../utils/logger');
const { query } = require('../config/database');

const FULL_PRICE_COUNTRIES = new Set(['US', 'GB', 'CA', 'AU', 'DE', 'FR']);
const REDUCED_PRICE_COUNTRIES = new Set(['IN', 'ID', 'PH', 'BR', 'PK']);

const FULL_PRICING = {
  starter: 2.99,
  pro: 7.99,
  power: 14.99,
};

const REDUCED_PRICING = {
  starter: 1.49,
  pro: 3.49,
  power: 6.99,
};

function getInrPrice(base, fallback) {
  return Number((process.env[`RAZORPAY_${base}_AMOUNT_PAISE_LOW`] || fallback) / 100);
}

const REGION_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const DB_CACHE_TTL_DAYS = 14;

const memoryRegionCache = new Map();


function isValidCountryCode(value) {
  return /^[A-Z]{2}$/.test(String(value || '').toUpperCase());
}

function extractCountryCodeFromHeaders(req) {
  const candidates = [
    req?.headers?.['x-vercel-ip-country'],
    req?.headers?.['cf-ipcountry'],
    req?.headers?.['cloudfront-viewer-country'],
    req?.headers?.['x-country-code'],
    req?.headers?.['x-appengine-country'],
  ];

  for (const raw of candidates) {
    const value = String(raw || '').trim().toUpperCase();
    if (!isValidCountryCode(value)) continue;
    if (value === 'XX' || value === 'ZZ') continue;
    return value;
  }

  return null;
}

function isReducedRegion(countryCode) {
  return REDUCED_PRICE_COUNTRIES.has(String(countryCode || '').toUpperCase());
}

function resolveRegion(countryCode) {
  if (isReducedRegion(countryCode)) return 'reduced';
  return 'full';
}

function getPlanPricing(countryCode) {
  const region = resolveRegion(countryCode);
  const reduced = region === 'reduced';
  const prices = reduced ? REDUCED_PRICING : FULL_PRICING;
  const currency = reduced ? 'INR' : 'USD';
  const displayPrices = reduced
    ? {
      starter: getInrPrice('STARTER', 149),
      pro: getInrPrice('PRO', 349),
      power: getInrPrice('POWER', 699),
    }
    : prices;

  return {
    countryCode: countryCode || 'US',
    region,
    currency,
    plans: {
      starter: {
        planType: 'starter',
        label: 'Starter',
        limitLabel: 'Clean up to 10,000 emails',
        price: displayPrices.starter,
        priceUsd: prices.starter,
      },
      pro: {
        planType: 'pro',
        label: 'Pro',
        limitLabel: 'Clean up to 50,000 emails',
        price: displayPrices.pro,
        priceUsd: prices.pro,
      },
      power: {
        planType: 'power',
        label: 'Power',
        limitLabel: 'Unlimited cleanup for 30 days',
        price: displayPrices.power,
        priceUsd: prices.power,
      },
    },
  };
}

function extractClientIp(req) {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }

  const realIp = req.headers['x-real-ip'];
  if (typeof realIp === 'string' && realIp.trim()) return realIp.trim();

  return req.ip || req.connection?.remoteAddress || null;
}

function getPricingFromSession(req) {
  const countryCode = String(req?.cookies?.pricing_country || '').toUpperCase();
  const region = String(req?.cookies?.pricing_region || '').toLowerCase();
  if (!countryCode) return null;
  if (region !== 'full' && region !== 'reduced') return null;
  return getPlanPricing(countryCode);
}

function cachePricingInSession(res, pricingContext) {
  if (!res || !pricingContext?.countryCode) return;
  const secure = process.env.NODE_ENV === 'production';
  const cookieOptions = {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    maxAge: REGION_CACHE_TTL_MS,
    path: '/',
  };
  res.cookie('pricing_country', pricingContext.countryCode, cookieOptions);
  res.cookie('pricing_region', pricingContext.region, cookieOptions);
}

async function fetchWithTimeout(url, timeoutMs = 2500) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function detectCountryCodeByIp(ipAddress) {
  try {
    const ipPath = ipAddress ? `/${encodeURIComponent(ipAddress)}` : '';
    const ipapiData = await fetchWithTimeout(`https://ipapi.co${ipPath}/json/`);
    if (ipapiData?.country_code) {
      return String(ipapiData.country_code).toUpperCase();
    }
  } catch (err) {
    logger.warn('ipapi country detection failed', { error: err.message });
  }

  try {
    const token = process.env.IPINFO_TOKEN;
    const tokenPart = token ? `?token=${encodeURIComponent(token)}` : '';
    const ipPath = ipAddress ? `/${encodeURIComponent(ipAddress)}` : '';
    const ipinfoData = await fetchWithTimeout(`https://ipinfo.io${ipPath}/json${tokenPart}`);
    if (ipinfoData?.country) {
      return String(ipinfoData.country).toUpperCase();
    }
  } catch (err) {
    logger.warn('ipinfo country detection failed', { error: err.message });
  }

  return 'US';
}

async function getUserPricingContext(userId, req) {
  const headerCountry = extractCountryCodeFromHeaders(req);
  if (headerCountry) {
    const now = Date.now();
    const previous = memoryRegionCache.get(userId);
    if (!previous || previous.countryCode !== headerCountry || previous.expiresAt <= now) {
      await query(
        `UPDATE users
         SET pricing_country = $2,
             pricing_region = $3,
             region_detected_at = NOW(),
             updated_at = NOW()
         WHERE id = $1`,
        [userId, headerCountry, resolveRegion(headerCountry)]
      );
    }

    memoryRegionCache.set(userId, {
      countryCode: headerCountry,
      expiresAt: now + REGION_CACHE_TTL_MS,
    });
    return getPlanPricing(headerCountry);
  }

  const sessionPricing = getPricingFromSession(req);
  if (sessionPricing) return sessionPricing;

  const cached = memoryRegionCache.get(userId);
  if (cached && cached.expiresAt > Date.now()) {
    return getPlanPricing(cached.countryCode);
  }

  const dbRes = await query(
    `SELECT pricing_country, region_detected_at
     FROM users
     WHERE id = $1`,
    [userId]
  );

  const row = dbRes.rows[0];
  const now = Date.now();
  if (row?.pricing_country && row?.region_detected_at) {
    const ageMs = now - new Date(row.region_detected_at).getTime();
    if (ageMs >= 0 && ageMs <= DB_CACHE_TTL_DAYS * 24 * 60 * 60 * 1000) {
      memoryRegionCache.set(userId, {
        countryCode: String(row.pricing_country).toUpperCase(),
        expiresAt: now + REGION_CACHE_TTL_MS,
      });
      return getPlanPricing(String(row.pricing_country).toUpperCase());
    }
  }

  const ipAddress = extractClientIp(req);
  const countryCode = await detectCountryCodeByIp(ipAddress);

  await query(
    `UPDATE users
     SET pricing_country = $2,
         pricing_region = $3,
         region_detected_at = NOW(),
         updated_at = NOW()
     WHERE id = $1`,
    [userId, countryCode, resolveRegion(countryCode)]
  );

  memoryRegionCache.set(userId, {
    countryCode,
    expiresAt: now + REGION_CACHE_TTL_MS,
  });

  return getPlanPricing(countryCode);
}

module.exports = {
  FULL_PRICE_COUNTRIES,
  REDUCED_PRICE_COUNTRIES,
  FULL_PRICING,
  REDUCED_PRICING,
  getPlanPricing,
  getUserPricingContext,
  cachePricingInSession,
};

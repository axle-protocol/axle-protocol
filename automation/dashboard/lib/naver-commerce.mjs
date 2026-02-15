/**
 * Naver Commerce API - Authentication & Integration Module
 *
 * Handles OAuth2 token generation (bcrypt-based signing) and
 * wraps the Pay-Order seller APIs for order management.
 *
 * Required env vars:
 *   NAVER_CLIENT_ID      - Commerce API application client ID
 *   NAVER_CLIENT_SECRET   - Commerce API application client secret (bcrypt salt)
 *
 * Dependency:
 *   bcryptjs  (pure-JS bcrypt, must be installed: npm i bcryptjs)
 */

import bcrypt from 'bcryptjs';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const API_BASE = 'https://api.commerce.naver.com/external';
const TOKEN_URL = `${API_BASE}/v1/oauth2/token`;

const NAVER_CLIENT_ID = process.env.NAVER_CLIENT_ID;
const NAVER_CLIENT_SECRET = process.env.NAVER_CLIENT_SECRET;

// ---------------------------------------------------------------------------
// Carrier code mapping (Korean carrier name -> Naver code)
// ---------------------------------------------------------------------------

export const CARRIER_CODES = {
  'CJ대한통운': 'CJGLS',
  '한진택배':   'HANJIN',
  '롯데택배':   'LOTTE',
  '우체국':     'EPOST',
  '로젠':       'LOGEN',
  '경동택배':   'KYUNGDONG',
};

/**
 * Resolve a carrier name (Korean or code) to its Naver carrier code.
 * Returns the value as-is if it already looks like a code (all uppercase ASCII).
 */
export function resolveCarrierCode(carrier) {
  if (CARRIER_CODES[carrier]) return CARRIER_CODES[carrier];
  // Already a code value (e.g. 'CJGLS')
  if (/^[A-Z]+$/.test(carrier) && Object.values(CARRIER_CODES).includes(carrier)) {
    return carrier;
  }
  throw new Error(`[naver-commerce] Unknown carrier: "${carrier}". Known carriers: ${Object.keys(CARRIER_CODES).join(', ')}`);
}

// ---------------------------------------------------------------------------
// Token management (with caching)
// ---------------------------------------------------------------------------

let _cachedToken = null;   // { accessToken, expiresAt }

/**
 * Generate a fresh access token from the Naver Commerce OAuth2 endpoint.
 *
 * Signing process (per Naver docs):
 *   1. timestamp  = Date.now() in milliseconds (13 digits)
 *   2. signString = `${clientId}_${timestamp}`
 *   3. hash       = bcrypt.hashSync(signString, clientSecret)   (clientSecret IS the salt)
 *   4. client_secret_sign = Base64(hash)
 *   5. POST form-urlencoded with grant_type=client_credentials, type=SELF
 */
async function requestToken() {
  if (!NAVER_CLIENT_ID || !NAVER_CLIENT_SECRET) {
    throw new Error(
      '[naver-commerce] Missing environment variables. ' +
      'Set NAVER_CLIENT_ID and NAVER_CLIENT_SECRET before using this module.',
    );
  }

  const timestamp = Date.now().toString();
  const signString = `${NAVER_CLIENT_ID}_${timestamp}`;

  // bcrypt hash using clientSecret as the salt directly
  const hashed = bcrypt.hashSync(signString, NAVER_CLIENT_SECRET);
  const clientSecretSign = Buffer.from(hashed, 'utf-8').toString('base64');

  const body = new URLSearchParams({
    client_id: NAVER_CLIENT_ID,
    timestamp,
    client_secret_sign: clientSecretSign,
    grant_type: 'client_credentials',
    type: 'SELF',
  });

  log('Requesting new access token...');

  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[naver-commerce] Token request failed (${res.status}): ${text}`);
  }

  const data = await res.json();

  if (!data.access_token) {
    throw new Error(`[naver-commerce] Token response missing access_token: ${JSON.stringify(data)}`);
  }

  // expires_in is in seconds; subtract 60 s as safety margin
  const expiresInMs = ((data.expires_in || 3600) - 60) * 1000;
  _cachedToken = {
    accessToken: data.access_token,
    expiresAt: Date.now() + expiresInMs,
  };

  log(`Access token obtained, expires in ~${Math.round(expiresInMs / 1000)}s`);
  return _cachedToken.accessToken;
}

/**
 * Get a valid Bearer token, reusing the cached one when possible.
 */
export async function getAccessToken() {
  if (_cachedToken && Date.now() < _cachedToken.expiresAt) {
    return _cachedToken.accessToken;
  }
  return requestToken();
}

/**
 * Force-clear the cached token (useful after a 401 response).
 */
export function clearTokenCache() {
  _cachedToken = null;
}

// ---------------------------------------------------------------------------
// Internal HTTP helpers
// ---------------------------------------------------------------------------

function log(...args) {
  const ts = new Date().toISOString();
  console.log(`[naver-commerce][${ts}]`, ...args);
}

function logError(...args) {
  const ts = new Date().toISOString();
  console.error(`[naver-commerce][${ts}]`, ...args);
}

/**
 * Authenticated fetch wrapper.
 * Automatically attaches the Bearer token and retries once on 401.
 */
async function apiFetch(path, options = {}) {
  const url = path.startsWith('http') ? path : `${API_BASE}${path}`;

  const doRequest = async (token) => {
    const headers = {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...options.headers,
    };

    const res = await fetch(url, { ...options, headers });
    return res;
  };

  let token = await getAccessToken();
  let res = await doRequest(token);

  // Retry once with a fresh token on 401
  if (res.status === 401) {
    log('Received 401 - refreshing token and retrying...');
    clearTokenCache();
    token = await getAccessToken();
    res = await doRequest(token);
  }

  if (!res.ok) {
    const text = await res.text();
    const err = new Error(`[naver-commerce] API ${options.method || 'GET'} ${path} failed (${res.status}): ${text}`);
    err.status = res.status;
    err.responseBody = text;
    logError(err.message);
    throw err;
  }

  // Some endpoints return 204 No Content
  if (res.status === 204) return null;

  return res.json();
}

// ---------------------------------------------------------------------------
// Order API wrappers
// ---------------------------------------------------------------------------

/**
 * Fetch orders that changed status within a date range.
 *
 * @param {string} fromDate  - ISO date string or 'YYYY-MM-DD' (inclusive)
 * @param {string} toDate    - ISO date string or 'YYYY-MM-DD' (inclusive)
 * @param {string} [status]  - Optional status filter (e.g. 'PAYED', 'DELIVERED', ...)
 * @returns {Promise<Object>} API response containing lastChangeStatuses array
 */
export async function fetchOrders(fromDate, toDate, status) {
  const params = new URLSearchParams({
    lastChangedFrom: toISODateTime(fromDate),
    lastChangedTo: toISODateTime(toDate, true),
  });

  if (status) {
    params.set('lastChangedType', status);
  }

  const path = `/v1/pay-order/seller/product-orders/last-changed-statuses?${params.toString()}`;
  log(`Fetching orders: ${fromDate} ~ ${toDate}${status ? ` [status=${status}]` : ''}`);

  return apiFetch(path);
}

/**
 * Get detailed info for a single product order.
 *
 * @param {string} productOrderId
 * @returns {Promise<Object>}
 */
export async function getOrderDetail(productOrderId) {
  if (!productOrderId) throw new Error('[naver-commerce] productOrderId is required');

  const path = `/v1/pay-order/seller/product-orders/${encodeURIComponent(productOrderId)}`;
  log(`Fetching order detail: ${productOrderId}`);

  return apiFetch(path);
}

/**
 * Confirm (발주 확인) a product order.
 *
 * @param {string} productOrderId
 * @returns {Promise<Object>}
 */
export async function confirmOrder(productOrderId) {
  if (!productOrderId) throw new Error('[naver-commerce] productOrderId is required');

  const path = '/v1/pay-order/seller/product-orders/confirm';
  log(`Confirming order: ${productOrderId}`);

  return apiFetch(path, {
    method: 'POST',
    body: JSON.stringify({
      productOrderIds: [productOrderId],
    }),
  });
}

/**
 * Register shipment (발송 처리) for a product order.
 *
 * @param {string} productOrderId
 * @param {string} carrier          - Korean name (e.g. 'CJ대한통운') or Naver code (e.g. 'CJGLS')
 * @param {string} trackingNumber   - Courier tracking number
 * @returns {Promise<Object>}
 */
export async function shipOrder(productOrderId, carrier, trackingNumber) {
  if (!productOrderId) throw new Error('[naver-commerce] productOrderId is required');
  if (!carrier) throw new Error('[naver-commerce] carrier is required');
  if (!trackingNumber) throw new Error('[naver-commerce] trackingNumber is required');

  const deliveryCompanyCode = resolveCarrierCode(carrier);

  const path = '/v1/pay-order/seller/product-orders/ship';
  log(`Shipping order: ${productOrderId} via ${deliveryCompanyCode} (${trackingNumber})`);

  return apiFetch(path, {
    method: 'POST',
    body: JSON.stringify({
      productOrderIds: [productOrderId],
      deliveryMethod: 'DELIVERY',
      deliveryCompanyCode,
      trackingNumber,
    }),
  });
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Ensure a date value is in ISO 8601 datetime format.
 * If only a date string like 'YYYY-MM-DD' is provided, appends time component.
 *
 * @param {string} dateStr
 * @param {boolean} [endOfDay=false] - If true, set time to 23:59:59
 * @returns {string} ISO datetime string
 */
function toISODateTime(dateStr, endOfDay = false) {
  if (!dateStr) throw new Error('[naver-commerce] date parameter is required');

  // Already has a time component
  if (dateStr.includes('T')) return dateStr;

  // Plain date like '2026-02-15'
  const time = endOfDay ? 'T23:59:59' : 'T00:00:00';
  return `${dateStr}${time}`;
}

# SmartStore / Vendor Portal System Audit

**Audit Date**: 2026-02-15
**Auditor**: Claude Opus 4.6
**Scope**: Full code review of server.mjs, all frontend files, data files, Python scripts
**Verdict**: System is a functional MVP with several bugs and security gaps. Recommend incremental fix, not rebuild.

---

## Table of Contents

- [A) Vendor Management](#a-vendor-management)
- [B) Product Management](#b-product-management)
- [C) Order Management](#c-order-management)
- [D) Vendor Portal](#d-vendor-portal)
- [E) Dispatch Processing](#e-dispatch-processing)
- [F) Security & Operations](#f-security--operations)
- [G) API Endpoints](#g-api-endpoints)
- [H) Frontend Pages](#h-frontend-pages)
- [I) Summary & Recommendations](#i-summary--recommendations)

---

## A) Vendor Management

### Vendor CRUD

**Implementation Status**: Partial
**Quality**: Works

| Operation | Status | Notes |
|-----------|--------|-------|
| Create | Works | `POST /api/admin/vendors` - validates name, username, password (min 4 chars) |
| Read | Works | `GET /api/admin/state` returns vendors list (without password hashes) |
| Update | NOT IMPLEMENTED | No endpoint to edit vendor name, reset password, or disable |
| Delete | NOT IMPLEMENTED | No endpoint to remove a vendor |

**Key code**: `server.mjs` lines 1558-1575

**Issues found**:
1. **No vendor update/delete**: Cannot change vendor name, reset password, or disable a vendor.
2. **No vendor deactivation**: A compromised vendor account cannot be disabled without manually editing `vendors.json`.
3. **Duplicate vendor names allowed**: Only `username` is checked for uniqueness, not `name`. Multiple vendors can have the same display name (see vendors.json: "QA1" appears twice with different IDs).
4. **No password complexity enforcement**: Only checks `password.length < 4`. No uppercase/digit/special requirements.
5. **Audit log gap**: Vendor creation is NOT audit-logged (no `auditLog()` call in the create handler).

### Vendor Login / Session Management

**Implementation Status**: Complete
**Quality**: Works

**Login flow** (`POST /api/vendor/login`, `server.mjs` lines 1945-1977):
- Looks up vendor by username, verifies password with PBKDF2-SHA256 (120k iterations)
- Creates session token (UUID), stores in `vendor_sessions.json`
- Sets `vendor_session` HttpOnly cookie, 14-day expiry
- Prunes expired sessions on each login

**Session validation** (`getVendorFromSession()`, lines 327-342):
- Reads cookie, finds matching session, checks `expiresAt`
- Returns vendor `{id, name, username}` or null

**Issues found**:
1. **No rate limiting on login**: Unlimited login attempts. Brute-force possible.
2. **No session limit per vendor**: A vendor can accumulate unlimited active sessions.
3. **Cookie `secure: false` hardcoded**: Line 1970 always sets `secure: false` for vendor cookies. Compare with owner login (line 1399-1400) which dynamically sets `secure` based on `x-forwarded-proto`. This means vendor cookies are sent over HTTP.
4. **No logout-all capability**: Cannot invalidate all sessions for a vendor (e.g., on password change).
5. **Session file grows**: Old sessions are pruned only on login. If a vendor never logs in again, their expired sessions remain in the file.

### Password Security

**Implementation Status**: Complete
**Quality**: Production-Ready

- PBKDF2-SHA256 with 120,000 iterations and 16-byte random salt
- Timing-safe comparison via `crypto.timingSafeEqual`
- Passwords stored as `{algo, iter, salt, hash}` - proper format

---

## B) Product Management

### Product Upload/Listing

**Implementation Status**: Complete
**Quality**: Works

**Endpoint**: `POST /api/admin/products_csv` (lines 1577-1636)

- Accepts CSV text in JSON body (`{csv: "..."}`)
- Naive CSV parser handles quoted commas
- Requires columns: `"상품번호(스마트스토어)"` or `"상품번호"`, and `"상품명"`
- Merges with existing products (by productNo as key)

**Issues found**:
1. **CSV sent as JSON body, not file upload**: The CSV text is embedded in a JSON POST body. Limited by the 2MB `readJsonBody` hard limit. Large product catalogs may fail.
2. **No product deletion**: Cannot remove products from the list.
3. **No validation on productNo format**: Any string accepted.
4. **BOM handling**: Only strips BOM from headers (line 1612), not from cell values.

### Product-to-Vendor Mapping (mapping.json)

**Implementation Status**: Complete
**Quality**: Buggy

**Endpoint**: `POST /api/admin/mapping` (lines 1638-1653)

- Replaces ALL mappings for a given vendorId with new set of productNos
- Supports many-to-many (multiple vendors per product, multiple products per vendor)

**Issues found**:
1. **BUG - Multiple vendor mapping conflict**: `mapping.json` allows the same productNo to be mapped to multiple vendors (line 1649 just pushes without dedup). However, the order import (line 1787) uses `new Map()` which takes only the LAST mapping per productNo. This means if productNo "9801098858" is mapped to both vendor_demo and vendor_X, only vendor_X's mapping survives (Map overwrite). Current data confirms this: mapping.json has productNo "9801098858" mapped to two different vendors.
2. **No orphan cleanup**: Deleting a vendor would leave stale mappings.
3. **UI replaces entire vendor mapping on save**: If you select vendorA, check 2 products, and save, all previous mappings for vendorA are replaced. This is correct behavior but not obvious in the UI.

---

## C) Order Management

### Order Excel Upload (CDFV2 Encrypted XLSX)

**Implementation Status**: Complete
**Quality**: Works (with known limitations)

**Endpoint**: `POST /api/admin/orders_xlsx_import` (lines 1696-1847)

**Flow**:
1. Multipart form data (file + password)
2. Saves to `data/uploads/` with unique filename
3. Calls `scripts/parse_smartstore_orders.py` via `spawnSync`
4. Python decrypts CDFV2 with `msoffcrypto`, parses with `openpyxl`
5. Returns JSON items to Node.js
6. Node auto-assigns vendors by productNo lookup in mapping

**Issues found**:
1. **BUG - Duplicate `readMultipart` function**: Line 1702 defines a LOCAL `readMultipart(boundaryStr, maxBytes)` inside the route handler that SHADOWS the module-level `readMultipart(req, boundaryStr, maxBytes)` at line 124. Then line 1754 calls `readMultipart(req, boundary)` which calls the LOCAL version, passing `req` as `boundaryStr` and `boundary` as `maxBytes`. This SHOULD FAIL because the local version uses `for await (const chunk of req)` directly without the `req` parameter. The local version captures `req` from closure scope, so it accidentally works -- but the `boundaryStr` parameter receives `req` (an object), and `boundary` (a string) is passed as `maxBytes`. Since `boundaryStr` is used as `Buffer.from("--" + boundaryStr)` which will produce `--[object Object]`, this would fail. **However**, looking more closely, the local function on line 1702 has `req` already in closure scope from the outer handler, so it reads from `req` via `for await (const chunk of req)`. The `boundaryStr` parameter IS used correctly on line 1712. Wait -- line 1754 calls `readMultipart(req, boundary)` where req is the first arg. The local function signature is `readMultipart(boundaryStr, maxBytes)`. So `boundaryStr = req` (the request object) and `maxBytes = boundary` (the boundary string). This is definitely a bug, BUT it might work accidentally because the local function reads `req` from closure, and the actual boundary is constructed from `boundaryStr` which is now the req object -- `Buffer.from("--" + req)` would produce `--[object Object]` which would never match. **This is a critical bug** -- the xlsx import multipart parsing is broken. It should call `readMultipart(boundary)` not `readMultipart(req, boundary)`.
2. **Uploaded files never cleaned up**: The `data/uploads/` directory accumulates xlsx files permanently.
3. **Synchronous Python execution**: `spawnSync` blocks the Node.js event loop during parsing. Large files block all requests.
4. **Phone/address always null**: The Python parser (line 85-86) hardcodes `recipient_phone: None, recipient_address: None` with comment "address/phone columns are not present in this export". This is a KNOWN limitation.
5. **No audit log on vendor creation**: (repeated from above)

### Order Parsing and Storage

**Implementation Status**: Complete
**Quality**: Works

- Orders stored in `data/orders.json` as flat array
- Each order has: id, productOrderNo, orderNo, productNo, productName, optionInfo, qty, recipientName, recipientPhone, recipientAddress, vendorId, carrier, trackingNumber, createdAt, updatedAt, _raw
- Re-import preserves existing tracking info (lines 1828-1833)
- Deduplication by productOrderNo (Map-based)

### Auto-Assignment by productNo

**Implementation Status**: Complete
**Quality**: Works (with mapping caveat above)

- On import, each order's productNo is looked up in mapping
- First matching vendorId is assigned
- Unassigned orders get `vendorId: null`

### Unassigned Order Handling

**Implementation Status**: Complete
**Quality**: Works

**Endpoints**:
- `GET /api/admin/orders_unassigned` - lists orders with no vendorId
- `POST /api/admin/orders_assign` - bulk assigns selected orders to a vendor

**Issues found**:
1. **No protection against double-assignment**: An order already assigned to vendorA can be reassigned to vendorB without warning.

### Order Status Tracking

**Implementation Status**: Partial
**Quality**: Works

- Status field: set to `"shipped"` when tracking number is entered
- No other statuses used (no "pending", "processing", "delivered" etc.)
- `_raw.orderStatus` preserves original SmartStore status but is never displayed

**Issues found**:
1. **Only "shipped" status**: No lifecycle management (pending -> shipped -> delivered -> completed).
2. **No way to revert status**: Once shipped, cannot undo.

---

## D) Vendor Portal (What Vendors See/Do)

### Login Flow

**Implementation Status**: Complete
**Quality**: Works

**Files**: `/public/vendor/login.html`, `/public/vendor/login.js`

1. Vendor visits `/vendor/login`
2. Enters username + password
3. `POST /api/vendor/login` sets session cookie
4. Redirects to `/vendor/orders`
5. `/vendor/orders` is gated: no session -> 302 to `/vendor/login`

**Issues found**:
1. **Demo credentials shown in login page**: Line 28 of login.html shows "demo / demo1234". Should be removed in production.
2. **No "remember me" option**: Always 14-day session.
3. **No password change flow**: Vendors cannot change their own password.

### Order Viewing

**Implementation Status**: Complete
**Quality**: Works

**File**: `/public/vendor/orders.js`

- Calls `GET /api/vendor/orders` which returns only orders where `vendorId === vendor.id`
- Displays: productName, qty, optionInfo, recipientName, recipientPhone, recipientAddress
- Sorts: pending (no tracking) first, then by createdAt descending
- Shows pending count badge

**Issues found**:
1. **PII shown unmasked**: Line 57-59 of orders.js shows full name, phone, address with label "배송정보 (마스킹 없음)". This is a conscious design choice but a privacy concern.
2. **Copy buttons**: 4 copy buttons (name, phone, address, order number) - work well for mobile workflow.
3. **No pagination**: All orders loaded at once. Could be slow with thousands of orders.
4. **No date filtering**: Cannot filter by date range.

### Tracking Number Input

**Implementation Status**: Complete
**Quality**: Works

**Client-side validation** (orders.js lines 14-22):
- Strips whitespace/hyphens
- Requires digits only
- For CJ/Hanjin: requires 10-12 digits

**Server-side validation** (server.mjs lines 353-366):
- Strips non-alphanumeric, uppercases
- Checks carrier in allowlist: `['cj', 'hanjin', 'lotte', 'epost', 'logen', 'etc']`
- Length: 8-30 characters

**Issues found**:
1. **Validation mismatch**: Client requires digits only (`/^\d+$/`), server allows alphanumeric. Client rejects valid tracking numbers with letters.
2. **Limited carrier support in UI**: Only "hanjin" and "cj" in the dropdown (orders.js line 76), but server accepts 6 carriers.
3. **No tracking number uniqueness check**: Same tracking number can be entered for multiple orders.

### Order Excel Download for Vendors

**Implementation Status**: Complete
**Quality**: Buggy

Two endpoints exist:
1. `GET /api/vendor/orders.xlsx` (line 2015) - calls Python script `export_vendor_orders_xlsx.py`
2. `GET /api/vendor/orders/export.xlsx` (line 2081) - pure Node.js with xlsx library

**Issues found**:
1. **BUG in endpoint 2**: The pure-JS export at `/api/vendor/orders/export.xlsx` (lines 2081-2116) reads old-format fields: `o.buyer?.name`, `o.recipient?.name`, `o.recipient?.phone`, `o.recipient?.address1`, `o.recipient?.address2`, `o.items[].name`. But the actual order data structure from xlsx import uses flat fields: `o.recipientName`, `o.recipientPhone`, `o.recipientAddress`. Only the first seed order (SS-20260214-0001) uses the nested format. Result: Most exported orders will have empty recipient/item columns.
2. **The Python export (endpoint 1)** is correct - it reads flat fields (`recipientName`, `recipientPhone`, etc.).
3. **Frontend uses endpoint 1**: The "내 주문 엑셀(xlsx)" button points to `/api/vendor/orders.xlsx` (correct one).
4. **Endpoint 2 is dead code** that would produce wrong output if used.

---

## E) Dispatch Processing

### Tracking Number Collection

**Implementation Status**: Complete
**Quality**: Works

- Vendors enter tracking via the portal
- Data stored both in `tracking: {carrier, number, updatedAt}` and flat `carrier`/`trackingNumber` fields
- Status set to "shipped" on save

### SmartStore Upload Excel Generation

**Implementation Status**: Complete
**Quality**: Works

**Endpoint**: `GET /api/admin/shipping_export.xlsx` (lines 1889-1934)

**Output columns**: `상품주문번호`, `배송방법`, `택배사`, `송장번호`

- Filters orders that have both trackingNumber and carrier
- Default 배송방법: `"택배,등기,소포"`
- Carrier label mapping: `{cj: "CJ대한통운", hanjin: "한진택배"}`

**Issues found**:
1. **Incomplete carrier labels**: Only "cj" and "hanjin" have Korean labels (line 251-254). If a vendor selects "lotte", "epost", "logen", or "etc", the raw key string is used as the carrier label, which SmartStore may reject.
2. **배송방법 value questionable**: `"택배,등기,소포"` is the hardcoded default. SmartStore may expect just `"택배"`. Should verify against actual SmartStore upload format.
3. **No status filtering**: Exports ALL orders with tracking, including already-uploaded ones. No way to track which orders have been submitted to SmartStore vs. which are new.

### Chunk/Split Download

**Implementation Status**: Complete
**Quality**: Works

- Query params: `?chunk=0&size=2000`
- Default chunk size 2000, max 5000
- Filename includes chunk number

---

## F) Security & Operations

### Authentication

**Admin (Owner)**:
- **Primary**: HTTP Basic Auth (username from env `DASHBOARD_USERNAME` default "han", password from `DASHBOARD_PASSWORD`)
- **Secondary**: Cookie-based session via `POST /api/owner/login` (for mobile compatibility)
- Owner sessions have NO expiry (lines 1300-1317: `getOwnerFromSession` does not check expiry)
- Sessions capped at 200 (line 1396)

**Vendor**:
- Cookie-based session only
- 14-day expiry, pruned on login

**Issues found**:
1. **CRITICAL - Owner sessions never expire**: `getOwnerFromSession()` only checks if token exists, not any expiry. Sessions are permanent until the file has >200 entries and old ones get truncated.
2. **No CSRF protection**: No CSRF tokens on any forms. POST endpoints accept any origin.
3. **No rate limiting anywhere**: No rate limiting on login, API calls, file uploads.
4. **Vendor login hardcoded demo creds displayed**: Production security concern.
5. **No HTTPS enforcement**: Server binds plain HTTP. Relies on reverse proxy for TLS.

### Audit Logging

**Implementation Status**: Complete
**Quality**: Works

**File**: `data/audit.jsonl` (append-only JSONL)

**Logged actions**:
- `OWNER_LOGGED_IN`, `OWNER_LOGIN_FAILED`
- `VENDOR_LOGIN`, `VENDOR_LOGIN_FAILED`, `VENDOR_LOGOUT`
- `VIEW_ORDERS`, `INPUT_TRACKING`, `DOWNLOAD_VENDOR_ORDERS_XLSX`
- `ADMIN_ORDERS_IMPORTED`, `ADMIN_ORDERS_IMPORT_FAILED`
- `ADMIN_ORDERS_ASSIGNED`, `ADMIN_SHIPPING_EXPORT`
- Instagram-related actions (IG_DRAFT_CREATED, IG_APPROVED, etc.)
- `ROADMAP_*` actions

Each record: `{id, ts, actorType, actorId, action, ip, meta}`

**Issues found**:
1. **Missing audit**: Vendor creation not logged. Product CSV upload not logged. Mapping changes not logged.
2. **VIEW_ORDERS logged on every page load**: Excessive logging (every refresh creates an audit entry). 100KB+ already accumulated.
3. **No audit log rotation**: File grows indefinitely.
4. **No audit viewer in UI**: Must read raw JSONL file.
5. **Best-effort only**: Failures silently ignored (line 283-285).

### Personal Info Protection

**Implementation Status**: Partial
**Quality**: Buggy

**Issues**:
1. **No PII masking for vendors**: Full name, phone, address shown unmasked (intentional per UI label "마스킹 없음").
2. **PII in JSON stored unencrypted**: `orders.json` contains full names, phones, addresses in plaintext.
3. **Backup files contain PII**: `data/backups/` contains copies of orders.json with PII.
4. **Uploaded xlsx files not cleaned up**: `data/uploads/` contains encrypted source files.
5. **No access log separation**: Audit log mixes PII access with other actions.

### Error Handling

**Implementation Status**: Partial
**Quality**: Works

- JSON body parsing has 2MB hard limit
- Multipart upload has 30MB limit (15MB for images)
- Python script errors returned with stderr (truncated to 2000 chars)
- Many `try/catch` with silent failures (`catch {}`)

**Issues found**:
1. **Silent catch blocks**: At least 15 instances of `catch {}` or `catch { /* ignore */ }`. Errors swallowed silently.
2. **No global error handler**: Unhandled async exceptions will crash the server.
3. **File I/O errors not caught**: `loadJson`/`saveJson` can throw on corrupted files.

### Empty State Handling

**Implementation Status**: Complete
**Quality**: Works

- Vendor orders page: Shows "주문 없음" when no orders
- Admin unassigned: Shows "미분류 주문 없음"
- Products list: Shows "상품 없음"
- All load functions have proper fallbacks (`loadJson(path, fallback)`)

---

## G) API Endpoints

### SmartStore/Vendor Related Endpoints

| # | Method | Path | Auth | Description | Issues |
|---|--------|------|------|-------------|--------|
| 1 | GET | `/api/health` | None | Health check | None |
| 2 | POST | `/api/owner/login` | None | Owner cookie login | No rate limit |
| 3 | GET | `/api/admin/state` | Owner | Returns vendors, products, mapping | None |
| 4 | POST | `/api/admin/vendors` | Owner | Create vendor | No audit log, no update/delete |
| 5 | POST | `/api/admin/products_csv` | Owner | Upload product CSV | No audit log, 2MB limit via JSON |
| 6 | POST | `/api/admin/mapping` | Owner | Set vendor-product mapping | Multi-vendor conflict (Map overwrite) |
| 7 | GET | `/api/admin/orders_stats` | Owner | Order count + unassigned count | None |
| 8 | GET | `/api/admin/orders_unassigned` | Owner | List unassigned orders | Exposes PII to admin |
| 9 | POST | `/api/admin/orders_assign` | Owner | Bulk assign orders to vendor | No double-assign protection |
| 10 | POST | `/api/admin/orders_xlsx_import` | Owner | Upload SmartStore encrypted xlsx | **BUG: readMultipart arg mismatch**; phone/address null |
| 11 | POST | `/api/admin/seed_order` | Owner | Create test order | Hardcoded PII ("홍길동") |
| 12 | GET | `/api/admin/shipping_export.xlsx` | Owner | Download SmartStore upload xlsx | Incomplete carrier labels |
| 13 | POST | `/api/vendor/login` | None | Vendor login | No rate limit, secure:false |
| 14 | POST | `/api/vendor/logout` | Vendor | Vendor logout | None |
| 15 | GET | `/api/vendor/me` | Vendor | Get current vendor info | None |
| 16 | GET | `/api/vendor/orders` | Vendor | Get vendor's orders | Verbose audit logging |
| 17 | GET | `/api/vendor/orders.xlsx` | Vendor | Download vendor orders xlsx (Python) | Depends on Python/openpyxl |
| 18 | POST | `/api/vendor/orders/:id/tracking` | Vendor | Save tracking number | Validation mismatch client/server |
| 19 | GET | `/api/vendor/orders/export.xlsx` | Vendor | Download vendor orders xlsx (Node) | **BUG: reads wrong field names** |
| 20 | GET | `/api/admin/roadmap` | Owner | Get roadmap items | None |
| 21 | POST | `/api/admin/roadmap` | Owner | Add/toggle/remove roadmap items | None |

### Non-SmartStore Endpoints (Instagram, Queue)

| # | Method | Path | Auth | Description |
|---|--------|------|------|-------------|
| 22 | GET/POST | `/api/admin/ig/guide` | Owner | Instagram brand guide CRUD |
| 23 | GET/POST | `/api/admin/ig/posts` | Owner | Instagram post drafts |
| 24 | GET | `/api/admin/ig/posts_due` | Owner | Posts due for publishing |
| 25 | POST | `/api/admin/ig/posts/:id/:action` | Owner | Approve/reschedule/send/cancel/generate_images |
| 26 | POST | `/api/admin/ig/posts/:id/product_image` | Owner | Upload product hero image |
| 27 | GET | `/api/admin/ig/posts/:id/product_image` | Owner | Serve product hero image |
| 28 | GET | `/api/admin/ig/posts/:id/card/:n` | Owner | Serve generated card image |
| 29 | GET | `/api/admin/ig/posts/:id/package.zip` | Owner | Download posting package |
| 30 | GET | `/api/admin/ig/slide_types` | Owner | List available slide types |
| 31 | GET | `/api/admin/ig/layouts` | Owner | List available layouts |
| 32 | GET | `/api/queue` | Owner | List automation queue items |
| 33 | POST | `/api/queue/:id/:action` | Owner | Queue item state transitions |

---

## H) Frontend Pages

### `/vendor/login` - Vendor Login Page

**File**: `/public/vendor/login.html` + `/public/vendor/login.js`

| Element | Status | Notes |
|---------|--------|-------|
| Username input | Works | |
| Password input | Works | |
| Login button | Works | Calls POST /api/vendor/login |
| Error display | Works | Shows error text |
| Demo credentials hint | Works | **Security concern in production** |

**Quality**: Works

### `/vendor/orders` - Vendor Order Management

**File**: `/public/vendor/orders.html` + `/public/vendor/orders.js`

| Element | Status | Notes |
|---------|--------|-------|
| Vendor name display | Works | Shows username + name |
| Logout button | Works | Clears session, redirects |
| Excel download button | Works | Downloads via /api/vendor/orders.xlsx |
| Refresh button | Works | Full page reload |
| Pending count badge | Works | Amber colored |
| Order cards | Works | Shows product, qty, option, recipient info |
| Copy buttons (name/phone/address/orderNo) | Works | Clipboard API with textarea fallback |
| Carrier dropdown | Works | Only hanjin/cj options |
| Tracking input | Works | Client-side validation |
| Save tracking button | Works | POST to server |
| Empty state | Works | Shows "주문 없음" |
| PWA hint | Present | "홈 화면에 추가" tip |

**Missing features**:
- No pagination
- No search/filter
- No date range filter
- No bulk tracking input
- No order status history

**Quality**: Works

### `/admin/login` - Admin Login Page

**File**: `/public/admin/login.html` + `/public/admin/login.js`

| Element | Status | Notes |
|---------|--------|-------|
| Username input | Works | Pre-filled with "han" |
| Password input | Works | |
| Login button | Works | POST /api/owner/login |
| Post-login redirect | Works | Redirects to /admin after 300ms |
| Navigation links | Works | Links to /admin and /admin/instagram |

**Quality**: Works

### `/admin` (Setup Page) - Admin Dashboard

**File**: `/public/admin/index.html` + `/public/admin/setup.js`

| Section | Status | Notes |
|---------|--------|-------|
| Stats summary | Works | Vendor count, product count, mapping count, order count, unassigned |
| 1) Vendor creation | Works | Name + username + password form |
| 2) Product CSV upload | Works | File input + upload button |
| 3) Product-vendor mapping | Works | Vendor dropdown, product search, checkbox list, save |
| 4) Order xlsx upload | Works | File input + password + upload button |
| 5) Unassigned order assignment | Works | Vendor dropdown, checkbox list, assign button |
| 6) Shipping export download | Works | Chunk/size inputs + download button |
| 7) Seed order creation | Works | Test order generation |
| Navigation | Works | Links to Setup, Instagram, Queue, Vendor |

**Issues**:
1. **Section numbering**: Section 5 (unassigned orders) appears AFTER section 6 (shipping export) in HTML, creating confusing flow.
2. **XSS in renderUnassigned**: Line 81 of setup.js uses string interpolation for product names without escaping: `${(o.productName||'').slice(0,60)}`. Product names from SmartStore could contain HTML.
3. **XSS in renderItems**: Line 57 of setup.js: `${p.productName}` without escaping.
4. **No vendor management UI**: Cannot edit/delete/disable vendors.

**Quality**: Works (with XSS risk)

---

## I) Summary & Recommendations

### Critical Bugs (Fix Immediately)

| # | Bug | Location | Impact | Fix Effort |
|---|-----|----------|--------|------------|
| 1 | **readMultipart argument mismatch in xlsx import** | server.mjs line 1702-1754 | Order xlsx import likely broken (or works by accident due to closure) | Delete the local redefinition at line 1702-1751; use module-level function. Low effort. |
| 2 | **Vendor cookie secure:false hardcoded** | server.mjs line 1970 | Session cookies sent over HTTP | Change to dynamic check like owner login. Low effort. |
| 3 | **Owner sessions never expire** | server.mjs lines 1300-1317 | Permanent session tokens. Stolen token = permanent access | Add expiresAt check in getOwnerFromSession(). Low effort. |

### High-Priority Issues (Fix Before Production)

| # | Issue | Category | Fix Effort |
|---|-------|----------|------------|
| 4 | No rate limiting on login endpoints | Security | Medium - add IP-based rate limiter |
| 5 | No CSRF protection | Security | Medium - add CSRF tokens or SameSite=Strict |
| 6 | XSS in admin setup.js (product names) | Security | Low - add escapeHtml() |
| 7 | Missing audit logs (vendor create, product upload, mapping) | Operations | Low |
| 8 | Incomplete carrier labels for shipping export | Functionality | Low - add all carrier labels |
| 9 | Phone/address null in order import | Functionality | Medium - update Python parser for correct SmartStore export format |
| 10 | Demo credentials shown on vendor login page | Security | Low - remove in production |

### Medium-Priority (Should Fix)

| # | Issue | Category |
|---|-------|----------|
| 11 | No vendor update/delete/disable | Functionality |
| 12 | No vendor password change flow | Functionality |
| 13 | Dead code: /api/vendor/orders/export.xlsx reads wrong fields | Code quality |
| 14 | Duplicate readMultipart function | Code quality |
| 15 | Uploaded xlsx files never cleaned up | Operations |
| 16 | No audit log rotation | Operations |
| 17 | Synchronous Python execution blocks event loop | Performance |
| 18 | No pagination on vendor orders | Performance |
| 19 | Mapping allows multi-vendor conflict (Map overwrite) | Data integrity |
| 20 | No double-assignment protection on orders | Data integrity |
| 21 | No order status lifecycle beyond "shipped" | Functionality |

### Architecture Assessment

**Storage**: JSON files on disk. Acceptable for MVP (<1000 orders, <50 vendors). Will need migration to SQLite or PostgreSQL for production scale. The `safeWriteJson` with tmp+rename is good practice.

**Backup**: Automatic JSON backups with 7-day retention. Good for MVP.

**Server**: Single-process Node.js HTTP server (no Express/Koa). Raw `http.createServer` with manual routing. Works but hard to maintain as endpoints grow. Consider migrating to a lightweight framework.

**Python dependency**: Two Python scripts for xlsx operations. Creates deployment complexity. The Node.js `xlsx` library already handles the export (endpoint 19 proves this). Only the encrypted xlsx IMPORT truly needs Python (`msoffcrypto`).

### Verdict: Modify, Don't Rebuild

The system is a functional MVP with clear architecture. The core data flow works:

```
Products CSV -> Mapping -> Order XLSX Upload -> Auto-Assignment -> Vendor Portal -> Tracking Input -> Shipping Export
```

The bugs are fixable (especially the critical readMultipart issue). The security gaps are addressable with incremental additions (rate limiting, CSRF, session expiry). The missing features (vendor CRUD, pagination, status lifecycle) are straightforward additions.

**Estimated effort to production-ready**: 3-5 days of focused work on the critical/high-priority items above.

---

### File Index

| File | Purpose | Lines |
|------|---------|-------|
| `server.mjs` | Main server (all routes, auth, business logic) | ~2504 |
| `public/admin/index.html` | Admin setup page | 134 |
| `public/admin/setup.js` | Admin setup JS | 234 |
| `public/admin/login.html` | Admin login page | 36 |
| `public/admin/login.js` | Admin login JS | 29 |
| `public/vendor/login.html` | Vendor login page | 35 |
| `public/vendor/login.js` | Vendor login JS | 23 |
| `public/vendor/orders.html` | Vendor orders page | 45 |
| `public/vendor/orders.js` | Vendor orders JS | 187 |
| `scripts/parse_smartstore_orders.py` | Encrypted xlsx parser | 95 |
| `scripts/export_vendor_orders_xlsx.py` | Vendor xlsx export | 60 |
| `data/vendors.json` | Vendor accounts (21 vendors) | 235 |
| `data/orders.json` | Order data (22 orders) | 496 |
| `data/products.json` | Product catalog (1 product) | 8 |
| `data/mapping.json` | Product-vendor mapping (2 entries) | 12 |
| `data/vendor_sessions.json` | Vendor session tokens (21 sessions) | 136 |
| `data/owner_sessions.json` | Owner session tokens (6 sessions) | 34 |
| `data/audit.jsonl` | Audit log (append-only) | ~500+ lines |
| `data/db.json` | Legacy/unused database file | 17 |

# Claude Code (Opus) — Instagram Semi-Automation (Brand Guide + Validator + Queue)

Copy/paste this prompt into **Claude Code (Opus)**. It is designed to run as a **~6-hour autonomous build** and produce a working feature + clean commit.

```text
You are Claude Code (Opus) acting as an autonomous project lead + implementation agent.
Use any team/agent/parallel features you have. Deliver working feature end-to-end with a clean commit.

WORKDIR
- /Users/hyunwoo/.openclaw/workspace/automation/dashboard

PRIMARY GOAL
Build an Instagram “semi-automation” system for SmartStore promotion:
- Generate/curate post drafts with consistent brand voice
- Approve + schedule 4 posts/day
- Remind Han to manually post (no auto-upload)
- Provide a stable, repeatable writing quality via:
  (1) Brand Guide + (2) Validator + (3) Queue

BUSINESS CONTEXT
- Category: skincare + makeup (luxury items like Dior lipstick)
- Purpose: drive 공동구매 conversion
- CTA policy: A/C mix
  - 3 posts/day use C: “프로필 링크”
  - 1 post/day use A: “댓글에 ‘공구’ 남기면 안내”
- Must look human, not spammy.

NON-NEGOTIABLE CONSTRAINTS
- Do NOT automate Instagram upload (no Playwright IG automation).
- Do NOT store Instagram credentials.
- No external paid APIs required.
- Admin endpoints must be protected by existing owner basic auth.
- JSON storage under /data (MVP).
- Must write audit logs to existing audit JSONL in server.mjs:
  IG_GUIDE_UPDATED, IG_DRAFT_CREATED, IG_DRAFT_VALIDATION_FAILED, IG_APPROVED,
  IG_RESCHEDULED, IG_MARK_SENT, IG_CANCELED, IG_REMINDER_SENT (if you implement reminder send).

DEFINITION OF DONE (what you must ship)
1) Admin UI page: /admin/instagram (or /social/instagram) linked from existing /admin.
2) “Brand Guide” editor:
   - stores in data/ig_brand_guide.json
   - includes: tone rules, banned phrases, emoji limits, line/length rules,
     hashtag recipe, CTA policy A/C mix, “luxury but not cheap” wording guidance.
3) “Draft Generator”:
   - inputs: productName, keyBenefit, price(optional), targetAudience(optional), notes(optional), tone(optional)
   - produces 3-5 variants using templates + seed-based variation.
   - BUT: generator must follow the Brand Guide strictly.
4) “Validator”:
   - validates each draft against Brand Guide:
     - banned words (e.g., 과장/최저가/무조건/대박/1등)
     - emoji count limit
     - hashtag count 12-18 and mix ratio (broad/niche/brand/cta)
     - contains required blocks (hook, body, CTA)
     - CTA ratio A/C in daily schedule
   - drafts that fail should be flagged with reasons and not approvable until fixed/regenerated.
5) Queue + scheduling:
   - data/ig_posts.json stores posts + settings slots (KST): 10:30/14:00/18:30/22:30
   - statuses: draft, approved, sent, canceled
   - approve selects a variant and assigns schedule slot (auto) + allow manual schedule edit.
6) Reminder mechanism:
   - Implement GET /api/admin/ig/posts_due?now=... returning due posts (status=approved, now>=scheduledAt, reminder not sent).
   - (Optional) If easy/clean, send Telegram via external layer, but DO NOT embed provider secrets here.
7) Tests:
   - run node syntax check
   - provide curl examples to create drafts, approve, reschedule, list due
8) Commit:
   - one clean commit: "feat: add instagram post queue with brand guide + validator"

STYLE / RESEARCH NOTE
We want to “borrow patterns” from Korean beauty influencers, not copy text:
- Build 3 style clusters inside Brand Guide defaults:
  1) 공감+찐후기형(담백)
  2) 정보형(똑똑한 소비)
  3) 럭셔리 감성형(짧고 세련)
Each generated batch should diversify across clusters but remain consistent with the guide.

IMPLEMENTATION DETAILS
- Existing app is a Node http server (server.mjs) + static public pages.
- Prefer minimal disruptive changes. It’s okay to add new files under public/admin and new JSON files under data.
- Ensure all admin APIs require owner basic auth.
- Use existing atomic JSON write + backups.
- Use auditLog() helper already present.

API ENDPOINTS (must implement)
- GET /api/admin/ig/guide
- POST /api/admin/ig/guide
- GET /api/admin/ig/posts
- POST /api/admin/ig/posts (create draft batch)
- POST /api/admin/ig/posts/:id/approve
- POST /api/admin/ig/posts/:id/reschedule
- POST /api/admin/ig/posts/:id/mark_sent
- POST /api/admin/ig/posts/:id/cancel
- GET /api/admin/ig/posts_due?now=...

UI FEATURES (must implement)
- Brand Guide editor (textarea + save)
- Draft generator form
- Draft variant cards:
  - show validation status + reasons
  - buttons: Copy caption, Copy hashtags, Approve & Schedule (only if valid)
- Queue table:
  - status filter
  - reschedule (datetime-local)
  - mark sent / cancel
  - show CTA type for each post (A or C)

DELIVERABLE
At the end, print:
- commit hash
- URLs to open
- quick steps to test in browser and curl.

BEGIN
1) First output a 10-15 bullet plan.
2) Then implement and commit.
```

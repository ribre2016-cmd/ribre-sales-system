# RIBRE Structure (Post pages-ization)

Last updated: 2026-05-11

## 1) Current `pages/` list

- `pages/dashboard.js`
- `pages/settings.js`
- `pages/ocr.js`
- `pages/storage-backup.js`
- `pages/storage-sync.js`
- `pages/storage-audit.js`
- `pages/storage-guide.js`
- `pages/app-search.js`
- `pages/app-templates.js`
- `pages/app-analysis.js`
- `pages/app-accounting.js`
- `pages/app-shipping.js`
- `pages/app-analytics.js`
- `pages/app-schema.js`
- `pages/app-migration.js`
- `pages/app-upsert.js`
- `pages/app-sync.js`
- `pages/app-mobile.js`
- `pages/app-report.js`

## 2) Script load order in `index.html`

### Services
1. `services/core.js`
2. `services/supabase-rest.js`
3. `services/supabase-auth.js`
4. `services/openai-ocr.js`
5. `services/app-main-v2.js?v=20260511b`
6. `services/storage.js`

### Pages
1. `pages/dashboard.js?v=20260511a`
2. `pages/settings.js`
3. `pages/ocr.js`
4. `pages/storage-backup.js`
5. `pages/storage-sync.js`
6. `pages/storage-audit.js`
7. `pages/storage-guide.js`
8. `pages/app-search.js`
9. `pages/app-templates.js`
10. `pages/app-analysis.js`
11. `pages/app-accounting.js`
12. `pages/app-shipping.js`
13. `pages/app-analytics.js`
14. `pages/app-schema.js`
15. `pages/app-migration.js`
16. `pages/app-upsert.js`
17. `pages/app-sync.js`
18. `pages/app-mobile.js`
19. `pages/app-report.js`

## 3) Dependency order notes (important)

- `app-main-v2.js` must load before pages that call globals like `refreshAll()`, `csvDownload()`, `renderList()`.
- `app-schema.js` must load before:
  - `app-migration.js` (`ver440` may use `ver430NormalizePreview`)
  - `app-upsert.js` (`ver450` uses `ver430NormalizePreview`)
- `openai-ocr.js` must load before `pages/ocr.js` (`registerEvidence`, `runOcr` flow dependency).
- `services/storage.js` must remain loaded (ver400/ver410/ver490 buttons still call these globals directly).
- `app-sync.js` relies on `refreshAll()` and should stay after `app-main-v2.js`.

## 4) Responsibility by page file

- `dashboard.js`: Dashboard summary and analytics (`ver420`, `ver510`, `monthlySummary`).
- `settings.js`: Supabase/OpenAI/auth settings + permissions/staff cloud (`saveSupabase`, `signIn`, `ver300`, `ver470`, `ver480`).
- `ocr.js`: AI/OCR candidate flow and production save (`ver500`).
- `storage-backup.js`: Backup (`ver290`, `ver530`).
- `storage-sync.js`: Sync (`ver320`, `ver540`).
- `storage-audit.js`: Audit logs (`ver550`).
- `storage-guide.js`: Guide/productization (`ver560`, `ver570`, `ver580`, `ver590`, `ver600`).
- `app-search.js`: Search/filter/export (`ver330`).
- `app-templates.js`: Template CRUD/apply (`ver340`).
- `app-analysis.js`: AI classify/data-check/fix tasks (`ver350`, `ver360`, `ver370`).
- `app-accounting.js`: Month close and accounting export (`ver380`, `ver390`).
- `app-shipping.js`: Shipping/Yahoo/unmatched diagnosis (`ver230`-`ver270`).
- `app-analytics.js`: Aggregation/chart/export (`ver280`).
- `app-schema.js`: Schema normalize + SQL helper (`ver430`).
- `app-migration.js`: Migration upload/load helpers (`ver440`).
- `app-upsert.js`: Dedupe/upsert flow (`ver450`).
- `app-sync.js`: Realtime sync timer/watcher (`ver460`).
- `app-mobile.js`: Mobile boot-time message (`ver310` behavior).
- `app-report.js`: Daily/weekly/operation report (`ver520`).

## 5) Inline script status

- Checked with `<script id="...">` search in `index.html`.
- Result: **0 inline script blocks remain**.

## 6) Unused candidate inventory (no deletion yet)

These are candidates only; keep behavior unchanged for now.

- `services/app-main.js`:
  - `index.html` loads `services/app-main-v2.js` only.
  - Candidate for cleanup after release verification.
- Legacy snapshot HTML files (`sales_management_Ver*.html`):
  - Not loaded by `index.html`.
  - Candidate archival target.
- Over-exposed helpers on `window`:
  - Many helper-level exports (`*Set`, `*Num`, `*Config`, `*Headers`, `*Url`, timer getters/setters) are likely not direct `onclick` targets.
  - Keep as-is now for compatibility; candidate for reduction after reference audit.

## 7) Duplicate helper check

- Pattern-level duplication exists (`verXXXRender`, `verXXXSet`, `verXXXNum`) but each version prefix is unique, so no direct naming collision.
- **Risk point**: `monthlySummary` exists in both `app-main-v2.js` and `pages/dashboard.js`; current behavior depends on load order (pages file loaded later, so pages definition wins).
- Timer globals are namespaced (`__ver460Timer`, `__ver540TimerPages`, `__ver590TimerPages`) and currently separated.

## 8) Vercel pre-deploy checklist

- Hard refresh and cache clear check:
  - `services/app-main-v2.js?v=20260511b` and `pages/dashboard.js?v=20260511a` are cache-busted.
- Confirm no 404 for all script src entries in production.
- Verify global button flows:
  - Dashboard refresh/monthly
  - Settings login/save
  - OCR analyze/save
  - Backup/sync/audit
  - Realtime watcher start/stop
  - Report daily/weekly/export
- Auth-expired behavior:
  - `ver540`, `ver550`, `ver440`, `ver480` should show relogin warning and avoid app-wide halt.
- Storage quota behavior:
  - OCR candidates/evidences/audit logs should degrade gracefully under quota pressure.
- Confirm `index.html` has no inline script regressions.

## 9) Next cleanup candidates (no behavior change)

1. Document exact `window` API contract (onclick-targeted vs internal helper).
2. Mark/remove dead script candidates (`services/app-main.js`, legacy snapshot HTML) in a separate cleanup PR.
3. `storage-cloud.js` split is completed (`storage-backup.js` / `storage-sync.js` / `storage-audit.js` / `storage-guide.js`).
4. Add a lightweight smoke-test checklist to `README.md` for deploy validation.

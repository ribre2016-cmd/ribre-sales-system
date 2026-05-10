# Ver56.0 Refactor Plan

## Target structure
/pages
/components
/services
/supabase
/ai
/storage
/sync
/analytics
/styles
/docs

## Safe order
1. Keep current index.html as backup.
2. Extract CSS.
3. Extract Supabase config/auth.
4. Extract Storage.
5. Extract AI OCR.
6. Extract CSV.
7. Extract sync/audit.
8. Move screen sections into pages.
9. Add beginner mode.
10. Test after each step.

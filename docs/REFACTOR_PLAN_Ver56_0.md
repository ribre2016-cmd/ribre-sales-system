# Ver56.0 Refactor Plan

> **Ver60 更新**: 現行の詳細手順・セクション対応表・フェーズ分けは [ARCHITECTURE_SPLIT_PLAN_Ver60.md](ARCHITECTURE_SPLIT_PLAN_Ver60.md) を参照。本ファイルは当初のディレクトリ案と安全な大まかな順序の記録として残す。

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

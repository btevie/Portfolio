# Overbill

Know what changed, what looks wrong, and what you could be overpaying — before you pay.

```bash
npm install
npm run dev            # http://localhost:3000
npm test               # vitest: deterministic audit engine (46 tests)
npx playwright install chromium && npm run test:e2e   # 17 end-to-end tests (port 3100)
```
Design direction: `docs/DESIGN.md`. All data is fictional demo data stored in localStorage; reset it in Settings.

Integration boundaries: `src/lib/data/repository.ts` (swap localStorage for an API/DB) and `src/lib/extraction/types.ts` (swap the mock PDF/image extractor for real OCR/document AI).

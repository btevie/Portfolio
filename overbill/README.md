# Overbill

Know what changed, what looks wrong, and what you could be overpaying — before you pay.

```bash
npm install
npm run dev            # http://localhost:3000
npm test               # vitest: deterministic audit engine (unit tests: audit rules, security regressions, recovery metrics)
npx playwright install chromium && npm run test:e2e   # end-to-end tests (port 3100)
```
Design direction: `docs/DESIGN.md`. All data is fictional demo data stored in localStorage; reset it in Settings.

Integration boundaries: `src/lib/data/repository.ts` (swap localStorage for an API/DB) and `src/lib/extraction/types.ts` (file size/type limits and extraction method types).

## Security & privacy model (read before deploying)

Overbill is a **local-first demo**: there is no server, no real accounts and no database. "Sign up" and "Log in" only set up or look up a profile (name, email, optional picture) saved in this browser. The password field is never stored or checked, and nothing stops someone using the same browser profile from opening the app: **the profile is not a security boundary**.

- **Nothing is uploaded.** Invoice data is never sent anywhere. File contents are never saved; CSV files are read in the browser. The one optional network use is **Sign in with Google**: only when `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is set, signing in loads Google's script and may show the Google profile picture from Google. The CSP is widened for Google only in that case. The sign-in token is read in the browser, not verified by a server, and only fills in the local profile.
- **Extracted fields are stored unencrypted** in `localStorage` (`overbill:v1`). Anyone with access to the browser profile, an extension, or another script on the same origin can read or alter them. Stored data is validated on load (bad records are skipped and the user is told), but it is **not a trust boundary**: totals such as "recovered" are self-attested.
- **PDFs with a selectable text layer are parsed in the browser by pattern** (check the figures; layouts vary). Scanned PDFs and photos use on-device OCR and require the user to confirm the highlighted fields. If pdf.js cannot open a PDF at all (for example, it is encrypted or corrupt), it may fall back to scripted demo figures marked "Simulated" (known limitation). Set `NEXT_PUBLIC_OVERBILL_MOCK_EXTRACTION=off` at build time to refuse PDFs/images entirely and prevent that fallback; CSV, saved email and pasted text remain available.
- **Backups and sample data:** restoring a backup shows what it holds and asks before replacing your data; saved and restored records are validated (no negative amounts, unique ids, at most 5000 invoices/recovery cases). `/demo` never replaces data you created: it asks first. Profile pictures are checked for pixel size from the file header before decoding.
- **Input limits:** 10 MB per file, 10 files, 500 line items, amounts up to 12 integer / 6 decimal digits, no negatives (credit notes unsupported), invisible/bidi characters stripped.
- **Headers** (`next.config.ts`): CSP, HSTS (HTTPS only), frame/sniff/referrer/permissions policies. The CSP allows `'unsafe-inline'` scripts/styles (a nonce would force dynamic rendering), so it restricts origins and connections but is not a strong XSS mitigation by itself.
- **Before adding a backend:** add authentication and per-user authorisation, server-side file validation, CSRF protection on mutations, and re-validate every number server-side. Client-side checks are not enough.

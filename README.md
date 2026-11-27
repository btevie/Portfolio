# Overbill

Know what changed, what looks wrong, and what you could be overpaying — before you pay.

```bash
npm install
npm run dev            # http://localhost:3000
npm test               # vitest: deterministic audit engine (unit tests: audit rules, security regressions, recovery metrics)
npx playwright install chromium && npm run test:e2e   # end-to-end tests (port 3100)
```
Design direction: `docs/DESIGN.md`. All data is fictional demo data stored in localStorage; reset it in Settings.

Integration boundaries: `src/lib/data/repository.ts` (swap localStorage for an API/DB) and `src/lib/extraction/types.ts` (swap the mock PDF/image extractor for real OCR/document AI).

## Security & privacy model (read before deploying)

Overbill is a **local-first demo**: there is no server, no real accounts and no database. "Sign up" and "Log in" only set up or look up a profile (name, email, optional picture) saved in this browser. The password field is never stored or checked, and nothing stops someone using the same browser profile from opening the app: **the profile is not a security boundary**.

- **Nothing is uploaded.** Invoice data is never sent anywhere. File contents are never saved; CSV files are read in the browser. The one optional network use is **Sign in with Google**: only when `NEXT_PUBLIC_GOOGLE_CLIENT_ID` is set, signing in loads Google's script and may show the Google profile picture from Google. The CSP is widened for Google only in that case. The sign-in token is read in the browser, not verified by a server, and only fills in the local profile.
- **Extracted fields are stored unencrypted** in `localStorage` (`overbill:v1`). Anyone with access to the browser profile, an extension, or another script on the same origin can read or alter them. Stored data is validated on load (bad records are skipped and the user is told), but it is **not a trust boundary**: totals such as "recovered" are self-attested.
- **PDFs with a selectable text layer are parsed in the browser by pattern** (check the figures; layouts vary). A PDF with no text layer or an unreadable layout is rejected with an error; a file pdf.js cannot open at all (e.g. encrypted/corrupt) falls back to the scripted demo, still labelled "Simulated" (known limitation). **Photos/scans are a mock**: they never read the file and return scripted demo figures chosen by file name, marked "Simulated". Set `NEXT_PUBLIC_OVERBILL_MOCK_EXTRACTION=off` at build time for any deployment that handles real invoices; PDFs/images are then refused and only CSV / pasted text are accepted.
- **Backups and sample data:** restoring a backup shows what it holds and asks before replacing your data; saved and restored records are validated (no negative amounts, unique ids, at most 5000 invoices/recovery cases). `/demo` never replaces data you created: it asks first. Profile pictures are checked for pixel size from the file header before decoding.
- **Input limits:** 10 MB per file, 10 files, 500 line items, amounts up to 12 integer / 6 decimal digits, no negatives (credit notes unsupported), invisible/bidi characters stripped.
- **Headers** (`next.config.ts`): CSP, HSTS (HTTPS only), frame/sniff/referrer/permissions policies. The CSP allows `'unsafe-inline'` scripts/styles (a nonce would force dynamic rendering), so it restricts origins and connections but is not a strong XSS mitigation by itself.
- **Before adding a backend:** add authentication and per-user authorisation, server-side file validation, CSRF protection on mutations, and re-validate every number server-side. Client-side checks are not enough.

# Overbill — Design direction

Selected with the UI UX Pro Max design-system query ("fintech invoice monitoring SaaS trustworthy minimal").

- **Pattern/Style:** Minimalism & Swiss — grid-based, high contrast, functional, spacious but dense where data lives.
- **Typography:** Inter (single family). Tabular numerals for all money. Strong size/weight hierarchy over colour.
- **Colour:** Neutral slate surfaces (`#F8FAFC` canvas, white cards, `#E4E7EB` hairlines). Navy `#1E3A5F` is the only brand colour (primary actions, focus ring).
  Green / amber / red are reserved for financial status only (CLEAR / REVIEW NEEDED / LIKELY ERROR). Status text colours are the 800-weight on a 50/100 tint to hold >= 4.5:1.
- **Shape:** 8px radius, 1px borders, no heavy shadows, no gradients, no glass.
- **Motion:** 150ms colour/opacity transitions only; everything respects `prefers-reduced-motion`.
- **Icons:** lucide-react only. No emoji.
- **Language:** The product never says "the vendor made an error". The engine produces *anomalies*; only the user can promote one to a *confirmed error*.
- **Accessibility:** Native elements first (`<dialog>`, `<button>`, `<table>`), visible focus rings, skip link, `aria-live` for async status, status is never colour-only (icon + label).

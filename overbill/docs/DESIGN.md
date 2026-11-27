# Overbill — Design direction

## Current: "Ledger"
Supersedes the earlier teal, Swiss and pine/ember directions.

- **Surfaces:** one canvas, opaque cards with a hairline ring. No glass, blur or decorative gradients/circles. Prefer ruled strips and lists to grids of identical cards.
- **Colour has one job each:** green = action and money actually recovered; amber = an anomaly or possible overcharge (not confirmed); red = only an overdue date or a confirmed error. Never colour alone: pair with a label or icon. Never show an overcharge in green.
- **Alarm pattern:** an open finding is a neutral card with a 4px amber left edge, never a full-colour block.
- **Type:** Fira Sans, tabular numerals for money, display font only on the landing hero.
- **Language:** engine output is an *anomaly* / *possible overcharge*; only the user can promote it to a *confirmed error*. "Nothing flagged" never means "safe". Demo extraction is always labelled.
- **Sign-in:** only providers that actually work are shown (Google, and only when a client ID is configured).
- **Accessibility:** native elements, visible focus, aria-live status, reduced motion respected, 44px touch targets on coarse pointers.
- **Tools:** 21st.dev search was not used; `.21st/design.json` mirrors the tokens.

## Previous (superseded): Minimalism & Swiss
Inter-only, slate neutrals, navy primary, 8px radius, no gradients.

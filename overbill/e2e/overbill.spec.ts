import { expect, test as base, type Page } from "@playwright/test";

/** Pages are server-rendered first; wait for hydration so clicks and file inputs are never lost to a race. */
const test = base.extend({
  page: async ({ page }, use) => {
    const goto = page.goto.bind(page);
    page.goto = async (url, options) => {
      const res = await goto(url, options);
      await page.waitForFunction(() => document.documentElement.dataset.hydrated === "1");
      await page.waitForLoadState("networkidle");
      return res;
    };
    await use(page);
  },
});
const openDetails = (page: Page) => page.getByRole("button", { name: /Invoice details & history/ }).click();

const pdf = (name: string) => ({ name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 demo") });

async function uploadAndCheck(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto("/invoices/new");
  await page.getByLabel("Choose invoice files").setInputFiles(file);
  await expect(page.locator("[data-state]").filter({ hasText: file.name })).toBeVisible();
  await page.getByRole("button", { name: /Check 1 invoice/ }).click();
  const link = page.getByRole("link", { name: /See what we found|Open invoice/ });
  await expect(link).toBeVisible({ timeout: 15_000 });
  await link.click();
}

test("1. dashboard loads with actionable figures", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  const kpis = page.getByRole("region", { name: "Key figures" });
  await expect(kpis).toContainText("Possible overcharges");
  await expect(kpis).toContainText("€478.56");
  await expect(kpis).toContainText("Money received back");
  await expect(kpis).toContainText("€192.40");
  await expect(page.getByText("Demo data.")).toBeVisible();
  await expect(page.getByTestId("plain-summary")).toContainText("5 invoices need a look");
  await expect(page.getByTestId("plain-summary")).toContainText("€478.56 may be overcharged");
  // charts are tucked away until asked for
  await expect(page.getByText("Vendor price changes")).toBeHidden();
  await page.getByText(/Charts & trends/).click();
  await expect(page.getByText("Vendor price changes")).toBeVisible();
});

test("2. navigation works", async ({ page }) => {
  await page.goto("/dashboard");
  for (const [link, heading] of [["Invoices", "Invoices"], ["Vendors", "Vendors"], ["Recovery", "Recovery tracker"], ["Settings", "Settings"], ["Dashboard", "Dashboard"]] as const) {
    await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: link }).click();
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible();
  }
  await page.getByRole("link", { name: "Check an invoice" }).first().click();
  await expect(page).toHaveURL(/\/invoices\/new/);
});

test("3. upload validates files, lets you remove them, and runs the flow", async ({ page }) => {
  await page.goto("/invoices/new");
  const input = page.getByLabel("Choose invoice files");
  await input.setInputFiles({ name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.locator("main [role=alert]")).toContainText("isn't supported");
  await page.getByRole("button", { name: "Remove notes.txt" }).click();
  await expect(page.getByText("notes.txt")).toHaveCount(0);

  await input.setInputFiles({ name: "huge.pdf", mimeType: "application/pdf", buffer: Buffer.alloc(10 * 1024 * 1024 + 1) });
  await expect(page.locator("main [role=alert]")).toContainText("larger than 10 MB");
  await page.getByRole("button", { name: "Remove huge.pdf" }).click();

  await input.setInputFiles([pdf("one-clear.pdf"), pdf("two-clear.pdf")]);
  await page.getByRole("button", { name: "Remove two-clear.pdf" }).click();
  await expect(page.getByRole("button", { name: /Check 1 invoice$/ })).toBeVisible();
  await page.getByRole("button", { name: /Check 1 invoice/ }).click();
  await expect(page.getByRole("progressbar")).toBeVisible();
  await expect(page.getByRole("link", { name: /See what we found|Open invoice/ })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/File contents not saved/)).toBeVisible();
});

test("4–8. uploaded scenarios are analysed: clear, arithmetic, duplicate, price increase, new fee", async ({ page }) => {
  await uploadAndCheck(page, pdf("brightline-clear.pdf"));
  await expect(page.getByRole("heading", { name: /Northwind Hosting/, level: 1 })).toBeVisible();
  await expect(page.getByText("No findings")).toBeVisible();

  await uploadAndCheck(page, pdf("duplicate-resend.pdf"));
  await expect(page.getByText("Exact duplicate of an invoice you already have")).toBeVisible();

  await uploadAndCheck(page, pdf("math-error.pdf"));
  await expect(page.getByText("Total doesn't equal subtotal − discounts + tax + fees")).toBeVisible();
  await expect(page.getByText("Likely error").first()).toBeVisible();

  await uploadAndCheck(page, pdf("price-increase.pdf"));
  await expect(page.getByText(/higher than your usual with Brightline/)).toBeVisible();

  await uploadAndCheck(page, pdf("new-fee.pdf"));
  await expect(page.getByText(/New fee that wasn't on earlier invoices: "Cleaning surcharge"/)).toBeVisible();
});

test("5. seeded arithmetic discrepancy is detected", async ({ page }) => {
  await page.goto("/invoices/inv-stackly-4");
  await expect(page.getByText(/Line total doesn't match quantity × price/)).toBeVisible();
  await openDetails(page);
  await expect(page.getByText("€114.00").first()).toBeVisible();
  await expect(page.getByText("€124.00").first()).toBeVisible();
});

test("6. seeded duplicate invoice is detected", async ({ page }) => {
  await page.goto("/invoices/inv-orbit-resend");
  await expect(page.getByText("Exact duplicate of an invoice you already have")).toBeVisible();
  await expect(page.getByText("Likely error").first()).toBeVisible();
});

test("7. seeded price increase is an anomaly, not a confirmed error", async ({ page }) => {
  await page.goto("/invoices/inv-northwind-7");
  await expect(page.getByText(/15\.0% higher than your usual/)).toBeVisible();
  await expect(page.getByText("Confirmed error", { exact: true })).toHaveCount(0);
  await expect(page.getByText("Review needed").first()).toBeVisible();
});

test("8. clear invoice and legitimate variable-cost invoice show no findings", async ({ page }) => {
  await page.goto("/invoices/inv-brightline-4");
  await expect(page.getByText("No findings")).toBeVisible();
  await expect(page.getByText("Everything looks consistent").first()).toBeVisible();
  await page.goto("/invoices/inv-lumen-7");
  await expect(page.getByText("No findings")).toBeVisible();
  await openDetails(page);
  await expect(page.getByText("Change vs rolling 6-month average")).toBeVisible();
});

test("9. finding detail opens and shows evidence, confidence and uncertainty", async ({ page }) => {
  await page.goto("/invoices/inv-meridian-4");
  // the first open finding is already expanded; collapsing and reopening still works
  await expect(page.getByRole("button", { name: "Hide details" })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: "Hide details" }).click();
  await page.getByRole("button", { name: "View details" }).click();
  await expect(page.getByRole("button", { name: "Hide details" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Why we flagged this", { exact: true })).toBeVisible();
  await expect(page.getByText(/Agreed rate \(entered by you\)/)).toBeVisible();
  await expect(page.getByText("What we can't be sure about")).toBeVisible();
  await expect(page.getByText("What to do next", { exact: true })).toBeVisible();
  // user, not the engine, promotes an anomaly to a confirmed error
  await page.getByRole("button", { name: "I agree: confirm this is an error" }).click();
  await expect(page.getByText("Confirmed error", { exact: true })).toBeVisible();
});

test("10. dispute note can be edited and copied; nothing is sent", async ({ page }) => {
  await page.goto("/invoices/inv-orbit-resend");
  await page.getByRole("button", { name: "Generate dispute note" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("never sends anything")).toBeVisible();
  const box = dialog.getByLabel(/Draft note/);
  await expect(box).toHaveValue(/Hello Orbit Workspace team/);
  await expect(box).toHaveValue(/It appears that/);
  const edited = "Hi Orbit — please confirm OW-2211 was only meant to be billed once. Thanks, Demo";
  await box.fill(edited);
  await expect(dialog.getByText("· edited")).toBeVisible();
  await dialog.getByRole("button", { name: "Copy to clipboard" }).click();
  await expect(dialog.getByText("Copied to clipboard.")).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(edited);
});

test("11. recovery status can be updated and stats follow", async ({ page }) => {
  await page.goto("/recovery");
  await expect(page.getByRole("region", { name: "Recovery figures" })).toContainText("€192.40");
  await page.getByRole("button", { name: "Duplicate November invoice OW-2211" }).click();
  const sheet = page.getByRole("dialog");
  await sheet.getByRole("button", { name: "Status" }).click();
  await sheet.getByRole("option", { name: "Recovered" }).click();
  await sheet.getByLabel("Notes").fill("Vendor refunded on 26 Nov.");
  await sheet.getByLabel("Notes").blur();
  await expect(sheet.getByText("Notes saved")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("region", { name: "Recovery figures" })).toContainText("€531.20");
  await expect(page.getByRole("heading", { name: /^Recovered\s*3/ })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("region", { name: "Recovery figures" })).toContainText("€531.20");
  await expect(page.getByRole("button", { name: "Duplicate November invoice OW-2211" })).toHaveCount(1);
  await page.getByRole("button", { name: "Duplicate November invoice OW-2211" }).click();
  await expect(page.getByRole("dialog").getByRole("button", { name: "Status" })).toContainText("Recovered");
  // the finding resolves, so the invoice no longer needs review
  await page.goto("/invoices/inv-orbit-resend");
  await expect(page.getByText("All findings are resolved or dismissed.")).toBeVisible();
});

test("11b. one click moves a case to its next stage", async ({ page }) => {
  await page.goto("/recovery");
  await expect(page.getByRole("heading", { name: /^Disputed\s*1/ })).toBeVisible();
  await page.getByRole("button", { name: "Mark as disputed" }).click();
  await expect(page.getByRole("heading", { name: /^Disputed\s*2/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: /^Flagged\s*0/ })).toBeVisible();
});

test("12. vendor search, filter, sort and detail", async ({ page }) => {
  await page.goto("/vendors?view=table");
  await expect(page.locator("tbody tr")).toHaveCount(6);
  await page.getByLabel("Search vendors").fill("orb");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("Orbit Workspace");
  await page.getByLabel("Search vendors").fill("");
  await page.getByLabel("Filter by category").selectOption("Telecom");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByLabel("Filter by category").selectOption("all");
  await page.getByRole("button", { name: /^Needs review/ }).click();
  await expect(page.locator("tbody")).toContainText("Northwind");
  await expect(page.locator("tbody")).not.toContainText("Lumen");
  await page.getByRole("button", { name: /^All vendors/ }).click();
  await page.getByLabel("Sort vendors").selectOption("change");
  await expect(page.locator("tbody tr").first()).toContainText("Northwind Hosting");
  await page.getByLabel("Search vendors").fill("zzz");
  await expect(page.getByText("No vendor by that name")).toBeVisible();
  await page.getByLabel("Search vendors").fill("northwind");
  await page.getByRole("link", { name: "Northwind Hosting" }).click();
  await expect(page.getByRole("heading", { name: "Northwind Hosting", level: 1 })).toBeVisible();
  await expect(page.getByRole("img", { name: /invoice totals/ })).toBeVisible();
  await expect(page.getByText(/Looks like a monthly charge/)).toBeVisible();
  // user-defined expected amount drives a new finding
  await page.getByRole("button", { name: /What you expect to pay/ }).click();
  await page.getByLabel(/Expected invoice total/).fill("145.20");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Expected amount saved.")).toBeVisible();
  await page.goto("/invoices/inv-northwind-7");
  await expect(page.getByText("Total differs from the amount you expect from this vendor")).toBeVisible();
});

test("13. settings can be changed and persist", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Preferred currency" }).click();
  await page.getByRole("option", { name: /\(USD\)/ }).click();
  await page.getByLabel("Name", { exact: true }).fill("Sam Tester");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();
  await page.getByRole("button", { name: "Monitoring" }).click();
  await page.getByText("Strict", { exact: true }).click();
  await page.getByRole("button", { name: "Reminders" }).click();
  await page.getByRole("switch", { name: "Overdue reviews" }).click();
  await page.reload();
  await expect(page.getByRole("button", { name: "Preferred currency" })).toContainText("(USD)");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Sam Tester");
  await page.getByRole("button", { name: "Monitoring" }).click();
  await expect(page.getByRole("radio", { name: /Strict/ })).toBeChecked();
  await page.getByRole("button", { name: "Reminders" }).click();
  await expect(page.getByRole("switch", { name: "Overdue reviews" })).toHaveAttribute("aria-checked", "false");
  // currency preference only totals matching invoices; nothing is converted
  await page.goto("/dashboard");
  await expect(page.getByRole("region", { name: "Key figures" })).toContainText("$0.00");
});

test("13b. sensitivity changes how seriously a price increase is rated", async ({ page }) => {
  await page.goto("/invoices/inv-northwind-7");
  await expect(page.getByText("Medium severity")).toBeVisible();
  await page.goto("/settings");
  await page.getByRole("button", { name: "Monitoring" }).click();
  await page.getByText("Strict", { exact: true }).click();
  await page.goto("/invoices/inv-northwind-7");
  await expect(page.getByText("High severity")).toBeVisible();
});

test("14. demo data can be cleared and reset", async ({ page }) => {
  await page.goto("/invoices/inv-stackly-4");
  await page.getByRole("button", { name: "Delete invoice" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete invoice" }).click();
  await expect(page).toHaveURL(/\/invoices$/);
  await page.getByLabel("Search invoices").fill("Stackly"); // the register is paginated, so narrow it first
  await expect(page.getByRole("link", { name: "Stackly Software" })).toHaveCount(3); // 4 before, the deleted one is gone

  await page.goto("/settings");
  await page.getByRole("button", { name: "Privacy & data" }).click();
  await page.getByRole("button", { name: "Delete all data" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete everything" }).click();
  await expect(page.getByText("All data deleted.")).toBeVisible();
  await page.goto("/dashboard");
  await expect(page.getByText("Your invoice history starts here")).toBeVisible();

  await page.goto("/settings");
  await page.getByRole("button", { name: "Privacy & data" }).click();
  await page.getByRole("button", { name: "Reset demo data" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Reset demo data" }).click();
  await expect(page.getByText("Demo data restored.")).toBeVisible();
  await page.goto("/dashboard");
  await expect(page.getByRole("region", { name: "Key figures" })).toContainText("€478.56");
  await page.goto("/invoices/inv-stackly-4");
  await expect(page.getByText(/Line total doesn't match/)).toBeVisible();
});

test("pasted text and CSV are parsed for real; missing fields trigger a review step", async ({ page }) => {
  await page.goto("/invoices/new");
  await page.getByRole("tab", { name: "Paste text" }).click();
  await page.getByRole("button", { name: "Insert a sample invoice" }).click();
  await page.getByRole("button", { name: "Check pasted invoice" }).click();
  await expect(page.getByRole("link", { name: /See what we found|Open invoice/ })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("link", { name: /See what we found|Open invoice/ }).click();
  await expect(page.getByRole("heading", { name: /Brightline Telecom · BT-88105/ })).toBeVisible();
  await expect(page.getByText("No findings")).toBeVisible();

  await page.goto("/invoices/new");
  const csv = "description,quantity,unit_price\nConsulting,10,90.00\n";
  await page.getByLabel("Choose invoice files").setInputFiles({ name: "acme.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: /Check 1 invoice/ }).click();
  await expect(page.getByText("Some invoice details couldn't be extracted confidently.")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Please confirm").first()).toBeVisible();
  await page.getByLabel("Vendor", { exact: true }).fill("Meridian Accounting");
  await page.getByLabel("Invoice number", { exact: true }).fill("MA-400");
  await page.getByLabel("Invoice date", { exact: true }).fill("2026-11-24");
  await page.getByLabel("Due date", { exact: true }).fill("2026-12-15");
  await page.getByLabel(/I checked the highlighted fields/).check();
  await page.getByRole("button", { name: "Confirm and run audit" }).click();
  await page.getByRole("link", { name: /See what we found|Open invoice/ }).click({ timeout: 15_000 });
  // typed "Consulting" doesn't match the "bookkeeping" contract rate, so only the history/arith rules apply
  await expect(page.getByRole("heading", { name: /Meridian Accounting · MA-400/ })).toBeVisible();
});

test("mobile layout: bottom bar navigates", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/dashboard");
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Vendors" }).click();
  await expect(page.getByRole("heading", { name: "Vendors", level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

// ---------- security regressions ----------

test("simulated PDF extraction is clearly labelled everywhere it appears", async ({ page }) => {
  await uploadAndCheck(page, pdf("my-real-invoice.pdf"));
  await expect(page.getByRole("alert").filter({ hasText: "Simulated extraction" })).toContainText("not your document");
  await expect(page.getByRole("alert").filter({ hasText: "Simulated extraction" })).toContainText("never read");
  await page.goto("/invoices");
  await expect(page.getByText("Simulated", { exact: true }).first()).toBeVisible();
});

test("a file whose contents don't match its extension is refused", async ({ page }) => {
  await page.goto("/invoices/new");
  await page.getByLabel("Choose invoice files").setInputFiles({ name: "invoice.pdf", mimeType: "application/pdf", buffer: Buffer.from("<html><script>alert(1)</script></html>") });
  await expect(page.locator("main [role=alert]")).toContainText("contents don't match");
  await expect(page.getByRole("button", { name: /Check \d+ invoice/ })).toHaveCount(0);
});

test("damaged saved data never bricks the app", async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem("overbill:v1", '{"version":1,"vendors":null}'));
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByRole("heading", { name: "Settings", level: 1 })).toBeVisible();
});

test("invalid saved records are skipped and the user is told", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Reminders" }).click();
  await page.getByRole("switch", { name: "Overdue reviews" }).click(); // first write persists the state
  await page.evaluate(() => {
    const s = JSON.parse(localStorage.getItem("overbill:v1")!);
    s.invoices.push({ id: "evil", total: "<img src=x onerror=alert(1)>" });
    localStorage.setItem("overbill:v1", JSON.stringify(s));
  });
  await page.goto("/dashboard");
  await expect(page.getByText(/1 saved record was invalid and skipped/)).toBeVisible();
  await expect(page.getByRole("region", { name: "Key figures" })).toContainText("Possible overcharges");
});

test("distinct non-Latin vendors stay separate vendors", async ({ page }) => {
  const paste = async (vendor: string, number: string) => {
    await page.goto("/invoices/new");
    await page.getByRole("tab", { name: "Paste text" }).click();
    await page.getByLabel("Paste invoice text").fill(`Vendor: ${vendor}\nInvoice #: ${number}\nInvoice date: 2026-11-20\nDue date: 2026-12-20\nCurrency: EUR\nMonthly fee | 1 | 10.00 | 10.00\nTotal: 10.00`);
    await page.getByRole("button", { name: "Check pasted invoice" }).click();
    await expect(page.getByRole("link", { name: /See what we found|Open invoice/ })).toBeVisible({ timeout: 15_000 });
  };
  await paste("株式会社アルファ", "A-1");
  await paste("株式会社ベータ", "A-1");
  await page.goto("/vendors?view=table");
  await expect(page.locator("tbody tr")).toHaveCount(8);
  await expect(page.locator("tbody")).toContainText("株式会社アルファ");
  await expect(page.locator("tbody")).toContainText("株式会社ベータ");
});

test("bidi/invisible characters pasted into an invoice are stripped", async ({ page }) => {
  await page.goto("/invoices/new");
  await page.getByRole("tab", { name: "Paste text" }).click();
  await page.getByLabel("Paste invoice text").fill("Vendor: Acme‮gnirts Ltd\nInvoice #: S-1\nInvoice date: 2026-11-20\nDue date: 2026-12-20\nCurrency: EUR\nItem | 1 | 10.00 | 10.00\nTotal: 10.00");
  await page.getByRole("button", { name: "Check pasted invoice" }).click();
  await page.getByRole("link", { name: /See what we found|Open invoice/ }).click({ timeout: 15_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Acme gnirts Ltd · S-1");
});

test("an oversized CSV is rejected with a clear message", async ({ page }) => {
  await page.goto("/invoices/new");
  const rows = "description,quantity,unit_price\n" + Array.from({ length: 501 }, () => "Item,1,1.00").join("\n");
  await page.getByLabel("Choose invoice files").setInputFiles({ name: "big.csv", mimeType: "text/csv", buffer: Buffer.from(rows) });
  await page.getByRole("button", { name: /Check 1 invoice/ }).click();
  await expect(page.locator("main [role=alert]")).toContainText("more than 500 line items");
});

test("'Delete all data' also blanks the profile", async ({ page }) => {
  await page.goto("/settings");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Demo User");
  await page.getByRole("button", { name: "Privacy & data" }).click();
  await page.getByRole("button", { name: "Delete all data" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete everything" }).click();
  await page.getByRole("button", { name: "Profile", exact: true }).click();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("");
  await expect(page.getByLabel("Email")).toHaveValue("");
  await page.reload();
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("");
});

test("privacy copy states that extracted fields are stored unencrypted", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Privacy & data" }).click();
  await expect(page.getByText(/unencrypted/).first()).toBeVisible();
  await page.goto("/invoices/new");
  await expect(page.getByText(/unencrypted/).first()).toBeVisible();
});

test("security headers are sent, the framework isn't advertised, and the CSP doesn't break any page", async ({ page, request }) => {
  const res = await request.get("/dashboard");
  const h = res.headers();
  expect(h["content-security-policy"]).toContain("object-src 'none'");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["content-security-policy"]).toContain("connect-src 'self'");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["referrer-policy"]).toBe("no-referrer");
  expect(h["x-powered-by"]).toBeUndefined();

  const violations: string[] = [];
  page.on("console", (m) => { if (/content security policy/i.test(m.text())) violations.push(m.text()); });
  page.on("pageerror", (e) => violations.push(String(e)));
  for (const url of ["/dashboard", "/invoices", "/invoices/inv-orbit-resend", "/invoices/new", "/vendors", "/vendors/v-orbit", "/recovery", "/settings"]) {
    await page.goto(url);
    await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  }
  expect(violations).toEqual([]);
});

test("pending credit is not counted as received money or as a paid-out case", async ({ page }) => {
  await page.goto("/recovery");
  const figures = page.getByRole("region", { name: "Recovery figures" });
  await expect(figures).toContainText("€192.40");
  await expect(figures).toContainText("€25.00 in credit issued, not yet applied");
  await expect(figures).toContainText("2 of 3 closed cases paid out");
  await expect(figures).toContainText("1 credit pending, not counted");
  await page.goto("/dashboard");
  const kpis = page.getByRole("region", { name: "Key figures" });
  await expect(kpis).toContainText("€192.40");
  await expect(kpis).toContainText("€25.00 in credit issued, not yet applied");
});

// ---------- landing + log in / sign up ----------

test("home page offers log in and sign up, and sign up saves a local profile", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("overcharge");
  await expect(page.getByRole("link", { name: "Log in" }).first()).toBeVisible();
  await page.getByRole("link", { name: "Sign up" }).first().click();
  await expect(page).toHaveURL(/\/sign-up/);
  await page.getByLabel("Name").fill("Sam Tester");
  await page.getByLabel("Email").fill("sam@example.com");
  await page.getByLabel("Password").fill("demo-pass");
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Use sample data" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/settings");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Sam Tester");
});

test("log in checks the email saved on this device", async ({ page }) => {
  await page.goto("/log-in");
  await page.getByLabel("Email").fill("nobody@example.com");
  await page.getByLabel("Password").fill("x");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await expect(page.getByText("No profile with that email")).toBeVisible();
  await page.getByLabel("Email").fill("demo@overbill.example");
  await page.getByLabel("Password").fill("x");
  await page.getByRole("button", { name: "Log in", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Use sample data" }).click();
  await expect(page).toHaveURL(/\/dashboard/);
});

// ---------- public pages, backup and restore ----------

test("public pages load and are linked from the home page footer", async ({ page }) => {
  await page.goto("/");
  for (const [name, heading] of [["How it works", "How it works"], ["Help", "Help"], ["Your data", "Your data"], ["Privacy", "Privacy"], ["Terms", "Terms"]] as const) {
    await page.goto("/");
    await page.getByRole("navigation", { name: "Footer" }).getByRole("link", { name }).click();
    await expect(page.getByRole("heading", { name: heading, level: 1 })).toBeVisible({ timeout: 20_000 }); // first visit compiles the page in dev
  }
  await page.goto("/privacy");
  await expect(page.getByText("not encrypted").first()).toBeVisible();
});

test("a backup can be downloaded, the data erased, then restored", async ({ page }) => {
  await page.goto("/data");
  const [download] = await Promise.all([page.waitForEvent("download"), page.getByRole("button", { name: "Download backup" }).click()]);
  const path = await download.path();
  await page.getByRole("button", { name: "Erase all data" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Erase everything" }).click();
  await expect(page.getByText("All data erased.")).toBeVisible();
  await expect(page.getByText(/Right now: 0 invoices/)).toBeVisible();
  await page.getByLabel("Choose backup file").setInputFiles(path);
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Replace your data with this backup?" })).toBeVisible();
  await page.getByRole("dialog").getByRole("button", { name: "Replace my data" }).click();
  await expect(page.getByText("Backup restored.")).toBeVisible();
  await expect(page.getByText(/Right now: 34 invoices/)).toBeVisible();
});

test("a file that is not a backup is refused and nothing changes", async ({ page }) => {
  await page.goto("/data");
  await page.getByLabel("Choose backup file").setInputFiles({ name: "x.json", mimeType: "application/json", buffer: Buffer.from('{"hello":1}') });
  await expect(page.getByText("not an Overbill backup")).toBeVisible();
  await expect(page.getByText(/Right now: 34 invoices/)).toBeVisible();
});

test("sample data link loads the dashboard", async ({ page }) => {
  await page.goto("/demo");
  await expect(page).toHaveURL(/\/dashboard/);
});

test("the sample-data banner invites the visitor to sign up, until they have a profile", async ({ page }) => {
  await page.goto("/dashboard");
  await page.getByRole("link", { name: "Sign up to save your own" }).click();
  await expect(page).toHaveURL(/\/sign-up/, { timeout: 20_000 });
  await page.getByLabel("Name").fill("Sam Tester");
  await page.getByLabel("Email").fill("sam@example.com");
  await page.getByLabel("Password").fill("demo-pass");
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Use sample data" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Sign up to save your own" })).toHaveCount(0);
});

test("only Google is offered for social sign-in, and only when it is configured", async ({ page }) => {
  await page.goto("/log-in");
  await expect(page.getByRole("button", { name: /Google/ })).toHaveCount(0);
  await expect(page.getByRole("button", { name: /Facebook|Apple/ })).toHaveCount(0);
});

// ---------- profile picture ----------

const PNG_1X1 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("the profile picture dialog: initials first, then upload, save and remove", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Change picture" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Change your profile picture" })).toBeVisible();
  await expect(dialog.getByText("DU", { exact: true })).toBeVisible(); // Demo User, no picture yet
  await expect(dialog.getByRole("button", { name: "Save" })).toBeDisabled();
  await expect(dialog.getByRole("button", { name: "Remove picture" })).toBeDisabled();
  await dialog.getByLabel("Upload picture file").setInputFiles({ name: "me.png", mimeType: "image/png", buffer: PNG_1X1 });
  await expect(dialog.getByRole("button", { name: "Save" })).toBeEnabled();
  await dialog.getByRole("button", { name: "Save" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("img", { name: /profile picture/ }).locator("img").first()).toBeVisible();
  await page.getByRole("button", { name: "Change picture" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Remove picture" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Save" }).click();
  await page.reload();
  await expect(page.getByRole("img", { name: /profile picture/ }).getByText("DU", { exact: true }).first()).toBeVisible();
});

test("log in recognises the saved email and greets the person with their picture or initials", async ({ page }) => {
  await page.goto("/log-in");
  await page.getByLabel("Email").fill("demo@overbill.example");
  await expect(page.getByRole("heading", { name: "Welcome back, Demo" })).toBeVisible();
  await expect(page.getByRole("img", { name: /profile picture/ }).getByText("DU", { exact: true })).toBeVisible();
});

test("a file that is not an image is refused in the picture dialog", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Change picture" }).click();
  await page.getByRole("dialog").getByLabel("Upload picture file").setInputFiles({ name: "x.txt", mimeType: "text/plain", buffer: Buffer.from("hello") });
  await expect(page.getByText("Choose a PNG, JPG or WebP image.")).toBeVisible();
});

test("the profile picture sits at the top right and opens a menu", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Your profile menu" }).click();
  const menu = page.getByRole("menu", { name: "Your profile" });
  await expect(menu.getByText("Demo User")).toBeVisible();
  await menu.getByRole("menuitem", { name: "Change profile picture" }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Change your profile picture" })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Your profile menu" }).click();
  await page.getByRole("menuitem", { name: "Settings" }).click();
  await expect(page).toHaveURL(/\/settings/, { timeout: 20_000 });
});

test("quick search in the top bar opens the matching invoices", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/dashboard");
  await page.getByLabel("Quick search").fill("Stackly");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/invoices\?q=Stackly/, { timeout: 20_000 });
});

test("a signed-in person can load sample data from the profile menu, with a warning if they have their own invoices", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  // sign up and start empty
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Sam Tester");
  await page.getByLabel("Email").fill("sam@example.com");
  await page.getByLabel("Password").fill("x");
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Start empty" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Try sample data" })).toBeVisible();
  await page.getByRole("button", { name: "Your profile menu" }).click();
  await page.getByRole("menuitem", { name: "Load sample data" }).click();
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await expect(page.getByTestId("plain-summary")).toContainText("5 invoices need a look");
});

test("signing up asks about sample data instead of showing it; starting empty keeps the profile", async ({ page }) => {
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Sam Tester");
  await page.getByLabel("Email").fill("sam@example.com");
  await page.getByLabel("Password").fill("x");
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await expect(page.getByRole("dialog").getByRole("heading", { name: "Start with sample data?" })).toBeVisible();
  await expect(page).toHaveURL(/\/sign-up/); // nothing happens until they choose
  await page.getByRole("dialog").getByRole("button", { name: "Start empty" }).click();
  await expect(page).toHaveURL(/\/dashboard/, { timeout: 20_000 });
  await expect(page.getByRole("link", { name: "Try sample data" })).toBeVisible();
  await page.goto("/settings");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Sam Tester");
});

test("sample data can be removed from the banner, and loaded again from the profile menu", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Remove sample data" }).click();
  await expect(page.getByTestId("demo-banner")).toHaveCount(0);
  await expect(page.getByRole("link", { name: "Try sample data" })).toBeVisible();
  await page.goto("/recovery"); // the sample recovery cases go too
  await expect(page.getByText("Nothing to recover yet")).toBeVisible();
  await expect(page.getByText("Duplicate November invoice OW-2211")).toHaveCount(0);
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Your profile menu" }).click();
  await page.getByRole("menuitem", { name: "Load sample data" }).click();
  await expect(page.getByTestId("demo-banner")).toBeVisible();
  await page.getByRole("button", { name: "Your profile menu" }).click();
  await expect(page.getByRole("menuitem", { name: "Remove sample data" })).toBeVisible();
});

test("the Get started checklist appears after the first sign up, not before, and can be hidden", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Get started" })).toHaveCount(0);
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Sam Tester");
  await page.getByLabel("Email").fill("sam@example.com");
  await page.getByLabel("Password").fill("x");
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Use sample data" }).click();
  const gs = page.getByRole("region", { name: "Get started" });
  await expect(gs).toBeVisible({ timeout: 20_000 });
  await expect(gs).toContainText("0 of 3");
  await expect(gs.getByRole("link", { name: "Check one of your own invoices" })).toBeVisible();
  await gs.getByRole("button", { name: "Hide get started" }).click();
  await expect(gs).toHaveCount(0);
  await page.reload();
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  await expect(page.getByRole("region", { name: "Get started" })).toHaveCount(0);
});

test("the Get started checklist fits a phone", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/sign-up");
  await page.getByLabel("Name").fill("Sam Tester");
  await page.getByLabel("Email").fill("sam@example.com");
  await page.getByLabel("Password").fill("x");
  await page.getByRole("button", { name: "Sign up", exact: true }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Use sample data" }).click();
  await expect(page.getByRole("region", { name: "Get started" })).toBeVisible({ timeout: 20_000 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test("/demo asks before replacing data the person created", async ({ page }) => {
  await page.goto("/invoices/new");
  await page.getByRole("tab", { name: "Paste text" }).click();
  await page.getByRole("button", { name: "Insert a sample invoice" }).click();
  await page.getByRole("button", { name: "Check pasted invoice" }).click();
  await expect(page.getByRole("link", { name: /See what we found|Open invoice/ })).toBeVisible({ timeout: 15_000 });
  await page.goto("/demo");
  await expect(page.getByRole("heading", { name: "Replace your data with sample data?" })).toBeVisible({ timeout: 20_000 });
  await expect(page).toHaveURL(/\/demo/); // nothing was replaced by just opening the link
  await page.getByRole("link", { name: "Keep my data" }).click();
  await page.goto("/invoices");
  await expect(page.getByText("35", { exact: true }).first()).toBeVisible();
});

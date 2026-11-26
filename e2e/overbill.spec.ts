import { expect, test, type Page } from "@playwright/test";

const pdf = (name: string) => ({ name, mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4 demo") });

async function uploadAndCheck(page: Page, file: { name: string; mimeType: string; buffer: Buffer }) {
  await page.goto("/invoices/new");
  await page.getByLabel("Choose invoice files").setInputFiles(file);
  await expect(page.locator("[data-state]").filter({ hasText: file.name })).toBeVisible();
  await page.getByRole("button", { name: /Check 1 invoice/ }).click();
  const link = page.getByRole("link", { name: "View analysis" });
  await expect(link).toBeVisible({ timeout: 15_000 });
  await link.click();
}

test("1. dashboard loads with actionable figures", async ({ page }) => {
  await page.goto("/dashboard");
  await expect(page.getByRole("heading", { name: "Dashboard", level: 1 })).toBeVisible();
  const kpis = page.getByRole("region", { name: "Key figures" });
  await expect(kpis).toContainText("Potential overcharges");
  await expect(kpis).toContainText("€478.56");
  await expect(kpis).toContainText("Bills needing review");
  await expect(kpis.getByText("Money recovered")).toBeVisible();
  await expect(kpis).toContainText("€192.40");
  await expect(kpis).toContainText("34");
  await expect(page.getByText("Demo data.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Recent discrepancies" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Vendor price changes" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Monthly spending" })).toBeVisible();
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
  await expect(page.getByRole("link", { name: "View analysis" })).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText("Original file discarded")).toBeVisible();
});

test("4–8. uploaded scenarios are analysed: clear, arithmetic, duplicate, price increase, new fee", async ({ page }) => {
  await uploadAndCheck(page, pdf("brightline-clear.pdf"));
  await expect(page.getByRole("heading", { name: /Northwind Hosting/, level: 1 })).toBeVisible();
  await expect(page.getByText("No findings")).toBeVisible();

  await uploadAndCheck(page, pdf("math-error.pdf"));
  await expect(page.getByText("Total doesn't equal subtotal − discounts + tax + fees")).toBeVisible();
  await expect(page.getByText("Likely error").first()).toBeVisible();

  await uploadAndCheck(page, pdf("duplicate-resend.pdf"));
  await expect(page.getByText("Exact duplicate of an invoice you already have")).toBeVisible();

  await uploadAndCheck(page, pdf("price-increase.pdf"));
  await expect(page.getByText(/higher than your usual with Brightline/)).toBeVisible();

  await uploadAndCheck(page, pdf("new-fee.pdf"));
  await expect(page.getByText(/New fee that wasn't on earlier invoices: "Cleaning surcharge"/)).toBeVisible();
});

test("5. seeded arithmetic discrepancy is detected", async ({ page }) => {
  await page.goto("/invoices/inv-stackly-4");
  await expect(page.getByText(/Line total doesn't match quantity × price/)).toBeVisible();
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
  await expect(page.getByText("Anomaly detected")).toBeVisible();
  await expect(page.getByText("Confirmed error", { exact: true })).toHaveCount(0);
  await expect(page.getByText("High confidence")).toBeVisible();
  await expect(page.getByText("Review needed").first()).toBeVisible();
});

test("8. clear invoice and legitimate variable-cost invoice show no findings", async ({ page }) => {
  await page.goto("/invoices/inv-brightline-4");
  await expect(page.getByText("No findings")).toBeVisible();
  await expect(page.getByText("Everything looks consistent").first()).toBeVisible();
  await page.goto("/invoices/inv-lumen-7");
  await expect(page.getByText("No findings")).toBeVisible();
  await expect(page.getByText("Change vs rolling 6-month average")).toBeVisible();
});

test("9. finding detail opens and shows evidence, confidence and uncertainty", async ({ page }) => {
  await page.goto("/invoices/inv-meridian-4");
  const toggle = page.getByRole("button", { name: "View details" });
  await toggle.click();
  await expect(page.getByRole("button", { name: "Hide details" })).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Evidence", { exact: true })).toBeVisible();
  await expect(page.getByText(/Agreed rate \(entered by you\)/)).toBeVisible();
  await expect(page.getByText("What we can't know")).toBeVisible();
  await expect(page.getByText("Recommended action", { exact: true })).toBeVisible();
  // user, not the engine, promotes an anomaly to a confirmed error
  await page.getByRole("button", { name: "Mark as confirmed error" }).click();
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
  const card = page.getByRole("listitem").filter({ hasText: "Duplicate November invoice OW-2211" });
  await card.getByLabel("Status").selectOption("recovered");
  await expect(page.getByRole("region", { name: "Recovery figures" })).toContainText("€531.20");
  await expect(page.getByRole("button", { name: /Recovered \(3\)/ })).toBeVisible();
  await card.getByLabel("Notes").fill("Vendor refunded on 26 Nov.");
  await card.getByLabel("Notes").blur();
  await expect(card.getByText("Notes saved")).toBeVisible();
  await page.reload();
  await expect(page.getByRole("listitem").filter({ hasText: "Duplicate November invoice OW-2211" }).getByLabel("Status")).toHaveValue("recovered");
  // the finding resolves, so the invoice no longer needs review
  await page.goto("/invoices/inv-orbit-resend");
  await expect(page.getByText("All findings are resolved or dismissed.")).toBeVisible();
});

test("12. vendor search, filter, sort and detail", async ({ page }) => {
  await page.goto("/vendors");
  await expect(page.locator("tbody tr")).toHaveCount(6);
  await page.getByLabel("Search vendors").fill("orb");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await expect(page.locator("tbody")).toContainText("Orbit Workspace");
  await page.getByLabel("Search vendors").fill("");
  await page.getByLabel("Filter by category").selectOption("Telecom");
  await expect(page.locator("tbody tr")).toHaveCount(1);
  await page.getByLabel("Filter by category").selectOption("all");
  await page.getByLabel("Filter by status").selectOption("Needs review");
  await expect(page.locator("tbody")).toContainText("Northwind");
  await expect(page.locator("tbody")).not.toContainText("Lumen");
  await page.getByLabel("Filter by status").selectOption("all");
  await page.getByLabel("Sort vendors").selectOption("change");
  await expect(page.locator("tbody tr").first()).toContainText("Northwind Hosting");
  await page.getByLabel("Search vendors").fill("zzz");
  await expect(page.getByText("No vendors match")).toBeVisible();
  await page.getByLabel("Search vendors").fill("northwind");
  await page.getByRole("link", { name: "Northwind Hosting" }).click();
  await expect(page.getByRole("heading", { name: "Northwind Hosting", level: 1 })).toBeVisible();
  await expect(page.getByRole("img", { name: /invoice totals/ })).toBeVisible();
  await expect(page.getByText(/Looks like a monthly charge/)).toBeVisible();
  // user-defined expected amount drives a new finding
  await page.getByLabel(/Expected invoice total/).fill("145.20");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(page.getByText("Expected amount saved.")).toBeVisible();
  await page.goto("/invoices/inv-northwind-7");
  await expect(page.getByText("Total differs from the amount you expect from this vendor")).toBeVisible();
});

test("13. settings can be changed and persist", async ({ page }) => {
  await page.goto("/settings");
  await page.getByLabel("Preferred currency").selectOption("USD");
  await page.getByText("Strict", { exact: true }).click();
  await page.getByRole("switch", { name: "Weekly digest" }).click();
  await page.getByLabel("Name", { exact: true }).fill("Sam Tester");
  await page.getByRole("button", { name: "Save profile" }).click();
  await expect(page.getByText("Profile saved.")).toBeVisible();
  await page.reload();
  await expect(page.getByLabel("Preferred currency")).toHaveValue("USD");
  await expect(page.getByRole("radio", { name: /Strict/ })).toBeChecked();
  await expect(page.getByRole("switch", { name: "Weekly digest" })).toHaveAttribute("aria-checked", "false");
  await expect(page.getByLabel("Name", { exact: true })).toHaveValue("Sam Tester");
  // currency preference only totals matching invoices; nothing is converted
  await page.goto("/dashboard");
  await expect(page.getByRole("region", { name: "Key figures" })).toContainText("$0.00");
});

test("13b. sensitivity changes how seriously a price increase is rated", async ({ page }) => {
  await page.goto("/invoices/inv-northwind-7");
  await expect(page.getByText("Medium severity")).toBeVisible();
  await page.goto("/settings");
  await page.getByText("Strict", { exact: true }).click();
  await page.goto("/invoices/inv-northwind-7");
  await expect(page.getByText("High severity")).toBeVisible();
});

test("14. demo data can be cleared and reset", async ({ page }) => {
  await page.goto("/invoices/inv-stackly-4");
  await page.getByRole("button", { name: "Delete invoice" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete invoice" }).click();
  await expect(page).toHaveURL(/\/invoices$/);
  await expect(page.getByText("Stackly Software").first()).toBeHidden();

  await page.goto("/settings");
  await page.getByRole("button", { name: "Delete all data" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Delete everything" }).click();
  await expect(page.getByText("All data deleted.")).toBeVisible();
  await page.goto("/dashboard");
  await expect(page.getByText("Your invoice history starts here")).toBeVisible();

  await page.goto("/settings");
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
  await expect(page.getByRole("link", { name: "View analysis" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("link", { name: "View analysis" }).click();
  await expect(page.getByRole("heading", { name: /Brightline Telecom · BT-88105/ })).toBeVisible();
  await expect(page.getByText("No findings")).toBeVisible();

  await page.goto("/invoices/new");
  const csv = "description,quantity,unit_price\nConsulting,10,90.00\n";
  await page.getByLabel("Choose invoice files").setInputFiles({ name: "acme.csv", mimeType: "text/csv", buffer: Buffer.from(csv) });
  await page.getByRole("button", { name: /Check 1 invoice/ }).click();
  await expect(page.getByText("Some invoice details couldn't be extracted confidently.")).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("Please confirm").first()).toBeVisible();
  await page.getByLabel("Vendor", { exact: true }).fill("Meridian Accounting");
  await page.getByLabel("Invoice number").fill("MA-400");
  await page.getByLabel("Invoice date").fill("2026-11-24");
  await page.getByLabel("Due date").fill("2026-12-15");
  await page.getByRole("button", { name: "Confirm and run audit" }).click();
  await page.getByRole("link", { name: "View analysis" }).click({ timeout: 15_000 });
  // typed "Consulting" doesn't match the "bookkeeping" contract rate, so only the history/arith rules apply
  await expect(page.getByRole("heading", { name: /Meridian Accounting · MA-400/ })).toBeVisible();
});

test("mobile layout: menu opens and navigates", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto("/dashboard");
  await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Vendors" }).click();
  await expect(page.getByRole("heading", { name: "Vendors", level: 1 })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

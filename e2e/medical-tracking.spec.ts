import { expect, test as base } from "@playwright/test";

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

test.use({ viewport: { width: 390, height: 844 } }); // a phone

test("medical bill: checks gate the pay run, the insurer figure is compared, dates need a source, drafts are copy-only", async ({ page }) => {
  await page.goto("/demo");
  await expect(page).toHaveURL(/\/dashboard/);
  await page.goto("/invoices/inv-lumen-7");
  await page.getByRole("button", { name: "Mark it as medical" }).click();
  const tracker = page.getByTestId("medical-tracker");
  await expect(tracker).toBeVisible();
  await expect(tracker).toContainText("Ask for an itemised bill");

  // Held in the pay run until both checks are ticked.
  await page.goto("/pay-run");
  await expect(page.getByText(/Medical bill, waiting on you: itemised bill not received yet and insurer statement not matched yet/)).toBeVisible();

  await page.goto("/invoices/inv-lumen-7");
  await page.getByLabel("I received an itemised bill").check();
  await page.getByLabel(/I matched my insurer's statement/).check();
  await expect(tracker).toContainText("ticked by you on");
  await page.goto("/pay-run");
  await expect(page.getByText(/Medical bill, waiting on you/)).toHaveCount(0);

  // Insurer figure: a comparison of two numbers, flagged as not confirmed.
  await page.goto("/invoices/inv-lumen-7");
  await page.getByLabel(/Patient responsibility/).fill("100.00");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(tracker).toContainText(/higher than your statement/);
  await expect(tracker).toContainText("Not confirmed");

  // A date must say where it came from.
  await page.getByLabel("Date", { exact: true }).fill("2030-01-15");
  await page.getByLabel("What it is for").fill("Appeal window ends");
  await page.getByRole("button", { name: "Add date" }).click();
  await expect(tracker.getByRole("alert")).toContainText("where this date came from");
  await page.getByLabel("Where this date came from").fill("collection letter dated 3 Nov");
  await page.getByRole("button", { name: "Add date" }).click();
  await expect(tracker).toContainText("Source you gave: collection letter dated 3 Nov");

  // The hold request is a draft: no patient details, honest about what it cannot do, never sent.
  await page.getByRole("button", { name: "Request a hold (not a legal stay)" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toContainText("not a legal stay");
  await expect(dialog.getByRole("textbox")).toHaveValue(/\[account number\]/);
  await dialog.getByRole("button", { name: "Copy" }).click();
  await expect(dialog).toContainText("Nothing was sent");
  await dialog.getByRole("button", { name: "Close", exact: true }).first().click();

  // No AI second opinion for health data.
  await page.getByRole("button", { name: /Invoice details & history/ }).click();
  await expect(page.getByText(/AI second opinion is switched off for medical bills/)).toBeVisible();

  // No horizontal overflow on a phone.
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await tracker.screenshot({ path: "test-results/medical-tracker-phone.png" });
});

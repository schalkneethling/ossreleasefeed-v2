import AxeBuilder from "@axe-core/playwright";
import { expect, type Page } from "@playwright/test";

export async function expectNoSeriousViolations(page: Page): Promise<void> {
  await page.evaluate(() =>
    Promise.all(
      document.getAnimations().map((animation) => animation.finished.catch(() => undefined)),
    ),
  );
  const results = await new AxeBuilder({ page }).analyze();
  const severe = results.violations.filter(
    (v) => v.impact === "critical" || v.impact === "serious",
  );
  const summary = severe.map((v) => `${v.id} (${v.impact})`).join(", ");
  expect(severe.length, `Axe violations found: ${summary}`).toBe(0);
}

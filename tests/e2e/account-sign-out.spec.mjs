import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";

test("signing out emits one account invalidation event", async ({ page }) => {
  const email = `sign-out-${randomUUID()}@example.test`;
  const registration = await page.request.post("/api/auth/register/", {
    data: { email, password: "synthetic sign-out test password" },
  });
  expect(registration.status()).toBe(201);
  await page.goto("/en/planner/");
  const account = page.locator(".accountButton");
  await expect(account).toHaveText(email);

  await page.evaluate(() => {
    window.addEventListener("loud-weekend-signed-out", () => {
      const count = Number(sessionStorage.getItem("signed-out-events") ?? 0);
      sessionStorage.setItem("signed-out-events", String(count + 1));
    });
  });
  await account.click();
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await expect(account).toHaveText("Account");
  expect(await page.evaluate(() => sessionStorage.getItem("signed-out-events"))).toBe("1");
  expect((await page.request.get("/api/auth/me/")).status()).toBe(401);
});

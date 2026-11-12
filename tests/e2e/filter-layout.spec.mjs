import { expect, test } from '@playwright/test';

for (const locale of ['en', 'de', 'ru']) {
  test(`primary controls stay on one desktop row with switches below (${locale})`, async ({ page }) => {
    for (const width of [1101, 1440, 1920, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      await page.goto(`/${locale}/`);
      const bar = page.locator('.filterBar');
      await expect(bar.locator('.search')).toHaveAttribute('data-ready', 'true');
      const layout = await bar.evaluate(node => {
        const rect = selector => node.querySelector(selector).getBoundingClientRect().toJSON();
        return { search: rect('.search'), clear: rect('.clearFilters'),
          selects: [...node.querySelectorAll('select')].map(el => el.getBoundingClientRect().toJSON()),
          toggles: [...node.querySelectorAll('.toggle')].map(el => el.getBoundingClientRect().toJSON()),
          overflow: document.documentElement.scrollWidth > innerWidth };
      });
      expect(layout.overflow).toBe(false);
      if (width > 1100) {
        for (const control of [...layout.selects, layout.clear]) expect(Math.abs(control.top - layout.search.top)).toBeLessThan(2);
        expect(layout.clear.left).toBeGreaterThan(layout.selects.at(-1).right);
      }
      for (const toggle of layout.toggles) expect(toggle.top).toBeGreaterThanOrEqual(Math.max(layout.clear.bottom, ...layout.selects.map(s => s.bottom)));
    }
    const search = page.locator('.filterBar .search input');
    await search.fill('no-such-festival');
    await page.locator('.filterBar .toggle').first().click();
    await page.locator('.clearFilters').click();
    await expect(search).toHaveValue('');
    await expect(search).toBeFocused();
    await expect(page.locator('.filterBar .toggle input').first()).not.toBeChecked();
  });
}

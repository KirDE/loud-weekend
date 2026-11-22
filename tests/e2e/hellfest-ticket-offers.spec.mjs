import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';
import { createPrismaClient } from '../../lib/prisma-client.mjs';
import { requireLocalDisposableDatabase } from '../support/disposable-db.ts';
import { stageHellfestOffers } from '../../lib/ingestion/ticket-offer-proposal-store.ts';

requireLocalDisposableDatabase(process.env.DATABASE_URL);
const db = createPrismaClient();
let festivalId;
let editionId;
let userId;
const email = 'browser-tier-admin@example.test';
const html = readFileSync(new URL('../fixtures/hellfest/offer-cards.html', import.meta.url), 'utf8');
const labels = {
  en: ['Load latest proposal', 'Approve both categories', 'Approved', 'Sold out', 'Not on sale yet', 'Fees: unknown'],
  de: ['Aktuellen Vorschlag laden', 'Beide Kategorien freigeben', 'Freigegeben', 'Ausverkauft', 'Noch nicht im Verkauf', 'Gebühren: unbekannt'],
  ru: ['Загрузить свежий снимок', 'Одобрить обе категории', 'Одобрено', 'Распродано', 'Продажи ещё не открыты', 'Комиссии неизвестны'],
};
test.beforeAll(async () => {
  // Never overwrite another suite's Hellfest or account fixtures.
  expect(await db.festival.count({ where: { slug: 'hellfest' } })).toBe(0);
  expect(await db.user.count({ where: { email } })).toBe(0);
  const festival = await db.festival.create({ data: { slug: 'hellfest', name: 'Synthetic Hellfest', country: 'France', countryCode: 'FR', officialUrl: 'https://hellfest.fr/', genres: [] } });
  festivalId = festival.id;
  const edition = await db.festivalEdition.create({ data: { festivalId, year: 2027, status: 'CONFIRMED', ticketStatus: 'UNKNOWN', recordState: 'CURRENT', completeness: 'COMPLETE', sourceUpdatedAt: new Date() } });
  editionId = edition.id;
  await stageHellfestOffers(db, { editionId, html, finalUrl: 'https://hellfest.fr/', status: 200, observedAt: new Date().toISOString() });
});
test.afterAll(async () => {
  if (festivalId) await db.festival.delete({ where: { id: festivalId } });
  if (userId) await db.user.delete({ where: { id: userId } });
  await db.$disconnect();
});

async function noOverflow(page) {
  const sizes = await page.evaluate(() => ({ viewport: innerWidth, document: document.documentElement.scrollWidth, body: document.body.scrollWidth }));
  expect(sizes.document, JSON.stringify(sizes)).toBeLessThanOrEqual(sizes.viewport);
  expect(sizes.body, JSON.stringify(sizes)).toBeLessThanOrEqual(sizes.viewport);
}

test('real session review publishes independent tiers; EN/DE/RU desktop and mobile', async ({ page }, testInfo) => {
  test.setTimeout(180_000);
  await page.goto('/en/festivals/hellfest/');
  await expect(page.getByRole('heading', { level: 1, name: 'Synthetic Hellfest' })).toBeVisible();
  await expect(page.locator('.ticketOfferSection')).toHaveCount(0);
  expect((await page.request.get(`/api/admin/ticket-offers/editions/${editionId}`)).status()).toBe(403);
  expect((await page.request.post('/api/auth/register', { data: { email, password: 'synthetic browser password 2027' } })).status()).toBe(201);
  const user = await db.user.update({ where: { email }, data: { role: 'ADMIN' } });
  userId = user.id;
  await page.goto('/admin');
  const queue = page.locator('.ticketOfferReview');
  await expect(queue).toBeVisible();
  for (const locale of ['en', 'de', 'ru']) {
    await page.locator('.adminLanguage select').selectOption(locale);
    await queue.getByRole('button', { name: labels[locale][0], exact: true }).click();
    await expect(queue.locator('[data-tier-kind=full_pass]')).toContainText(labels[locale][3]);
    await expect(queue.locator('[data-tier-kind=day_pass]')).toContainText(labels[locale][4]);
    await queue.locator('summary').click();
    await expect(queue.locator('code')).toHaveText(/^[a-f0-9]{64}$/);
    for (const width of [1280, 320, 375, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await noOverflow(page);
    }
    await queue.screenshot({ path: testInfo.outputPath(`review-${locale}-390.png`) });
    await queue.locator('summary').click();
  }
  await queue.getByRole('button', { name: labels.ru[1], exact: true }).click();
  await expect(queue.getByText(labels.ru[2], { exact: true })).toBeVisible();
  await page.reload();
  await queue.getByRole('button', { name: labels.ru[0], exact: true }).click();
  await expect(queue.getByText(labels.ru[2], { exact: true })).toBeVisible();
  expect(await db.ticketOfferReviewDecision.count({ where: { snapshot: { editionId } } })).toBe(1);
  expect((await db.festivalEdition.findUniqueOrThrow({ where: { id: editionId } })).ticketStatus).toBe('UNKNOWN');
  for (const locale of ['en', 'de', 'ru']) {
    await page.goto(`/${locale}/festivals/hellfest/`);
    const offers = page.locator('.ticketOfferSection');
    await expect(offers.locator('[data-tier-kind=full_pass]')).toContainText(labels[locale][3]);
    await expect(offers.locator('[data-tier-kind=day_pass]')).toContainText(labels[locale][4]);
    await expect(offers).toContainText(labels[locale][5]);
    await expect(offers.locator('a')).toHaveAttribute('href', 'https://hellfest.fr/');
    await expect(offers.locator('button')).toHaveCount(0);
    for (const width of [1280, 320, 375, 390]) {
      await page.setViewportSize({ width, height: 900 });
      await noOverflow(page);
    }
    await offers.screenshot({ path: testInfo.outputPath(`public-${locale}-390.png`) });
  }
});

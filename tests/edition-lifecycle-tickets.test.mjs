import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { ticketPresentation, hasAvailableTickets } from '../lib/tickets.ts';
import { editionOnHiatus } from '../lib/edition-lifecycle.ts';
import { festivalMusicEvent } from '../lib/seo.ts';
import { FestivalDetail } from '../components/FestivalDetail.tsx';
import { FestivalComparisonTicket } from '../components/FestivalComparisonTicket.tsx';
import { LanguageProvider, translate } from '../components/LanguageProvider.tsx';
import { LocalPlannerProvider } from '../components/LocalPlanner.tsx';
import { festival } from './support/catalog.ts';

const notice = {festivalSlug:'rock-en-seine', editionYear:2027, lifecycle:'hiatus', announcedReturnYear:2028,
  alternativeEvent:'under_consideration', sourceUrl:'https://www.rockenseine.com/',
  observedAt:'2026-11-22T18:56:40.000Z', approvedAt:'2026-11-22T19:00:00.000Z' };
const target = { ...festival, slug:'rock-en-seine', editionYear:2027,
  officialUrl:notice.sourceUrl, ticketsUrl:'https://tickets.example.test/old',
  startDate:'2027-08-25', endDate:'2027-08-29', editionLifecycle:notice };
const statuses = ['available','low','not_on_sale','sold_out','sales_ended','unavailable','unknown'];
const render = (language, component) => renderToStaticMarkup(h(LanguageProvider,
  { initialLanguage:language }, h(LocalPlannerProvider,null,component)));

for (const ticketStatus of statuses) test(`approved hiatus overrides ${ticketStatus} without rewriting raw facts`, () => {
  for (const ticketsUrl of [target.ticketsUrl, undefined]) {
    const item = { ...target,ticketStatus,ticketsUrl };
    const before = structuredClone(item);
    assert.equal(editionOnHiatus(item),true);
    assert.deepEqual(ticketPresentation(item),{status:'hiatus',label:'editionHiatus'});
    assert.equal(hasAvailableTickets(item),false);
    // Neither scheduled dates, a cancelled event, nor 2028 replacement are invented.
    assert.equal(festivalMusicEvent(item),null);
    for (const language of ['en','de','ru']) {
      for (const component of [h(FestivalDetail,{item,festivals:[item],artistSlugs:{}}),h(FestivalComparisonTicket,{item})]) {
        const html = render(language,component);
        assert.ok(html.includes(translate(language,'editionHiatus')));
        assert.ok(html.includes('data-ticket-status="hiatus"'));
        assert.ok(!html.includes(target.ticketsUrl));
        assert.ok(!html.includes(translate(language,'officialTickets')));
      }
    }
    assert.deepEqual(item,before);
  }
});

test('absence is unknown lifecycle, retaining independent ticket semantics', () => {
  for (const ticketStatus of statuses) {
    const item = { ...target, editionLifecycle:undefined,ticketStatus };
    assert.equal(editionOnHiatus(item),false);
    assert.equal(ticketPresentation(item).status,ticketStatus);
    assert.equal(hasAvailableTickets(item),['available','low'].includes(ticketStatus));
    assert.ok(festivalMusicEvent(item));
  }
});

test('foreign, unreviewed and malformed lifecycle notices fail closed', () => {
  const invalid = [
    {...target,slug:'other'}, {...target,editionYear:2028}, {...target,editionYear:undefined},
    {...target,officialUrl:'https://other.example.test/'},
    ...[null,{}, {...notice,reviewState:'pending'}, {...notice,lifecycle:'active'},
      {...notice,sourceUrl:'https://other.example.test/'}, {...notice,editionYear:2028},
      {...notice,announcedReturnYear:2026}, {...notice,observedAt:'yesterday'}]
      .map(editionLifecycle=>({...target,editionLifecycle})),
  ];
  for (const item of invalid) for (const read of [ticketPresentation,hasAvailableTickets,festivalMusicEvent])
    assert.throws(()=>read(item));
});

test('actual comparison cell retains truthful localized statuses for non-hiatus editions', () => {
  for (const ticketStatus of statuses) for (const language of ['en','de','ru']) {
    const item = {...target,editionLifecycle:undefined,ticketStatus};
    const html = render(language,h(FestivalComparisonTicket,{item}));
    const ticket = ticketPresentation(item);
    assert.ok(html.includes(translate(language,ticket.label).replaceAll('&','&amp;')));
    if (ticketStatus !== 'available') assert.ok(!html.includes(translate(language,'officialTickets')));
  }
});

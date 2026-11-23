import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { load } from 'cheerio';
import { observeRockEnSeineHiatus as observe, ROCK_EN_SEINE_HOME as url } from '../lib/ingestion/adapters/rock-en-seine-hiatus.ts';
const html=readFileSync(new URL('./fixtures/rock-en-seine/hiatus.html',import.meta.url),'utf8');
const at='2026-11-22T18:56:40.171Z'; // Historical actual GET, not refreshed evidence.
const parse=(body=html,time=at,t={status:200,finalUrl:url})=>observe(body,time,t);
const mutate=fn=>{const $=load(html);fn($);return $.html();};
test('actual minimized official notice, despite archived2026 title, proposes only2027hiatus',()=>{
 const p=parse();assert.equal(p.lifecycle,'hiatus');assert.equal(p.editionYear,2027);assert.equal(p.announcedReturnYear,2028);
 assert.equal(p.alternativeEvent,'under_consideration');assert.equal(p.sourceUrl,url);assert.equal(p.observedAt,at);
 assert.deepEqual(Object.keys(p).sort(),['festivalSlug','editionYear','lifecycle','announcedReturnYear','alternativeEvent','sourceUrl','observedAt','excerpt'].sort());
 assert.doesNotMatch(JSON.stringify(p),/sold_out|not_on_sale|available|startDate|endDate|ticketsUrl/);
});
for(const [label,fn]of[
 ['missing notice',$=>$('#artistes').remove()],['duplicate notice',$=>$('body').append($('#artistes').clone())],
 ['wrong container',$=>$('.cn-block-group').removeClass('t-balance')],['duplicate group',$=>$('#artistes').append($('.cn-block-group').clone())],
 ['wrong return year',$=>$('h2').text('Le festival revient en 2027')],['duplicate heading',$=>$('h2').after($('h2').clone())],
 ['wrong pause year',$=>$('p').first().text($('p').first().text().replace('2027','2026'))],
 ['missing pause',$=>$('p').first().remove()],['duplicate pause',$=>$('p').first().after($('p').first().clone())],
 ['missing alternate caveat',$=>$('p').last().remove()],['alternate confirmed',$=>$('p').last().text('Un rendez-vous différent confirmé en 2027')],
 ['contradictory sale',$=>$('.cn-block-group').append('<p>Billets en vente 2027</p>')],
 ['hidden section',$=>$('#artistes').attr('hidden','')],['inert notice',$=>$('#artistes').attr('inert','')],
 ['aria hidden',$=>$('.cn-block-group').attr('aria-hidden','true')],['hidden text',$=>$('p').first().attr('style','display:none !important')],
 ['hidden class',$=>$('h2').addClass('hidden')],['hidden ancestor',$=>$('body').attr('style','visibility: hidden')],
 ['script only',$=>{const g=$('.cn-block-group');g.replaceWith($('<script type="text/plain">').text(g.toString()));}],
 ['no title',$=>$('title').remove()],['foreign title',$=>$('title').text('Other festival')],
])test(label+' fails closed',()=>assert.throws(()=>parse(mutate(fn)),/not verified/));
for(const status of[204,206,301,302,403,429,500])test('HTTP'+status+' cannot confirm hiatus',()=>assert.throws(()=>parse(html,at,{status,finalUrl:url})));
test('source identity/time/size mandatory',()=>{
 for(const finalUrl of[url+'?x=1',url+'2027/','https://example.org/'])assert.throws(()=>parse(html,at,{status:200,finalUrl}));
 for(const time of['invalid','2026-02-30T00:00:00Z','2026-11-22'])assert.throws(()=>parse(html,time));
 assert.throws(()=>parse(''));assert.throws(()=>parse('x'.repeat(2_000_001)));
});
test('unrelated arbitrary page text never persisted',()=>{
 const p=parse(mutate($=>$('.cn-block-group').append('<p>unrelated arbitrary content</p>')));
 assert.doesNotMatch(JSON.stringify(p),/unrelated arbitrary/);
});

test('the same source format can prove a different paused edition', () => {
 const future = html.replaceAll('2028', '2030').replaceAll('2027', '2029');
 const proposal = parse(future);
 assert.equal(proposal.editionYear, 2029);
 assert.equal(proposal.announcedReturnYear, 2030);
 assert.match(proposal.excerpt, /pauses in 2029 and announces a return in 2030/);
 assert.throws(() => parse(future.replace('proposer en 2029', 'proposer en 2027')), /not verified/);
});

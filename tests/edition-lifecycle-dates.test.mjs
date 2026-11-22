import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { transform } from 'esbuild';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { availableFestivalMonths, festivalDateInterval, festivalOverlapsMonth, formatFestivalDateRange } from '../lib/festival-dates.ts';
import { FestivalDetail } from '../components/FestivalDetail.tsx';
import { FestivalExplorer } from '../components/FestivalExplorer.tsx';
import { EditionLifecycleNotice } from '../components/EditionLifecycleNotice.tsx';
import { LanguageProvider, translate } from '../components/LanguageProvider.tsx';
import { LocalPlannerProvider } from '../components/LocalPlanner.tsx';
import { festival } from './support/catalog.ts';

const notice = {editionYear:2027,lifecycle:'hiatus',announcedReturnYear:2028,
  alternativeEvent:'under_consideration',sourceUrl:'https://www.rockenseine.com/',
  observedAt:'2026-11-22T18:56:40.000Z',approvedAt:'2026-11-22T19:00:00.000Z'};
const paused = {...festival,slug:'rock-en-seine',name:'Rock en Seine',officialUrl:notice.sourceUrl,
  startDate:'2027-08-25',endDate:'2027-09-01',ticketStatus:'available',editionLifecycle:notice};
const active = {...festival,slug:'active',name:'Active Festival',startDate:'2027-06-10',endDate:'2027-06-12'};
const render = (locale,element) => renderToStaticMarkup(h(LanguageProvider,{initialLanguage:locale},
  h(LocalPlannerProvider,null,element)));
const props = item => ({item,festivals:[item],artistSlugs:{'Sample Artist':'sample-artist'}});
const require=createRequire(import.meta.url);
const {code}=await transform(await readFile(new URL('../components/FestivalExplorer.tsx',import.meta.url),'utf8'),
  {loader:'tsx',jsx:'automatic',format:'cjs',target:'es2022'});

// Render the real comparison JSX with an already selected pair, without
// changing the source or pretending this is a browser interaction.
const dependencies={};
for(const [,id] of code.matchAll(/require\("([^"]+)"\)/g)) {
  if(id.startsWith("@/") || id.startsWith("./")) {
    const path=id.startsWith("@/")?"../"+id.slice(2):"../components/"+id.slice(2);
    dependencies[id]=await import(require.resolve(path));
  }
}
function explorerWithState(locale, {announcedOnly=false,month="all",selected=[paused.slug,active.slug]}={}) {
  let stateIndex=0;
  const module={exports:{}};
  new Function('require','module','exports',code)(id=>{
    if(id==='react') return {...require('react'),useState:initial=>{
      stateIndex++;
      const value=stateIndex===3?announcedOnly:stateIndex===4?month:Array.isArray(initial)?selected:initial;
      return require('react').useState(value);
    }};
    if(Object.hasOwn(dependencies,id)) return dependencies[id];
    return require(id);
  },module,module.exports);
  return render(locale,h(module.exports.FestivalExplorer,{festivals:[paused,active]}));
}

test('hiatus never matches a discovery month; canonical interval remains unchanged',()=>{
  const before=structuredClone(paused);
  assert.ok(festivalDateInterval(paused)); // Raw evidence is not erased.
  for(let month=1;month<=12;month++) {
    assert.equal(festivalOverlapsMonth(paused,month),false);
    assert.equal(festivalOverlapsMonth(paused,month,2027),false);
  }
  assert.deepEqual(availableFestivalMonths([paused]),[]);
  assert.deepEqual(availableFestivalMonths([paused,active]),[6]);
  assert.equal(formatFestivalDateRange(paused,'en','TBA','PAUSED'),'PAUSED');
  assert.equal(formatFestivalDateRange(paused,'en','TBA'),'Edition on hiatus');
  assert.deepEqual(paused,before);
});
test('missing lifecycle preserves dates, including month crossover; wrong targets fail closed',()=>{
  const unknown={...paused,editionLifecycle:undefined};
  assert.equal(festivalOverlapsMonth(unknown,8),true);
  assert.equal(festivalOverlapsMonth(unknown,9),true);
  assert.notEqual(formatFestivalDateRange(unknown,'en','TBA'),'TBA');
  for(const item of [{...paused,slug:'other'}, {...paused,editionYear:2028},
    {...paused,officialUrl:undefined}, {...paused,editionLifecycle:{...notice,reviewState:'pending'}},
    {...paused,editionLifecycle:null}]) {
    for(const read of [item=>festivalOverlapsMonth(item,8),item=>availableFestivalMonths([item]),
      item=>formatFestivalDateRange(item,'en','TBA')]) assert.throws(()=>read(item));
  }
});
for(const locale of ['en','de','ru']) {
  test('actual detail and notice suppress old schedule/roster and disclose source time in '+locale,()=>{
    const before=structuredClone(paused);
    const html=render(locale,h(FestivalDetail,props(paused)));
    assert.ok(html.includes(translate(locale,'editionHiatus')));
    assert.ok(html.includes(translate(locale,'editionHiatusExplanation')));
    assert.match(html,/dateTime="2026-11-22T18:56:40.000Z"/);
    assert.match(html,/href="https:\/\/www.rockenseine.com\/"/);
    assert.doesNotMatch(html,/2027-08-25|2027-09-01|lineupSection|confirmedLineup|Sample Artist/);
    assert.match(html,/<select[^>]*disabled=""/);
    assert.doesNotMatch(html,/reviewer|contentHash|approvedAt|audit/);
    assert.equal(render(locale,h(EditionLifecycleNotice,{item:active})),'');
    const normal=render(locale,h(FestivalDetail,props({...paused,editionLifecycle:undefined})));
    assert.match(normal,/lineupSection/);
    assert.ok(normal.includes(translate(locale,'confirmedLineup')));
    assert.deepEqual(paused,before);
  });
  test('actual discovery cards and comparison do not advertise hiatus dates/lineup in '+locale,()=>{
    const html=render(locale,h(FestivalExplorer,{festivals:[paused]}));
    assert.ok(html.includes(translate(locale,'editionHiatus')));
    assert.doesNotMatch(html,/Sample Artist|2027-08-25|2027-09-01|status confirmed/);
    // A hiatus has no selectable month derived from its old dates.
    assert.doesNotMatch(html.match(/<select[^]*?<\/select>/g)[1]||'',/value="08"|value="09"/);
    const compared=explorerWithState(locale);
    const table=compared.match(/<table[^]*?<\/table>/)[0];
    assert.ok(table.includes(translate(locale,'editionHiatus')));
    assert.ok(table.includes(formatFestivalDateRange(active,locale,'')));
    assert.doesNotMatch(table,/2027-08-25|2027-09-01/);
    for(const filter of [{announcedOnly:true},{month:'06'}]) {
      const filtered=explorerWithState(locale,{...filter,selected:[]});
      assert.match(filtered,/Active Festival/);
      assert.doesNotMatch(filtered,/Rock en Seine/);
    }
    const august=explorerWithState(locale,{month:'08',selected:[]});
    assert.doesNotMatch(august,/Rock en Seine|Active Festival/);
  });
}

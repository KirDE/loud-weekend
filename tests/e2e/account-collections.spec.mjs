import {test,expect} from "@playwright/test";
const copy={
 en:{import:"Import playlists",sync:"Sync now",remote:"Use account data on this device",merge:"Merge this device into my account",last:"Last successful import",saved:"Saved imported playlists",conflict:"A newer version exists on another device. Nothing was overwritten.",keep:"Keep this device"},
 de:{import:"Playlists importieren",sync:"Jetzt synchronisieren",remote:"Kontodaten auf diesem Gerät verwenden",merge:"Dieses Gerät mit meinem Konto zusammenführen",last:"Letzter erfolgreicher Import",saved:"Gespeicherte importierte Playlists",conflict:"Auf einem anderen Gerät gibt es eine neuere Version. Nichts wurde überschrieben.",keep:"Dieses Gerät behalten"},
 ru:{import:"Импортировать плейлисты",sync:"Синхронизировать",remote:"Использовать данные аккаунта на устройстве",merge:"Объединить данные устройства с аккаунтом",last:"Последний успешный импорт",saved:"Сохранённые импортированные плейлисты",conflict:"На другом устройстве есть более новая версия. Ничего не перезаписано.",keep:"Оставить данные устройства"}
};
for(const [locale,t] of Object.entries(copy))test(locale+" imported Spotify collections survive ordinary/merge sync, reload, second device and conflict UI",async({page,context})=>{
 const imported={syncedAt:"2026-11-17T22:00:00.000Z",playlists:[{id:"abc",name:"Synthetic retained playlist",url:"https://open.spotify.com/playlist/abc",image:null,owner:"Synthetic provider",trackCount:3}]};
 const docs={collections:{id:"collection",revision:1,updatedAt:imported.syncedAt,payload:{schemaVersion:1,playlistFestivals:["graspop"],spotify:null}}};
 let failImport=false,conflictNext=false;
 await context.route("**/api/auth/me**",route=>route.fulfill({json:{user:{id:"synthetic-user",email:"browser-collections@example.test",emailVerified:true,role:"USER"}}}));
 await context.route("**/api/sync/**",async route=>{
  const req=route.request(),kind=new URL(req.url()).pathname.split("/").filter(Boolean).at(-1);
  if(req.method()==="GET")return route.fulfill({json:{document:docs[kind]??null}});
  const body=req.postDataJSON(),previous=docs[kind];
  if(kind==="collections"&&conflictNext){conflictNext=false;docs[kind]={...previous,revision:previous.revision+1,payload:{...previous.payload,playlistFestivals:["reading"]}};return route.fulfill({status:409,json:{error:"conflict"}});}
  if((previous?.revision??0)!==body.revision)return route.fulfill({status:409,json:{error:"conflict"}});
  const payload=kind==="collections"?{schemaVersion:1,playlistFestivals:body.payload.playlistFestivals,spotify:previous?.payload.spotify??null}:body.payload;
  docs[kind]={id:kind,revision:(previous?.revision??0)+1,updatedAt:imported.syncedAt,payload};
  return route.fulfill({json:{document:docs[kind]}});
 });
 await context.route("**/api/spotify/sync**",async route=>{
  const previous=docs.collections;
  if(failImport)return route.fulfill({status:502,json:{error:"Synthetic upstream failure"}});
  if(route.request().postDataJSON().revision!==previous.revision)return route.fulfill({status:409,json:{error:"conflict"}});
  docs.collections={...previous,revision:previous.revision+1,payload:{...previous.payload,spotify:imported}};
  return route.fulfill({json:{document:docs.collections}});
 });
 await page.addInitScript(()=>localStorage.setItem("festival-radar-planner-v1",JSON.stringify({favoriteFestivals:[],favoriteArtists:[],attendance:{},playlistFestivals:["wacken-open-air"],savedFilters:{query:"",country:"all",announcedOnly:false,month:"all",ticketsOnly:false}})));
 await page.goto("/"+locale+"/planner/");
 const panel=page.locator(".accountSync"),link=panel.getByRole("link",{name:"Synthetic retained playlist"});
 await panel.getByRole("button",{name:t.import,exact:true}).click();
 await expect(link).toBeVisible();await expect(panel.getByRole("heading",{name:t.saved})).toBeVisible();
 await expect(panel.locator("time")).toHaveAttribute("datetime",imported.syncedAt);
 expect(docs.collections.payload.playlistFestivals).toEqual(["graspop","wacken-open-air"]);
 await panel.getByRole("button",{name:t.sync,exact:true}).click();await expect(panel).toHaveAttribute("aria-busy","false");
 expect(docs.collections.payload.spotify).toEqual(imported);
 await panel.getByRole("button",{name:t.merge,exact:true}).click();await expect(panel).toHaveAttribute("aria-busy","false");await expect(link).toBeVisible();
 await page.reload();await expect(link).toBeVisible();await expect(panel.locator("time")).toHaveAttribute("datetime",imported.syncedAt);
 await panel.getByRole("button",{name:t.remote,exact:true}).click();await expect(panel).toHaveAttribute("aria-busy","false");
 await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem("festival-radar-planner-v1")).playlistFestivals)).toEqual(["graspop","wacken-open-air"]);
 const other=await context.newPage();await other.goto("/"+locale+"/planner/");await expect(other.locator(".accountSync").getByRole("link",{name:"Synthetic retained playlist"})).toBeVisible();await other.close();
 conflictNext=true;await panel.getByRole("button",{name:t.sync,exact:true}).click();
 await expect(panel.getByRole("alert")).toContainText(t.conflict);
 await panel.getByRole("button",{name:t.keep,exact:true}).click();await expect(panel.getByRole("alert")).toHaveCount(0);
 expect(docs.collections.payload.spotify).toEqual(imported);
 failImport=true;await panel.getByRole("button",{name:t.import,exact:true}).click();await expect(panel).toHaveAttribute("aria-busy","false");
 await expect(link).toBeVisible();await expect(panel.locator("time")).toHaveAttribute("datetime",imported.syncedAt);
});

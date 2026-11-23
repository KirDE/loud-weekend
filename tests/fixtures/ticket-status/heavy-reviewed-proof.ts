export const heavyProof = {
  "startDate": "2027-06-04",
  "endDate": "2027-06-06",
  "widgetId": "734dcd1a-6e7c-4465-b353-3bd5dcddd20b",
  "eventId": 2166331,
  "eventName": "HEAVY WEEK-END 2027",
  "eventStart": "2027-06-04T15:30:00Z",
  "categoryId": 1901845,
  "subcategoryId": 1873636,
  "rateId": 5629650,
  "sourceUrl": "https://www.heavyweekend.live/",
  "editionYear": 2027
};
export const HEAVY_WIDGET = heavyProof.widgetId;
export const HEAVY_WIDGET_API = `https://api.weezevent.com/ticket/widgets/${HEAVY_WIDGET}`;
export const HEAVY_STOCK = `https://www.weezevent.com/widget_billeterie.php?id_evenement=${heavyProof.eventId}&widget_key=${HEAVY_WIDGET}&locale=en_GB&color_primary=000000`;
export const HEAVY_PURCHASE = `https://widget.weezevent.com/ticket/${HEAVY_WIDGET}?locale=fr-fr`;

export const dataQualityCopy = {
  en: {
    title: "Catalogue data quality",
    intro:
      "These counts cover current editions in the public catalogue, not every announced event or source.",
    coverage: "Published coverage",
    hiatusExcluded:
      "Editions on hiatus are excluded from published coverage, but still count in source checks.",
    allPaused: "All current editions are on hiatus. There is no published coverage to report.",
    dates: "Dates recorded",
    lineup: "Announced lineup",
    tickets: "Explicit ticket status",
    ticketCategories: "Published ticket categories",
    timetable: "Published stage schedule",
    source: "Source checks",
    recent: "Successful check, not flagged stale",
    stale: "Check overdue, failed or source retired",
    unchecked: "No successful check recorded",
    evidence: "Recorded source evidence",
    dateEvidence: "Date evidence",
    lineupEvidence: "Lineup evidence",
    detail:
      "An evidence record means a source was reviewed for that field; " +
      "it does not certify every value or imply a new check.",
    last: "Most recent successful check among editions not flagged stale",
    noCheck: "No current successful check to display.",
    empty: "No current editions are available.",
    unavailable:
      "Catalogue data is temporarily unavailable. No coverage or health estimate can be shown.",
    more: "Browse festivals and official links",
  },
  de: {
    title: "Datenqualität des Katalogs",
    intro:
      "Die Zahlen beziehen sich auf aktuelle Ausgaben im öffentlichen " +
      "Katalog, nicht auf alle angekündigten Veranstaltungen oder Quellen.",
    coverage: "Veröffentlichte Abdeckung",
    hiatusExcluded:
      "Pausierende Ausgaben zählen bei den Quellenprüfungen, nicht bei der veröffentlichten Abdeckung.",
    allPaused:
      "Alle aktuellen Ausgaben pausieren. Es gibt keine veröffentlichte Abdeckung anzuzeigen.",
    dates: "Erfasste Termine",
    lineup: "Angekündigtes Line-up",
    tickets: "Expliziter Ticketstatus",
    ticketCategories: "Veröffentlichte Ticketkategorien",
    timetable: "Veröffentlichter Bühnenplan",
    source: "Quellenprüfungen",
    recent: "Erfolgreich und nicht als veraltet markiert",
    stale: "Prüfung überfällig, fehlgeschlagen oder Quelle eingestellt",
    unchecked: "Keine erfolgreiche Prüfung erfasst",
    evidence: "Erfasste Quellenbelege",
    dateEvidence: "Terminbelege",
    lineupEvidence: "Line-up-Belege",
    detail:
      "Ein Beleg bedeutet, dass eine Quelle für dieses Feld geprüft " +
      "wurde. Er bestätigt nicht jeden Wert oder eine erneute Prüfung.",
    last: "Neueste erfolgreiche Prüfung unter nicht als veraltet markierten Ausgaben",
    noCheck: "Keine aktuelle erfolgreiche Prüfung vorhanden.",
    empty: "Keine aktuellen Ausgaben vorhanden.",
    unavailable:
      "Katalogdaten sind vorübergehend nicht verfügbar. Abdeckung und Prüfstatus können nicht angezeigt werden.",
    more: "Festivals und offizielle Links ansehen",
  },
  ru: {
    title: "Качество данных каталога",
    intro:
      "В подсчёт входят текущие выпуски публичного каталога, а не все заявленные мероприятия или источники.",
    coverage: "Опубликованные данные",
    hiatusExcluded:
      "Выпуски на паузе учитываются при проверке источников, но не в сводке опубликованных данных.",
    allPaused: "Все текущие выпуски на паузе. Сводка опубликованных данных недоступна.",
    dates: "Указаны даты",
    lineup: "Объявлен состав",
    tickets: "Явный статус билетов",
    ticketCategories: "Опубликованы категории билетов",
    timetable: "Опубликовано расписание сцен",
    source: "Проверка источников",
    recent: "Успешная проверка без отметки об устаревании",
    stale: "Проверка просрочена, не удалась или источник отключён",
    unchecked: "Нет записи об успешной проверке",
    evidence: "Сохранённые подтверждения",
    dateEvidence: "Подтверждения дат",
    lineupEvidence: "Подтверждения состава",
    detail:
      "Запись означает, что источник проверяли для этого поля. Она не " +
      "подтверждает каждое значение и не означает повторную проверку.",
    last: "Последняя успешная проверка среди выпусков без отметки об устаревании",
    noCheck: "Нет актуальной успешной проверки для отображения.",
    empty: "Нет текущих выпусков.",
    unavailable: "Каталог временно недоступен. Сведения о полноте и проверках не отображаются.",
    more: "Фестивали и официальные ссылки",
  },
} as const;

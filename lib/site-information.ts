import type { Metadata } from "next";
import type { Language } from "./language-preference";

export const projectRepository = "https://github.com/KirDE/loud-weekend";

type Answer = { question: string; text: string; action?: { label: string; path: string } };
type Information = {
  about: string;
  faq: string;
  aboutDescription: string;
  faqDescription: string;
  independence: string;
  topics: Answer[];
};

export const siteInformation: Record<Language, Information> = {
  en: {
    about: "About Loud Weekend",
    faq: "Frequently asked questions",
    aboutDescription:
      "Discover European rock and metal festivals, compare lineups and organize your trip in one place.",
    faqDescription:
      "How Loud Weekend verifies festival data, handles missing information and helps you plan a trip.",
    independence:
      "Loud Weekend is an independent festival guide, not an organizer or ticket seller. Check the " +
      "organizer’s site for final dates, prices and ticket availability.",
    topics: [
      {
        question: "Where do festival details come from?",
        text:
          "Festival and edition pages link to official sources. When a verification date is shown, it " +
          "describes the check for that information, not a guarantee that tickets or schedules are still " +
          "unchanged.",
      },
      {
        question: "What do partial and TBA mean?",
        text:
          "Partial means some edition information is published but other details may still be missing. TBA " +
          "means information is to be announced. A listed date does not mean the complete lineup is known, " +
          "and an unknown ticket status does not mean the event is sold out.",
      },
      {
        question: "How can I report a correction?",
        text:
          "Include the festival, edition year, the detail that needs changing and a link to the official " +
          "announcement. GitHub reports are public; don’t include booking numbers or personal details.",
        action: { label: "Report a correction on GitHub", path: "/issues/new" },
      },
      {
        question: "Can I add festivals to my calendar?",
        text:
          "The planner can download an ICS file for your dated selections. Import it in your calendar app. " +
          "It is a snapshot, not a live subscription; later edits do not update the imported events.",
        action: { label: "Open the planner", path: "/planner/" },
      },
      {
        question: "How do playlists work?",
        text:
          "Festival pages link to playlists when the catalogue has one. A playlist does not necessarily " +
          "cover every artist. In the planner you can download an artist list without connecting a music " +
          "account.",
      },
      {
        question: "Will I receive notifications?",
        text:
          "You can manage preferences for festival updates in Notifications. Delivery depends on the " +
          "channels available and connected for your account.",
        action: { label: "Open notification settings", path: "/notifications/" },
      },
      {
        question: "Do I need an account?",
        text:
          "You can browse without signing in. The planner saves your selections in this browser by default. " +
          "Sign in and use the planner’s sync controls if you want to move those selections between " +
          "devices.",
      },
    ],
  },
  de: {
    about: "Über Loud Weekend",
    faq: "Häufige Fragen",
    aboutDescription:
      "Entdecke europäische Rock- und Metal-Festivals, vergleiche Line-ups und plane deine Reise an einem Ort.",
    faqDescription:
      "So prüft Loud Weekend Festivaldaten, kennzeichnet fehlende Informationen und hilft bei der Reiseplanung.",
    independence:
      "Loud Weekend ist ein unabhängiger Festivalführer, kein Veranstalter oder Ticketverkäufer. Prüfe " +
      "Termine, Preise und verfügbare Tickets auf der offiziellen Festival-Website.",
    topics: [
      {
        question: "Woher stammen die Festivaldaten?",
        text:
          "Festival- und Ausgabeseiten verlinken offizielle Quellen. Ein angezeigtes Prüfdatum bezieht sich " +
          "auf die Prüfung dieser Angaben. Es garantiert nicht, dass Ticketangebot oder Programm " +
          "unverändert sind.",
      },
      {
        question: "Was bedeuten „Teilweise“ und „Noch offen“?",
        text:
          "Bei einem teilweisen Eintrag sind einige Angaben zur Ausgabe veröffentlicht, andere können noch " +
          "fehlen. Offene Angaben wurden noch nicht bekannt gegeben. Ein Termin bedeutet nicht, dass das " +
          "Line-up vollständig ist. Ein unbekannter Ticketstatus bedeutet nicht, dass das Festival " +
          "ausverkauft ist.",
      },
      {
        question: "Wie melde ich einen Fehler?",
        text:
          "Nenne Festival, Jahr und die Angabe, die korrigiert werden soll, und verlinke die offizielle " +
          "Ankündigung. GitHub-Meldungen sind öffentlich. Teile dort keine Buchungsnummern oder " +
          "persönlichen Daten.",
        action: { label: "Fehler auf GitHub melden", path: "/issues/new" },
      },
      {
        question: "Kann ich Festivals in meinen Kalender übernehmen?",
        text:
          "Im Planer kannst du für ausgewählte Festivals mit bekannten Terminen eine ICS-Datei laden und in " +
          "deine Kalender-App importieren. Die Datei ist eine Momentaufnahme, kein Abo. Änderungen werden " +
          "nicht automatisch übernommen.",
        action: { label: "Planer öffnen", path: "/planner/" },
      },
      {
        question: "Wie funktionieren Playlists?",
        text:
          "Festivalseiten verlinken Playlists, wenn eine im Katalog hinterlegt ist. Eine Playlist enthält " +
          "nicht unbedingt alle auftretenden Acts. Im Planer kannst du eine Künstlerliste herunterladen, " +
          "ohne ein Musikkonto zu verbinden.",
      },
      {
        question: "Erhalte ich Benachrichtigungen?",
        text:
          "Unter „Benachrichtigungen“ kannst du Einstellungen für Festival-Updates verwalten. Die " +
          "Zustellung hängt von den verfügbaren und mit deinem Konto verbundenen Kanälen ab.",
        action: { label: "Benachrichtigungen öffnen", path: "/notifications/" },
      },
      {
        question: "Brauche ich ein Konto?",
        text:
          "Du kannst den Festivalführer ohne Anmeldung nutzen. Der Planer speichert deine Auswahl " +
          "standardmäßig in diesem Browser. Zur Übertragung auf andere Geräte melde dich an und nutze die " +
          "Synchronisierung im Planer.",
      },
    ],
  },
  ru: {
    about: "О Loud Weekend",
    faq: "Частые вопросы",
    aboutDescription:
      "Находите европейские рок- и метал-фестивали, сравнивайте лайнапы и планируйте поездку в одном месте.",
    faqDescription:
      "Как Loud Weekend проверяет данные, отмечает пробелы и помогает спланировать поездку.",
    independence:
      "Loud Weekend — независимый гид, а не организатор фестивалей или продавец билетов. Проверяйте " +
      "окончательные даты, цены и наличие билетов на сайте организатора.",
    topics: [
      {
        question: "Откуда берутся данные о фестивалях?",
        text:
          "На страницах фестивалей и отдельных выпусков есть ссылки на официальные источники. Если указана " +
          "дата проверки, она относится к конкретным данным и не гарантирует, что билеты или программа с " +
          "тех пор не изменились.",
      },
      {
        question: "Что означают неполные данные и статус «Будет объявлено»?",
        text:
          "Для неполной записи опубликована только часть сведений. Статус «Будет объявлено» означает, что " +
          "информации пока нет. Известная дата не означает, что лайнап уже полный, а неизвестный статус " +
          "билетов не означает, что они распроданы.",
      },
      {
        question: "Как сообщить об ошибке?",
        text:
          "Укажите фестиваль, год, сведения, которые нужно исправить, и ссылку на официальное объявление. " +
          "Сообщения на GitHub публичны: не добавляйте номера бронирований или личные данные.",
        action: { label: "Сообщить об ошибке на GitHub", path: "/issues/new" },
      },
      {
        question: "Можно ли добавить фестивали в календарь?",
        text:
          "Из планировщика можно скачать ICS-файл с выбранными фестивалями, даты которых известны, и " +
          "импортировать его в календарь. Это копия на момент скачивания, а не подписка: последующие " +
          "изменения не появятся автоматически.",
        action: { label: "Открыть планировщик", path: "/planner/" },
      },
      {
        question: "Как работают плейлисты?",
        text:
          "На странице фестиваля есть ссылки на плейлисты, если они внесены в каталог. В плейлисте могут " +
          "быть не все артисты. Из планировщика можно скачать список артистов без подключения музыкального " +
          "аккаунта.",
      },
      {
        question: "Будут ли приходить уведомления?",
        text:
          "Параметры обновлений можно настроить в разделе уведомлений. Доставка зависит от того, какие " +
          "каналы доступны и подключены в вашем аккаунте.",
        action: { label: "Открыть настройки уведомлений", path: "/notifications/" },
      },
      {
        question: "Нужен ли аккаунт?",
        text:
          "Открывать каталог можно без входа. По умолчанию планировщик сохраняет выбор в этом браузере. " +
          "Чтобы перенести его на другое устройство, войдите и воспользуйтесь синхронизацией в " +
          "планировщике.",
      },
    ],
  },
};

export type InformationPage = "about" | "faq";

export function informationMetadata(lang: Language, page: InformationPage): Metadata {
  const info = siteInformation[lang];
  return {
    title: info[page],
    description: page === "about" ? info.aboutDescription : info.faqDescription,
    alternates: {
      canonical: `/${lang}/${page}/`,
      languages: {
        "x-default": `/en/${page}/`,
        en: `/en/${page}/`,
        de: `/de/${page}/`,
        ru: `/ru/${page}/`,
      },
    },
  };
}

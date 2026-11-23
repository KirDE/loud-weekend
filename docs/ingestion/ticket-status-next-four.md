# Ordinary admission ticket observations

Pinkpop and Eurockéennes have organizer ticket pages with independently readable ordinary admission controls.
The ingest worker uses the existing bounded ticket supplement flow. The parser requires current organizer
edition dates and checks the secondary page before recording ticket status and source evidence. Eurockéennes
must also match the organizer's exact date range. Provider destinations and prices in evidence come from the
current visible page. No ticket facts are seeded or shipped as runtime data.

These checks do not infer overall sellout or remaining capacity from limited-price language, auxiliary
products, or the absence of a purchase control. Ambiguous or missing evidence requires review.

This change does not enable new stock sources for Jera On Air, 2000trees, or Resurrection Fest.
A Jera product needs an organizer-linked seller collection and ordinary weekend product. 2000trees needs an
organizer-linked current shop and corroborated ordinary checkout. Resurrection needs an organizer-linked public
sale route and corroborating namespace and ordinary product evidence. Existing catalogue behavior is unchanged
for those sources.

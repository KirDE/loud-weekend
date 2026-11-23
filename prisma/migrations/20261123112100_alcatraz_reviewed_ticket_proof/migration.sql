INSERT INTO "ReviewedTicketProof" ("festivalSlug", "sourceUrl", "editionYear", "proof")
SELECT 'alcatraz', "sourceUrl", 2027, '{
  "startDate": "2027-08-05",
  "endDate": "2027-08-08",
  "eventName": "Alcatraz Open Air 2027",
  "eventStart": "2027-08-05T09:00:00+02:00",
  "eventEnd": "2027-08-09T01:30:00+02:00",
  "shopId": "a22e0ce7-7657-4601-addc-13d7d0cac701",
  "eventId": "69108611-833e-49a3-8170-71f3011c23aa",
  "passId": "b97eba3b-553a-43c4-a419-db2dc62d71b6",
  "passName": "Combi - Wave 3"
}'::jsonb
FROM unnest(ARRAY['https://www.alcatraz.be/', 'https://www.alcatraz.be/en/']) AS routes("sourceUrl");

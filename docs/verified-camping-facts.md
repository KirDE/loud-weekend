# Organizer camping guidance

The site reads reviewed camping guidance from the matching festival edition in PostgreSQL. It does not
ship guidance with the application or reuse it across years.

The leased due-source worker recognizes the exact Alcatraz and Wacken camping URLs and the Graspop accessibility URL
configured for an edition with the `manual_review` strategy. It stores a review-only candidate and the organizer response
digest. The protected importer exposes the candidate and its `campingFingerprint`. To publish, claim
the issue and submit an `apply` decision whose `camping` field equals that fingerprint, using the
current snapshot and lease token. Do not submit editable guidance facts or caller-supplied evidence.

Publication checks the current edition, location, source and observation age again. The transaction
updates only the evidenced camping fields and records the provenance and approval. Replaying the same
approval does not create another publication. This change does not register or enable any source.

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash,
  type_id, db_content
) VALUES (
  1, 'Home', 'home', NULL, NULL, NULL, NULL,
  '2026-09-19 00:00:00.000', '2026-09-19 00:00:00.000',
  1, 1,
  NULL, NULL, NULL, 0,
  2, NULL
);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash,
  type_id, db_content
) VALUES (
  2, 'Hello World', 'hello_world', NULL, NULL, NULL, NULL,
  '2026-09-19 00:00:00.000', '2026-09-19 00:00:00.000',
  1, 1,
  NULL, NULL, NULL, 0,
  2, 'Welcome to the decko-ts demo running on Cloudflare Workers. This card was seeded by db/seed.sql; the engine walks the inclusion closure in one batched round trip.'
);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash,
  type_id, db_content
) VALUES (
  3, NULL, NULL, NULL, 1, 2, NULL,
  '2026-09-19 00:00:00.000', '2026-09-19 00:00:00.000',
  1, 1,
  NULL, NULL, NULL, 0,
  2, NULL
);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash,
  type_id, db_content
) VALUES (
  4, 'About', 'about', NULL, NULL, NULL, NULL,
  '2026-09-19 00:00:00.000', '2026-09-19 00:00:00.000',
  1, 1,
  NULL, NULL, NULL, 0,
  2, 'decko-ts: TypeScript port of the Decko card engine. {{Hello World}} is one nested inclusion away.'
);

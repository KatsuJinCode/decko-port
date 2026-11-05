INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1101, 'Cardtype', 'cardtype', 'cardtype',
  NULL, NULL, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1101, NULL
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE codename = 'cardtype');

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1102, 'RichText', 'rich_text', 'basic',
  NULL, NULL, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1101, NULL
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE codename = 'basic');

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1103, 'Set', 'set', 'set',
  NULL, NULL, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1102, NULL
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE codename = 'set');

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1104, 'Setting', 'setting', 'setting',
  NULL, NULL, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1101, NULL
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE codename = 'setting');

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1105, '*all', '*all', 'all',
  NULL, NULL, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1103, '{}'
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE codename = 'all');

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1106, '*default', '*default', 'default',
  NULL, NULL, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1104, NULL
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE codename = 'default');

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1120, 'User', 'user', 'user',
  NULL, NULL, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1101, NULL
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE codename = 'user');

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1121, '*account', '*account', 'account',
  NULL, NULL, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1102, NULL
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE codename = 'account');

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1122, '*email', '*email', 'email',
  NULL, NULL, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1102, NULL
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE codename = 'email');

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1123, '*password', '*password', 'password',
  NULL, NULL, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1102, NULL
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE codename = 'password');

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1124, '*salt', '*salt', 'salt',
  NULL, NULL, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1102, NULL
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE codename = 'salt');

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1125, '*status', '*status', 'status',
  NULL, NULL, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1102, NULL
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE codename = 'status');

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1130, 'Decko Bot', 'decko_bot', 'decko_bot',
  NULL, NULL, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1102, '<p>
  This is the account that makes any automated updates &mdash; cards
  created when someone signs up, link updates when renaming cards, etc.
</p>'
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE codename = 'decko_bot');

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1131, 'Anonymous', 'anonymous', 'anonymous',
  NULL, NULL, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1102, '<p>Edits made by people who are not signed in are credited to Anonymous. <a href="http://decko.org/account">Learn more about accounts</a>.</p>'
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE codename = 'anonymous');

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1107, NULL, NULL, NULL,
  1105, 1106, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1102, NULL
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE left_id = 1105 AND right_id = 1106);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1140, NULL, NULL, NULL,
  1130, 1121, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1102, NULL
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE left_id = 1130 AND right_id = 1121);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1141, NULL, NULL, NULL,
  1140, 1122, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1102, 'no-reply@decko.org'
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE left_id = 1140 AND right_id = 1122);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1142, NULL, NULL, NULL,
  1140, 1124, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1102, '311d92453d50c9beb2ef77464dbdb6b69701477d'
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE left_id = 1140 AND right_id = 1124);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1143, NULL, NULL, NULL,
  1140, 1125, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1102, 'active'
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE left_id = 1140 AND right_id = 1125);

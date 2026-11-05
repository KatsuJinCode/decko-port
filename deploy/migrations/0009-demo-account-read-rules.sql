INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1301, '*read', '*read', 'read',
  NULL, NULL, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1104, NULL
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE codename = 'read');

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1302, '*right', '*right', 'right',
  NULL, NULL, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1103, NULL
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE codename = 'right');

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1303, NULL, NULL, NULL,
  1105, 1301, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1102, 'Anyone'
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE left_id = 1105 AND right_id = 1301);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1304, NULL, NULL, NULL,
  1121, 1302, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1103, NULL
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE left_id = 1121 AND right_id = 1302);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1305, NULL, NULL, NULL,
  1304, 1301, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1102, 'Help Desk'
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE left_id = 1304 AND right_id = 1301);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1306, NULL, NULL, NULL,
  1122, 1302, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1103, NULL
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE left_id = 1122 AND right_id = 1302);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1307, NULL, NULL, NULL,
  1306, 1301, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1102, 'Help Desk'
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE left_id = 1306 AND right_id = 1301);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1308, NULL, NULL, NULL,
  1123, 1302, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1103, NULL
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE left_id = 1123 AND right_id = 1302);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1309, NULL, NULL, NULL,
  1308, 1301, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1102, 'Help Desk'
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE left_id = 1308 AND right_id = 1301);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1310, NULL, NULL, NULL,
  1124, 1302, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1103, NULL
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE left_id = 1124 AND right_id = 1302);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1311, NULL, NULL, NULL,
  1310, 1301, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1102, 'Help Desk'
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE left_id = 1310 AND right_id = 1301);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1312, NULL, NULL, NULL,
  1125, 1302, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1103, NULL
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE left_id = 1125 AND right_id = 1302);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1313, NULL, NULL, NULL,
  1312, 1301, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1102, 'Help Desk'
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE left_id = 1312 AND right_id = 1301);

INSERT INTO card_references (referer_id, referee_key, referee_id, ref_type, is_present)
SELECT 1303, '', 1210, 'L', 1
WHERE NOT EXISTS (
  SELECT 1 FROM card_references
   WHERE referer_id = 1303 AND referee_id = 1210
);

INSERT INTO card_references (referer_id, referee_key, referee_id, ref_type, is_present)
SELECT 1305, '', 1215, 'L', 1
WHERE NOT EXISTS (
  SELECT 1 FROM card_references
   WHERE referer_id = 1305 AND referee_id = 1215
);

INSERT INTO card_references (referer_id, referee_key, referee_id, ref_type, is_present)
SELECT 1307, '', 1215, 'L', 1
WHERE NOT EXISTS (
  SELECT 1 FROM card_references
   WHERE referer_id = 1307 AND referee_id = 1215
);

INSERT INTO card_references (referer_id, referee_key, referee_id, ref_type, is_present)
SELECT 1309, '', 1215, 'L', 1
WHERE NOT EXISTS (
  SELECT 1 FROM card_references
   WHERE referer_id = 1309 AND referee_id = 1215
);

INSERT INTO card_references (referer_id, referee_key, referee_id, ref_type, is_present)
SELECT 1311, '', 1215, 'L', 1
WHERE NOT EXISTS (
  SELECT 1 FROM card_references
   WHERE referer_id = 1311 AND referee_id = 1215
);

INSERT INTO card_references (referer_id, referee_key, referee_id, ref_type, is_present)
SELECT 1313, '', 1215, 'L', 1
WHERE NOT EXISTS (
  SELECT 1 FROM card_references
   WHERE referer_id = 1313 AND referee_id = 1215
);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1201, 'Role', 'role', 'role',
  NULL, NULL, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1201, 'Each [[user]] can be given roles to organize site permissions. 
[[http://decko.org/Role|Learn more about roles]].'
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE codename = 'role');

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1202, '*members', '*member', 'members',
  NULL, NULL, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1102, NULL
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE codename = 'members');

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1210, 'Anyone', 'anyone', 'anyone',
  NULL, NULL, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1201, 'Everyone has this role, whether signed in or not. [[http://decko.org/account|more]]'
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE codename = 'anyone');

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1211, 'Anyone Signed In', 'anyone_signed_in', 'anyone_signed_in',
  NULL, NULL, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1201, 'Anyone who is signed in has this role. [[http://decko.org/account|more]]'
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE codename = 'anyone_signed_in');

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1212, 'Administrator', 'administrator', 'administrator',
  NULL, NULL, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1201, '[[_left+:members|Administrators]] can create, read, update and delete any card.
[[http://decko.org/permissions|more]]'
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE codename = 'administrator');

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1213, 'Eagle', 'eagle', 'eagle',
  NULL, NULL, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1201, '[[Eagle+:members|Eagle users]] can add and edit content.'
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE codename = 'eagle');

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1214, 'Shark', 'shark', 'shark',
  NULL, NULL, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1201, '[[_left+:members|Shark users]] can configure the deck and create structures.'
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE codename = 'shark');

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) SELECT
  1215, 'Help Desk', 'help_desk', 'help_desk',
  NULL, NULL, NULL,
  '2026-10-02 00:00:00.000', '2026-10-02 00:00:00.000', 1130, 1130,
  NULL, NULL, NULL, 0, 1201, '[[_left+*members|Help Desk users]] can manage accounts and edit help text.'
WHERE NOT EXISTS (SELECT 1 FROM cards WHERE codename = 'help_desk');

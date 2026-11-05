INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) VALUES (
  1, 'Demo Bot', 'demo_bot', NULL,
  NULL, NULL, NULL,
  '2026-09-20 00:00:00.000', '2026-09-20 00:00:00.000', 1, 1,
  '*all', 30, NULL, 0, 4, 'Synthetic author identity used as creator and updater on every card in this demo deck.'
);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) VALUES (
  2, 'Search', 'search', 'search_type',
  NULL, NULL, NULL,
  '2026-09-20 00:00:00.000', '2026-09-20 00:00:00.000', 1, 1,
  '*all', 30, NULL, 0, 3, NULL
);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) VALUES (
  3, 'Cardtype', 'cardtype', NULL,
  NULL, NULL, NULL,
  '2026-09-20 00:00:00.000', '2026-09-20 00:00:00.000', 1, 1,
  '*all', 30, NULL, 0, 3, NULL
);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) VALUES (
  4, 'User', 'user', NULL,
  NULL, NULL, NULL,
  '2026-09-20 00:00:00.000', '2026-09-20 00:00:00.000', 1, 1,
  '*all', 30, NULL, 0, 3, NULL
);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) VALUES (
  5, 'Note', 'note', NULL,
  NULL, NULL, NULL,
  '2026-09-20 00:00:00.000', '2026-09-20 00:00:00.000', 1, 1,
  '*all', 30, NULL, 0, 3, NULL
);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) VALUES (
  10, 'Home', 'home', NULL,
  NULL, NULL, NULL,
  '2026-09-20 00:00:00.000', '2026-09-20 00:00:00.000', 1, 1,
  '*all', 30, NULL, 0, 5, '<p>Welcome to the decko-ts synthetic demo deck on Cloudflare Workers.</p><p>{{Demo Guide}}</p>'
);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) VALUES (
  11, 'About', 'about', NULL,
  NULL, NULL, NULL,
  '2026-09-20 00:00:00.000', '2026-09-20 00:00:00.000', 1, 1,
  '*all', 30, NULL, 0, 5, '<p>This deck contains only synthetic demo content. No real member data is ever deployed here.</p>'
);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) VALUES (
  12, 'Demo Guide', 'demo_guide', NULL,
  NULL, NULL, NULL,
  '2026-09-20 00:00:00.000', '2026-09-20 00:00:00.000', 1, 1,
  '*all', 30, NULL, 0, 5, '<p>Guide intro. The sections below are compound cards:</p>{{Demo Guide+Section One}}'
);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) VALUES (
  13, 'Section One', 'section_one', NULL,
  NULL, NULL, NULL,
  '2026-09-20 00:00:00.000', '2026-09-20 00:00:00.000', 1, 1,
  '*all', 30, NULL, 0, 5, '<p>Section One body text (a simple Note card).</p>'
);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) VALUES (
  14, 'Detail', 'detail', NULL,
  NULL, NULL, NULL,
  '2026-09-20 00:00:00.000', '2026-09-20 00:00:00.000', 1, 1,
  '*all', 30, NULL, 0, 5, '<p>Detail body text.</p>{{History}}'
);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) VALUES (
  15, 'History', 'history', NULL,
  NULL, NULL, NULL,
  '2026-09-20 00:00:00.000', '2026-09-20 00:00:00.000', 1, 1,
  '*all', 30, NULL, 0, 5, '<p>History body text — the fourth inclusion level of the demo chain.</p>'
);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) VALUES (
  16, NULL, NULL, NULL,
  12, 13, NULL,
  '2026-09-20 00:00:00.000', '2026-09-20 00:00:00.000', 1, 1,
  '*all', 30, NULL, 0, 5, '<p>Section One rendered as a compound card.</p>{{Detail}}'
);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) VALUES (
  17, NULL, NULL, NULL,
  16, 14, NULL,
  '2026-09-20 00:00:00.000', '2026-09-20 00:00:00.000', 1, 1,
  '*all', 30, NULL, 0, 5, '<p>Detail rendered at compound depth 3 of the demo chain.</p>'
);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) VALUES (
  18, NULL, NULL, NULL,
  17, 15, NULL,
  '2026-09-20 00:00:00.000', '2026-09-20 00:00:00.000', 1, 1,
  '*all', 30, NULL, 0, 5, '<p>History body at compound depth 4 — the deepest node of the demo chain.</p>'
);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) VALUES (
  20, 'Note Index', 'note_index', NULL,
  NULL, NULL, NULL,
  '2026-09-20 00:00:00.000', '2026-09-20 00:00:00.000', 1, 1,
  '*all', 30, NULL, 0, 2, '{"type":"Note","sort":"name"}'
);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) VALUES (
  6, 'Role', 'role', 'role',
  NULL, NULL, NULL,
  '2026-09-20 00:00:00.000', '2026-09-20 00:00:00.000', 1, 1,
  '*all', 30, NULL, 0, 3, NULL
);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) VALUES (
  7, 'Set', 'set', 'set',
  NULL, NULL, NULL,
  '2026-09-20 00:00:00.000', '2026-09-20 00:00:00.000', 1, 1,
  '*all', 30, NULL, 0, 3, NULL
);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) VALUES (
  8, 'Setting', 'setting', 'setting',
  NULL, NULL, NULL,
  '2026-09-20 00:00:00.000', '2026-09-20 00:00:00.000', 1, 1,
  '*all', 30, NULL, 0, 3, NULL
);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) VALUES (
  25, '*all', '*all', 'all',
  NULL, NULL, NULL,
  '2026-09-20 00:00:00.000', '2026-09-20 00:00:00.000', 1, 1,
  '*all', 30, NULL, 0, 7, NULL
);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) VALUES (
  26, '*read', '*read', 'read',
  NULL, NULL, NULL,
  '2026-09-20 00:00:00.000', '2026-09-20 00:00:00.000', 1, 1,
  '*all', 30, NULL, 0, 8, NULL
);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) VALUES (
  27, 'Anyone', 'anyone', 'anyone',
  NULL, NULL, NULL,
  '2026-09-20 00:00:00.000', '2026-09-20 00:00:00.000', 1, 1,
  '*all', 30, NULL, 0, 6, NULL
);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) VALUES (
  28, 'Anonymous', 'anonymou', 'anonymous',
  NULL, NULL, NULL,
  '2026-09-20 00:00:00.000', '2026-09-20 00:00:00.000', 1, 1,
  '*all', 30, NULL, 0, 3, NULL
);

INSERT INTO cards (
  id, name, key, codename, left_id, right_id, current_revision_id,
  created_at, updated_at, creator_id, updater_id,
  read_rule_class, read_rule_id, references_expired, trash, type_id, db_content
) VALUES (
  30, NULL, NULL, NULL,
  25, 26, NULL,
  '2026-09-20 00:00:00.000', '2026-09-20 00:00:00.000', 1, 1,
  '*all', 30, NULL, 0, 7, '[[Anyone]]'
);

INSERT INTO card_references (referer_id, referee_key, referee_id, ref_type, is_present)
VALUES (30, '', 27, 'L', 1);

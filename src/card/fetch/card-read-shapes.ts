export const CARD_ROW_BY_ID_SQL = "SELECT * FROM cards WHERE id = ? LIMIT 1";

export const LIVE_CARD_ROW_BY_ID_SQL = "SELECT * FROM cards WHERE id = ? AND trash = 0 LIMIT 1";

export const CARD_CODENAME_BY_ID_SQL = "SELECT codename FROM cards WHERE id = ?";

export const CARD_NAME_TRIPLE_BY_ID_SQL = "SELECT name, left_id, right_id FROM cards WHERE id = ? LIMIT 1";

export const CARD_ROW_BY_KEY_SQL = "SELECT * FROM cards WHERE key = ? AND trash = 0 LIMIT 1";

export const CARD_CODENAME_BY_KEY_SQL = "SELECT codename FROM cards WHERE key = ? AND trash = 0";

export const CARD_ID_BY_KEY_SQL = "SELECT id FROM cards WHERE key = ? AND trash = 0 LIMIT 1";

export const CARD_ID_BY_CODENAME_SQL =
  "SELECT id FROM cards WHERE codename = ? AND trash = 0 ORDER BY id LIMIT 1";

export const CARD_ID_BY_JUNCTION_SQL =
  "SELECT id FROM cards WHERE left_id = ? AND right_id = ? AND trash = 0 ORDER BY id LIMIT 1";

export const CARD_DB_CONTENT_BY_JUNCTION_SQL =
  "SELECT db_content FROM cards WHERE left_id = ? AND right_id = ? AND trash = 0 ORDER BY id LIMIT 1";

export const CARD_ID_BY_JUNCTION_ORDERED_SQL = CARD_ID_BY_JUNCTION_SQL;

export const CARD_IDS_BY_TYPE_SQL = "SELECT id FROM cards WHERE type_id = ?";

export const CARD_CODENAME_TRIPLE_BY_ID_SQL =
  `SELECT c.codename AS own_code, t.codename AS type_code, r.codename AS right_code, lt.codename AS left_type_code
       FROM cards c
       LEFT JOIN cards t ON t.id = c.type_id
       LEFT JOIN cards r ON r.id = c.right_id
       LEFT JOIN cards l ON l.id = c.left_id
       LEFT JOIN cards lt ON lt.id = l.type_id
       WHERE c.id = ?`;

export const CARD_TYPE_CODENAME_BY_ID_SQL =
  "SELECT t.codename AS codename FROM cards c JOIN cards t ON t.id = c.type_id WHERE c.id = ?";

export const TRASHED_CARD_BY_JUNCTION_SQL =
  "SELECT * FROM cards WHERE left_id = ? AND right_id = ? AND trash = 1 LIMIT 1";

export const LIVE_CARD_ID_BY_KEY_FOLDED_SQL =
  "SELECT id FROM cards WHERE key COLLATE NOCASE = ? AND trash = 0 LIMIT 1";

export const TRASHED_CARD_BY_KEY_SQL =
  "SELECT * FROM cards WHERE key COLLATE NOCASE = ? AND trash = 1 LIMIT 1";

export const CARD_ID_BY_JUNCTION_PLUS_SQL =
  "SELECT id FROM cards WHERE left_id = ? AND right_id = ? AND +trash = 0";

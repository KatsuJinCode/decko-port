export const ONE_TRIP_SIDE_DDL: readonly string[] = [
  `CREATE TABLE IF NOT EXISTS one_trip_meta (
     key TEXT PRIMARY KEY,
     value TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS one_trip_edges (
     referer_id INTEGER NOT NULL,
     referee_key TEXT NOT NULL,
     referee_id INTEGER,
     kind TEXT NOT NULL,
     ref_view TEXT,
     PRIMARY KEY (referer_id, referee_key, kind)
   )`,
  `CREATE INDEX IF NOT EXISTS one_trip_edges_referee_id
     ON one_trip_edges(referee_id)`,
  `CREATE INDEX IF NOT EXISTS one_trip_edges_referee_key
     ON one_trip_edges(referee_key)`,
  `CREATE TABLE IF NOT EXISTS one_trip_page_closure (
     page_id INTEGER NOT NULL,
     card_id INTEGER NOT NULL,
     depth INTEGER NOT NULL,
     views TEXT NOT NULL DEFAULT '[]',
     PRIMARY KEY (page_id, card_id)
   )`,
  `CREATE INDEX IF NOT EXISTS one_trip_page_closure_card
     ON one_trip_page_closure(card_id)`,
  `CREATE TABLE IF NOT EXISTS one_trip_search_nests (
     search_card_id INTEGER PRIMARY KEY,
     cql_text TEXT NOT NULL
   )`,
  `CREATE TABLE IF NOT EXISTS one_trip_search_results (
     search_card_id INTEGER NOT NULL,
     position INTEGER NOT NULL,
     card_id INTEGER NOT NULL,
     PRIMARY KEY (search_card_id, position)
   )`,
  `CREATE INDEX IF NOT EXISTS one_trip_search_results_card
     ON one_trip_search_results(card_id)`,
  `CREATE TABLE IF NOT EXISTS one_trip_page_rules (
     page_id INTEGER NOT NULL,
     card_id INTEGER NOT NULL,
     setting_code TEXT NOT NULL,
     candidate_key TEXT NOT NULL,
     candidate_id INTEGER,
     PRIMARY KEY (page_id, card_id, setting_code, candidate_key)
   )`,
  `CREATE TABLE IF NOT EXISTS one_trip_render_plans (
     page_id INTEGER NOT NULL,
     seq INTEGER NOT NULL,
     family TEXT NOT NULL,
     sql TEXT NOT NULL,
     params_json TEXT NOT NULL,
     PRIMARY KEY (page_id, seq)
   )`,
];

export const ONE_TRIP_PLAN_INVALIDATION_TRIGGER_DDL: readonly string[] = [
  `CREATE TRIGGER IF NOT EXISTS cards_drop_render_plans_upd AFTER UPDATE ON cards BEGIN
     DELETE FROM one_trip_render_plans
      WHERE page_id IN (SELECT page_id FROM one_trip_page_closure WHERE card_id = NEW.id)
         OR page_id NOT IN (SELECT page_id FROM one_trip_page_closure);
   END`,
  `CREATE TRIGGER IF NOT EXISTS cards_drop_render_plans_del AFTER DELETE ON cards BEGIN
     DELETE FROM one_trip_render_plans
      WHERE page_id IN (SELECT page_id FROM one_trip_page_closure WHERE card_id = OLD.id)
         OR page_id NOT IN (SELECT page_id FROM one_trip_page_closure);
   END`,
  `CREATE TRIGGER IF NOT EXISTS card_references_drop_render_plans_ins AFTER INSERT ON card_references BEGIN
     DELETE FROM one_trip_render_plans
      WHERE page_id IN (SELECT page_id FROM one_trip_page_closure WHERE card_id = NEW.referer_id)
         OR page_id NOT IN (SELECT page_id FROM one_trip_page_closure);
   END`,
  `CREATE TRIGGER IF NOT EXISTS card_references_drop_render_plans_del AFTER DELETE ON card_references BEGIN
     DELETE FROM one_trip_render_plans
      WHERE page_id IN (SELECT page_id FROM one_trip_page_closure WHERE card_id = OLD.referer_id)
         OR page_id NOT IN (SELECT page_id FROM one_trip_page_closure);
   END`,
  `CREATE TRIGGER IF NOT EXISTS card_references_drop_render_plans_upd AFTER UPDATE ON card_references BEGIN
     DELETE FROM one_trip_render_plans
      WHERE page_id IN (SELECT page_id FROM one_trip_page_closure WHERE card_id = OLD.referer_id)
         OR page_id NOT IN (SELECT page_id FROM one_trip_page_closure);
   END`,
];

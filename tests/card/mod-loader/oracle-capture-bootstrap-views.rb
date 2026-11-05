# oracle-capture-bootstrap-views.rb - oracle capture for the card-mod-bootstrap
# loader port (decko-ts mod-port stream, card-mod-bootstrap-0.20.0).
#
# Run (from tools/oracle/decko-oracle-app):
#   RAILS_ENV=development RUBY_DLL_PATH=C:/localProjects/decko-ts/tools/oracle/mysql-client-scratch/lib \
#     bundle exec decko runner \
#     C:/localProjects/decko-ts/tests/card/mod-loader/oracle-capture-bootstrap-views.rb
#
# Records to fixtures/captured/bootstrap-views.json:
# 1. the :carousel view bytes (set/all/bootstrap/carousel.rb:2-8 wrapping
#    lib/card/bootstrap/component/carousel.rb:16-79) for a list card with
#    3 image items - the byte oracle for the TS-side A/B test that pins the
#    carousel SHIM's div.carousel.slide + indicators + items + controls
#    structure
# 2. the :customize_button view bytes
#    (set/type/bootswatch_skin/html_views.rb:24-48) on a bootswatch_skin
#    card with no +parent subcard - the byte oracle that pins what
#    Card::Path#render + link_to_card emit for path: { action: :create,
#    card: new_skin_path_args(new_name) }, class: "btn btn-sm
#    btn-outline-primary me-2"
#
# Determinism contract (mirrors oracle-capture-list-mod.rb): output JSON is
# pretty-printed with deeply sorted keys + trailing newline; the random
# data-slot-id attribute is normalized to a placeholder; probe seed cards are
# created-if-missing and DELETED (trashed) after capture so the shared oracle
# DB returns to its prior state.

require "json"

REPO_ROOT = File.expand_path("../../..", __dir__)
OUT_PATH  = File.join(REPO_ROOT, "fixtures", "captured", "bootstrap-views.json")

# ---- probe cards -----------------------------------------------------------
# 3 list items whose :core view renders nest content; the carousel's
# bs_carousel component walks the list's item_cards and emits one
# carousel-item div per rendered nest. RichText items avoid the Image
# type's required-file validation.
ITEM1 = "Oracle Carousel Item One"
ITEM2 = "Oracle Carousel Item Two"
ITEM3 = "Oracle Carousel Item Three"

# The list card that wraps the 3 items.
PROBE_CAROUSEL = "Oracle Carousel Probe"

# The bootswatch_skin probe for :customize_button - no +parent subcard, so
# the view does NOT short-circuit to "" and the link_to_card fires.
PROBE_SKIN = "Oracle Customize Skin Probe"

# The probe's set card (auto-created by *self rule creation).
PROBE_SKIN_SET = "#{PROBE_SKIN}+*self"

SEEDS = [
  # carousel probe - 3 RichText items + a list that points to them
  { name: ITEM1, type: "RichText", content: "item one body" },
  { name: ITEM2, type: "RichText", content: "item two body" },
  { name: ITEM3, type: "RichText", content: "item three body" },
  { name: PROBE_CAROUSEL, type: "List",
    content: "#{ITEM1}\n#{ITEM2}\n#{ITEM3}" },
  # customize_button probe - a bootswatch_skin card. The bootswatch_skin
  # type card was created in earlier seed decks; this probe uses the
  # existing type via type: "bootswatch_skin".
  { name: PROBE_SKIN, type: "bootswatch_skin", content: "skin css body" }
].freeze

# views to render on each probe
RENDER_TARGETS = {
  PROBE_CAROUSEL => %i[carousel],
  PROBE_SKIN     => %i[customize_button]
}.freeze

# The data-slot-id attribute is SecureRandom.hex(10) (card-mod-format
# set/all/html/wrap.rb:45). The data-card-id is the row id, which advances
# every seed/trash cycle. Both are seed state, not mod semantics.
SLOT_ID_RE = /data-slot-id=(["'])\h+\1/.freeze
CARD_ID_RE = /data-card-id=(["'])\d+\1/.freeze

def normalize(html)
  html.gsub(SLOT_ID_RE, 'data-slot-id="RANDOMIZED"')
      .gsub(CARD_ID_RE, 'data-card-id="RANDOMIZED"')
end

def deep_sort(obj)
  case obj
  when Hash  then obj.sort.to_h.transform_values { |v| deep_sort(v) }
  when Array then obj.map { |v| deep_sort(v) }
  else obj
  end
end

def seed_card(attrs)
  existing = Card.fetch(attrs[:name], new: {})
  if existing.new_card?
    Card.create! attrs
    "created"
  else
    "present"
  end
end

payload = {}
seed_log = {}

# ---- seed (create-if-missing; removed again after capture) ------------------
Card::Auth.as_bot do
  SEEDS.each { |attrs| seed_log[attrs[:name]] = seed_card(attrs) }
end

# ---- rendered probe views ---------------------------------------------------
views = {}
RENDER_TARGETS.each do |name, view_list|
  card = Card.fetch(name)
  format = card.format
  view_list.each do |view|
    views["#{name}##{view}"] = normalize(format.render(view))
  rescue StandardError => e
    views["#{name}##{view}"] = "CAPTURE_ERROR: #{e.class}: #{e.message}"
  end
end
payload["rendered"] = views

# ---- cleanup: trash the probe cards so the shared DB stays untouched --------
# (creating a type: "bootswatch_skin" card auto-creates its set card
# "X+*self" - that must be trashed too, or every run leaves one more
# counted card and the count drifts)
Card::Auth.as_bot do
  [
    PROBE_SKIN_SET,
    PROBE_SKIN,
    PROBE_CAROUSEL,
    ITEM1,
    ITEM2,
    ITEM3
  ].each do |name|
    card = Card.fetch(name)
    next if card.nil? || card.new_card?

    begin
      card.delete!
      seed_log["deleted:#{name}"] = "deleted"
    rescue StandardError => e
      seed_log["deleted:#{name}"] = "DELETE_FAILED: #{e.class}: #{e.message}"
    end
  end
end
# NO card_count field: the oracle DB is shared with other streams'
# benchmarks, so a card count is racy harness telemetry, not mod-mechanism
# oracle data.

# ---- write ------------------------------------------------------------------
File.write(OUT_PATH, JSON.pretty_generate(deep_sort(payload)) + "\n")
puts "seed_log: #{JSON.generate(deep_sort(seed_log))}"
puts "WROTE #{OUT_PATH} (#{File.size(OUT_PATH)} bytes)"
$stdout.flush
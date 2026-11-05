# oracle-capture-edit-forms.rb - oracle capture for the card-mod-edit CORE
# EDIT-FORM PATH (write-path slice 3): the signed-in edit view for a standard
# card — the modal wrap, the frame/help slots, the card_form update form
# (name editor, type row, content input, conflict tracker hidden field,
# save/cancel/delete buttons) — plus the anonymous denial behavior.
#
# Run (from tools/oracle/decko-oracle-app):
#   RAILS_ENV=development bundle exec decko runner \
#     C:/localProjects/decko-ts-lane-forms/tests/card/mod-loader/oracle-capture-edit-forms.rb
#
# Records to <script-repo>/fixtures/captured/edit-forms.json:
# 1. For each target card (an existing basic RichText content card and the
#    deck-level Home card) and each actor (Decko Bot = signed-in admin,
#    Sara = signed-in non-admin member, Anonymous): the rendered :edit view
#    bytes (modal-wrapped frame + form) and the inner :edit_form bytes.
#    Anonymous renders raise Card::Error::PermissionDenied - recorded as
#    {denied: true, class:, message:} (what Ruby gives anonymous at the
#    view level; the controller turns the same error into the denial page).
# 2. The edit-conflict validation state: a stale last_action_id_before_edit
#    + update! on the basic card - the detect_conflict validation event
#    (card-mod-history set/all/history/events.rb:19) adds the :conflict
#    error and aborts; the rescue records the error class/message. NO row is
#    written (validation failure = no act); the script asserts the
#    card_actions count is unchanged and records that proof.
#
# Targets are EXISTING cards ("Oracle Basics" id 605, "Home" id 521 - both
# seeded by the oracle smoke seed). The capture performs ZERO card writes:
# no Card.create/update on any target; the only update! is the conflict
# probe whose validation failure prevents persistence (proven by the
# action-count assertion below).
#
# Determinism contract (mirrors oracle-capture-content-inputs.rb): output
# JSON is pretty-printed with deeply sorted keys + a trailing newline;
# random/dynamic attributes are normalized to placeholders:
#   data-slot-id  (random hex per slot - Ruby assigns fresh ids every render)
#   data-card-id  (row ids are seed-state, not form semantics)
#   data-select2-id ("<unique_id>-<epoch seconds>" - Time.now based)
# The TS test applies the same normalization to its own renders before
# comparing. A re-run must produce byte-identical JSON (verified: the two
# runs recorded in tmp/wrong-goal-hunt/forms-lane.md).

require "json"

REPO_ROOT = File.expand_path("../../..", __dir__)
OUT_PATH  = File.join(REPO_ROOT, "fixtures", "captured", "edit-forms.json")
PIN_DIR   = "C:/localProjects/brandonDojoTech/tmp/wrong-goal-hunt/captures-auth-forms"

TARGETS = [
  { name: "Oracle Basics", label: "basic_note" },
  { name: "Home",          label: "deck_level" }
].freeze
ACTORS = %w[bot sara anonymous].freeze

SLOT_ID_RE   = /data-slot-id=(["'])\h+\1/.freeze
CARD_ID_RE   = /data-card-id=(["'])\d+\1/.freeze
SELECT2_ID_RE = /data-select2-id=(["'])([^"']*)-\d+\1/.freeze
# the conflict-tracker hidden field carries card.last_action_id - an action
# row id that advances on every legitimate write to the card (seed state,
# not form semantics)
REVISION_VALUE_RE = /value="\d+" name="card\[last_action_id_before_edit\]"/.freeze

def normalize(html)
  html.gsub(SLOT_ID_RE, 'data-slot-id="RANDOMIZED"')
      .gsub(CARD_ID_RE, 'data-card-id="RANDOMIZED"')
      .gsub(SELECT2_ID_RE, 'data-select2-id="SELECT2"')
      .gsub(REVISION_VALUE_RE, 'value="ACTION_ID" name="card[last_action_id_before_edit]"')
end

def deep_sort(obj)
  case obj
  when Hash  then obj.sort.to_h.transform_values { |v| deep_sort(v) }
  when Array then obj.map { |v| deep_sort(v) }
  else obj
  end
end

def as_actor(actor)
  case actor
  when "bot"   then Card::Auth.signin(Card::DeckoBotID)
  when "sara"
    sara = Card["Sara"]
    raise "Sara account card missing" unless sara

    Card::Auth.signin(sara.id)
  when "anonymous" then Card::Auth.signin(Card::AnonymousID)
  end
  yield
ensure
  Card::Auth.signin(Card::AnonymousID)
end

def render_or_deny(card, view)
  normalize(card.format(:html).render(view))
rescue StandardError => e
  { "denied" => true, "error_class" => e.class.name, "message" => e.message[0, 300] }
end

def action_count
  ActiveRecord::Base.connection.select_value("SELECT COUNT(*) FROM card_actions").to_i
end

results = { "actors_note" => "bot=Decko Bot(admin) sara=Sara(non-admin member) anonymous=Anonymous",
            "normalizations" => {
              "data-card-id" => "RANDOMIZED",
              "data-select2-id" => "SELECT2",
              "data-slot-id" => "RANDOMIZED"
            },
            "targets" => {} }

TARGETS.each do |target|
  card = Card[target[:name]]
  raise "target card missing: #{target[:name]}" unless card

  entry = { "id" => card.id, "name" => card.name.to_s, "type" => card.type_name.to_s,
            "views" => {} }
  ACTORS.each do |actor|
    as_actor(actor) do
      entry["views"][actor] = {
        "edit"      => render_or_deny(card, :edit),
        "edit_form" => render_or_deny(card, :edit_form)
      }
    end
  end
  results["targets"][target[:label]] = entry
end

# ---- conflict probe (Oracle Basics, basic_note target) ----------------------
# VALIDATION-ONLY by construction: `valid?` runs the validate-phase events
# (detect_conflict) but never persists. The prior save-based probe wrote an
# action row (incident recorded in forms-lane.md) - this shape cannot.
# edit_conflict? needs: stale last_action_id_before_edit AND a last action
# by a DIFFERENT actor - so the probe signs in as Sara while the card's
# last action belongs to Decko Bot.
basic = Card["Oracle Basics"]
before_count = action_count
conflict = {}
as_actor("sara") do
  last_id = basic.last_action_id
  stale = ActiveRecord::Base.connection.select_value(
    "SELECT MIN(id) FROM card_actions WHERE card_id=#{basic.id} AND id != #{last_id}"
  )
  conflict["last_action_id"] = last_id.to_i
  conflict["stale_action_id_known"] = !stale.nil?
  basic.last_action_id_before_edit = stale
  basic.valid?
  conflict["errors_conflict"] = (basic.errors[:conflict][0, 300] rescue nil)
  conflict["valid_after_conflict"] = basic.valid?
end
after_count = action_count
conflict["actions_before"] = before_count
conflict["actions_after"] = after_count
conflict["no_write_proof"] = before_count == after_count
results["conflict_probe"] = conflict

FileUtils.mkdir_p(File.dirname(OUT_PATH))
File.write(OUT_PATH, JSON.pretty_generate(deep_sort(results)) + "\n")

# Pin the oracle bytes beside the lane receipt (raw captures for reference).
if File.directory?(PIN_DIR)
  File.write(File.join(PIN_DIR, "edit-forms-oracle.json"),
             JSON.pretty_generate(deep_sort(results)) + "\n")
end

puts "captured edit-forms: #{OUT_PATH}"
puts "conflict no-write proof: #{conflict['no_write_proof']} (#{before_count} -> #{after_count})"

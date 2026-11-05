
require "json"

REPO_ROOT = File.expand_path("../../..", __dir__)
OUT_PATH  = File.join(REPO_ROOT, "fixtures", "captured", "edit-forms.json")
PIN_DIR   = "./tmp/captures-auth-forms"

TARGETS = [
  { name: "Oracle Basics", label: "basic_note" },
  { name: "Home",          label: "deck_level" }
].freeze
ACTORS = %w[bot sara anonymous].freeze

SLOT_ID_RE   = /data-slot-id=(["'])\h+\1/.freeze
CARD_ID_RE   = /data-card-id=(["'])\d+\1/.freeze
SELECT2_ID_RE = /data-select2-id=(["'])([^"']*)-\d+\1/.freeze
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

if File.directory?(PIN_DIR)
  File.write(File.join(PIN_DIR, "edit-forms-oracle.json"),
             JSON.pretty_generate(deep_sort(results)) + "\n")
end

puts "captured edit-forms: #{OUT_PATH}"
puts "conflict no-write proof: #{conflict['no_write_proof']} (#{before_count} -> #{after_count})"

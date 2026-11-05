
require "json"

REPO_ROOT = File.expand_path("../../..", __dir__)
OUT_PATH  = File.join(REPO_ROOT, "fixtures", "captured", "bootstrap-views.json")

ITEM1 = "Oracle Carousel Item One"
ITEM2 = "Oracle Carousel Item Two"
ITEM3 = "Oracle Carousel Item Three"

PROBE_CAROUSEL = "Oracle Carousel Probe"

PROBE_SKIN = "Oracle Customize Skin Probe"

PROBE_SKIN_SET = "#{PROBE_SKIN}+*self"

SEEDS = [
  { name: ITEM1, type: "RichText", content: "item one body" },
  { name: ITEM2, type: "RichText", content: "item two body" },
  { name: ITEM3, type: "RichText", content: "item three body" },
  { name: PROBE_CAROUSEL, type: "List",
    content: "#{ITEM1}\n#{ITEM2}\n#{ITEM3}" },
  { name: PROBE_SKIN, type: "bootswatch_skin", content: "skin css body" }
].freeze

RENDER_TARGETS = {
  PROBE_CAROUSEL => %i[carousel],
  PROBE_SKIN     => %i[customize_button]
}.freeze

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

Card::Auth.as_bot do
  SEEDS.each { |attrs| seed_log[attrs[:name]] = seed_card(attrs) }
end

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

File.write(OUT_PATH, JSON.pretty_generate(deep_sort(payload)) + "\n")
puts "seed_log: #{JSON.generate(deep_sort(seed_log))}"
puts "WROTE #{OUT_PATH} (#{File.size(OUT_PATH)} bytes)"
$stdout.flush
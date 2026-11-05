# oracle-capture-content-inputs.rb - oracle capture for the card-mod-content
# abstract :input views: Abstract::CodeContent (set/abstract/01_code_content.rb:2-5),
# Abstract::HamlFile (set/abstract/haml_file.rb:11-14), Abstract::ReadOnly
# (set/abstract/read_only.rb:1-4).
#
# Run (from tools/oracle/decko-oracle-app):
#   RAILS_ENV=development bundle exec decko runner \
#     C:/localProjects/decko-ts/tests/card/mod-loader/oracle-capture-content-inputs.rb
#
# Records to fixtures/captured/content-inputs.json:
# 1. mod load order Cardio::Mod::Dirs assembled (the deck's card mods that
#    loaded + their index, so the TS A/B test can confirm the same mod
#    set is on the load order - card-mod-content registers itself in the
#    basket of abstract set modules).
# 2. the set-module view registrations card-mod-content contributed for
#    :input (with source locations proving which abstract file defined
#    each - the live "which module registered :input" registry state).
# 3. the superView chain resolution for :input given an EMPTY cardChain
#    (the abstract pseudo-pattern is anchorless - no concrete pattern
#    instance matches, so the walker falls back to load-order
#    registration; confirms the chain order is CodeContent -> HamlFile
#    -> ReadOnly).
# 4. the rendered :input bytes for each abstract set's HtmlFormat module
#    rendering :input DIRECTLY against that module's format singleton
#    (bypassing super()/reopening - the per-set-module literal body).
# 5. the rendered :input bytes for a real card walked through the
#    Abstract pseudo-pattern chain (terminal = ReadOnly's literal, the
#    end-state Ruby reaches at the format module's view_method after the
#    chain's last reopening).
#
# Determinism contract (mirrors oracle-capture-help-mod.rb): output JSON is
# pretty-printed with deeply sorted keys + trailing newline; the random
# data-slot-id attribute is normalized to a placeholder; probe seed cards
# are created-if-missing and DELETED (trashed) after capture so the shared
# oracle DB returns to its prior state (a re-run of capture.rb stays
# byte-stable).

require "json"

REPO_ROOT = File.expand_path("../../..", __dir__)
OUT_PATH  = File.join(REPO_ROOT, "fixtures", "captured", "content-inputs.json")

# Abstract::CodeContent applies to every card via the abstract pseudo-pattern
# (the abstract set is anchorless); for the capture we render :input scoped
# directly to each abstract set's HtmlFormat module + once through a real
# card's format to prove the chain terminal.
PROBE_FILE_CODE  = "Oracle Content File Probe"
PROBE_HAML       = "Oracle Content Haml Probe"
PROBE_READ_ONLY  = "Oracle Content ReadOnly Probe"

SEEDS = [
  { name: PROBE_FILE_CODE, type: "RichText", content: "file content probe body" },
  { name: PROBE_HAML,      type: "RichText", content: "haml content probe body" },
  { name: PROBE_READ_ONLY, type: "RichText", content: "read-only content probe body" }
].freeze

SLOT_ID_RE = /data-slot-id=(["'])\h+\1/.freeze
# The probe cards are created fresh and trashed after each capture, so their
# row ids (and with them data-card-id) advance every run - seed state, not
# mod semantics. Normalized like the slot id; the TS test applies the same
# normalization to its own renders before comparing.
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

def source_location_of(format_mod, method)
  return nil unless format_mod.respond_to?(:instance_method)

  format_mod.instance_method(method).source_location
rescue StandardError
  nil
end

payload = {}
seed_log = {}

# ---- seed (create-if-missing; removed again after capture) ------------------
Card::Auth.as_bot do
  SEEDS.each { |attrs| seed_log[attrs[:name]] = seed_card(attrs) }
end

# ---- mod load order ---------------------------------------------------------
payload["mods"] = Cardio::Mod.dirs.mods.map do |mod|
  { "name" => mod.name, "group" => mod.group.to_s, "index" => mod.index }
end

# ---- set-module view registrations ------------------------------------------
# Three abstract set modules define :input on their respective HtmlFormat
# modules (format :html do block in each abstract file). Recording
# presence + source_location proves which file contributed each :input -
# the byte oracle pin linking the live render to the gem file.
abstract_code_content_html = Card::Set::Abstract::CodeContent.const_get(:HtmlFormat)
abstract_haml_file_html    = Card::Set::Abstract::HamlFile.const_get(:HtmlFormat)
abstract_read_only_html    = Card::Set::Abstract::ReadOnly.const_get(:HtmlFormat)

payload["registered_views"] = {
  "abstract_code_content_view_input" => {
    "defined" => abstract_code_content_html.method_defined?(:_view_input),
    "source_location" => source_location_of(abstract_code_content_html, :_view_input)
  },
  "abstract_haml_file_view_input" => {
    "defined" => abstract_haml_file_html.method_defined?(:_view_input),
    "source_location" => source_location_of(abstract_haml_file_html, :_view_input)
  },
  "abstract_read_only_view_input" => {
    "defined" => abstract_read_only_html.method_defined?(:_view_input),
    "source_location" => source_location_of(abstract_read_only_html, :_view_input)
  }
}

# ---- per-set-module :input body (the literal each abstract file returns)
# ---------------------------------------------------------------------------
# Ruby's view DSL stores each `view :input do ... end` block as a Proc on
# the set module's HtmlFormat module (view_definition.rb:18-21 sets
# `views[self][view] = block` and define_method attaches the same proc
# to `_view_<view>`). Calling the proc returns the body of the view block
# verbatim - the bytes the abstract set module contributes to the chain.
#
# These are the three pin literals the TS port's superView chain
# terminal test asserts:
#
#   Abstract::CodeContent (01_code_content.rb:2-5) -> "Content is stored in file and can't be edited."
#   Abstract::HamlFile    (haml_file.rb:11-14)     -> "Content is managed by code and cannot be edited"
#   Abstract::ReadOnly    (read_only.rb:1-4)       -> "Content can't be edited."
#
# (the HtmlFormat modules are MODULES, not CLASSES - calling
# `Module.new(card)` is illegal; the proc is fetched via
# `mod.views[mod][:input]` and evaluated in isolation. The view bodies
# for these three abstracts are bare string literals, so proc.call
# returns the literal without needing a real Card instance.)
def per_module_input_literal(mod)
  proc = mod.views[mod][:input]
  proc.call
end

per_module_input = {
  "Abstract::CodeContent::HtmlFormat" => per_module_input_literal(abstract_code_content_html),
  "Abstract::HamlFile::HtmlFormat"    => per_module_input_literal(abstract_haml_file_html),
  "Abstract::ReadOnly::HtmlFormat"    => per_module_input_literal(abstract_read_only_html)
}
payload["per_module_input"] = per_module_input

# ---- rendered probe views (full Card::Format::HtmlFormat#render chain) ------
# Each probe card's regular format#render(:input) walks the format's full
# method-resolution order. The :input view is reopened by all three
# abstract set modules; the LAST reopening wins at the format module
# level. Path-sort (01_code_content < haml_file < read_only) puts
# ReadOnly last, so the live render returns ReadOnly's literal
# ("Content can't be edited.") for EVERY probe - the chain terminal the
# TS test asserts for "Oracle Code Probe".
views = {}
[PROBE_FILE_CODE, PROBE_HAML, PROBE_READ_ONLY].each do |name|
  card = Card.fetch(name)
  format = card.format
  begin
    views["#{name}#input"] = normalize(format.render(:input))
  rescue StandardError => e
    views["#{name}#input"] = "CAPTURE_ERROR: #{e.class}: #{e.message}"
  end
end
payload["rendered"] = views

# ---- cleanup: trash the probe cards so the shared DB stays untouched --------
Card::Auth.as_bot do
  [PROBE_FILE_CODE, PROBE_HAML, PROBE_READ_ONLY].each do |name|
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
# oracle data. Everything this fixture records is order/registry/render
# state the mod loader must reproduce.

# ---- write ------------------------------------------------------------------
File.write(OUT_PATH, JSON.pretty_generate(deep_sort(payload)) + "\n")
puts "seed_log: #{JSON.generate(deep_sort(seed_log))}"
puts "WROTE #{OUT_PATH} (#{File.size(OUT_PATH)} bytes)"
$stdout.flush

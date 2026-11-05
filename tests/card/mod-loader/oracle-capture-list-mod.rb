
require "json"

REPO_ROOT = File.expand_path("../../..", __dir__)
OUT_PATH  = File.join(REPO_ROOT, "fixtures", "captured", "list-mod-loader.json")

CHILD = "Oracle Probe Child"

PROBE_LIST    = "Oracle List Probe"      # type List
PROBE_POINTER = "Oracle Pointer Probe"   # type Pointer
PROBE_RADIO   = "Oracle Radio Probe"     # type Pointer + *input_type rule + *content_options rule
PROBE_NEST    = "Oracle Nest List Probe" # type Nest list
PROBE_LINK    = "Oracle Link List Probe" # type Link list

SEEDS = [
  { name: CHILD, type: "RichText", content: "probe item body" },
  { name: PROBE_LIST, type: "List",
    content: "#{CHILD}\nOracle Probe Wanted" },
  { name: PROBE_POINTER, type: "Pointer",
    content: "#{CHILD}\nSecond Item" },
  { name: PROBE_RADIO, type: "Pointer", content: "Option One" },
  { name: "#{PROBE_RADIO}+*self+*input_type", content: "radio" },
  { name: "#{PROBE_RADIO}+*self+*content_options", type: "List",
    content: "Option One\nOption Two" },
  { name: PROBE_NEST, type: "Nest list",
    content: "{{#{CHILD}|title:nested title}}\n{{Second Item}}" },
  { name: PROBE_LINK, type: "Link list",
    content: "[[#{CHILD}|link title]]\n[[Second Item]]" }
].freeze

RENDER_TARGETS = {
  PROBE_LIST    => %i[one_line_content view_list input list content core],
  PROBE_POINTER => %i[one_line_content view_list input list content core],
  PROBE_RADIO   => %i[input one_line_content],
  PROBE_NEST    => %i[nest_list_input input list one_line_content],
  PROBE_LINK    => %i[input list one_line_content]
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

def source_location_of(format_mod, method)
  return nil unless format_mod.respond_to?(:instance_method)

  format_mod.instance_method(method).source_location
rescue StandardError
  nil
end

payload = {}
seed_log = {}

Card::Auth.as_bot do
  SEEDS.each { |attrs| seed_log[attrs[:name]] = seed_card(attrs) }
end

payload["mods"] = Cardio::Mod.dirs.mods.map do |mod|
  { "name" => mod.name, "group" => mod.group.to_s, "index" => mod.index }
end

payload["pattern_codes"] = Card::Set::Pattern.concrete.map { |p| p.pattern_code.to_s }
payload["grouped_codes"] = Card::Set::Pattern.grouped_codes.map { |g| g.map(&:to_s) }

payload["setting_groups"] = Card::Setting.groups.transform_values do |sets|
  sets.map { |s| s.codename&.to_s }
end
payload["setting_preferences"] = Card::Setting.preferences.map(&:to_s).sort

def setting_state(setting_mod)
  {
    "codename" => setting_mod.codename.to_s,
    "group" => Card::Setting.groups.find { |_, sets| sets.include?(setting_mod) }&.first.to_s,
    "rule_type_editable" => setting_mod.rule_type_editable,
    "short_help_text" => (setting_mod.short_help_text if setting_mod.respond_to?(:short_help_text)),
    "raw_help_text" => (setting_mod.raw_help_text if setting_mod.respond_to?(:raw_help_text)),
    "restricted_to_type" =>
      (setting_mod.restricted_to_type.map(&:to_s) if setting_mod.respond_to?(:restricted_to_type))
  }.compact
end

payload["setting_opts_content_options"] =
  setting_state(Card::Set::Self::ContentOptions)
payload["setting_opts_content_option_view"] =
  setting_state(Card::Set::Self::ContentOptionView)

payload["list_input_options_basket"] =
  begin
    Card::Set.basket[:list_input_options]&.map(&:to_s)
  rescue StandardError => e
    "CAPTURE_ERROR: #{e.class}: #{e.message}"
  end

abstract_list_html = Card::Set::Abstract::List.const_get(:HtmlFormat)
nest_list_html = Card::Set::Type::NestList.const_get(:HtmlFormat)
payload["registered_views"] = {
  "abstract_list_html_view_view_list" => {
    "defined" => abstract_list_html.method_defined?(:_view_view_list),
    "source_location" => source_location_of(abstract_list_html, :_view_view_list)
  },
  "nest_list_html_view_nest_list_input" => {
    "defined" => nest_list_html.method_defined?(:_view_nest_list_input),
    "source_location" => source_location_of(nest_list_html, :_view_nest_list_input)
  }
}

probe_format_class = Card.fetch(PROBE_POINTER).format.class
payload["probe_format_configs"] = %w[
  _view_input__unknown
  _view_input__cache
  _view_list__cache
  _view_one_line_content__unknown
  _view_one_line_content__wrap
  _view_view_list__unknown
  _view_core__unknown
].to_h do |method|
  [method, probe_format_class.method_defined?(method)]
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
    "#{PROBE_RADIO}+*self+*input_type",
    "#{PROBE_RADIO}+*self+*content_options",
    "#{PROBE_RADIO}+*self",
    "#{PROBE_LIST}+*self",
    "#{PROBE_POINTER}+*self",
    "#{PROBE_NEST}+*self",
    "#{PROBE_LINK}+*self",
    PROBE_RADIO,
    PROBE_LIST,
    PROBE_POINTER,
    PROBE_NEST,
    PROBE_LINK,
    CHILD
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

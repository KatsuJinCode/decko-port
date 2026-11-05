# A compatibility shim of the Card set-module DSL, evaluated inside CRuby
# compiled to WebAssembly (ruby.wasm). It lets an unported card-mod's
# set/**/*.rb files load unmodified and register their views and events into
# the TypeScript engine's mod loader (src/card/mod-loader).
#
# Shape follows card-1.110.0:
# - Each set file is evaluated into its own module, the way
#   Cardio::Mod::Loader::SetLoader wraps a file with set_template.rb.
# - `format :html do ... end` opens a format module (lib/card/set/format.rb);
#   `def` inside it defines format helpers, `view` registers a view.
# - Top-level `def` in a set file defines card methods (the set module is
#   included into the card).
# - `event` registers an event (lib/card/set/event.rb); its block runs with the
#   card as self.
# - `card_accessor` / `accessor` define field readers (lib/card/set/
#   advanced_api.rb, card-mod-... set/abstract accessor helpers).
#
# Everything the engine owns (rendering other views, card data) is reached
# through the JavaScript bridge object `__deckoRubyBridge`.

require "js"
require "erb"
require "date"

module DeckoRubyMods
  BRIDGE_NAME = :__deckoRubyBridge

  VIEW_SETTINGS = %i[unknown perms cache wrap denial].freeze

  class << self
    def bridge
      JS.global[BRIDGE_NAME]
    end

    def set_modules
      @set_modules ||= []
    end

    # Evaluate one set file (its path relative to set/, e.g. "all/greeting.rb")
    # into a fresh set module and return its index.
    def load_set_file(set_path, source)
      mod = SetModule.build(set_path)
      if (m = set_path.match(%r{\Aabstract/(.+)\.rb\z}))
        abstract_sets[camelize(m[1])] = mod
      end
      mod.module_eval(source, "set/#{set_path}", 1)
      set_modules << mod
      set_modules.size - 1
    end

    def camelize(path)
      path.split("/").map { |seg| seg.sub(/\A\d+_/, "").split("_").map(&:capitalize).join }.join("::")
    end

    # The registrations of one set module, as JSON for the TypeScript side.
    def registrations(index)
      mod = set_modules.fetch(index)
      {
        set_path: mod.set_path,
        views: mod.view_specs,
        events: mod.event_specs.map { |e| e.reject { |k, _| k == :block || k == :when_cond } },
        accessors: mod.accessor_names,
        setting_opts: mod.setting_opts_spec,
      }.to_json_for_bridge
    end

    def render_view(index, format, view)
      mod = set_modules.fetch(index)
      fmt = FormatProxy.new(mod, format)
      fmt.render_registered(view).to_s
    end

    # set/event/all.rb#when_condition_applies?, asked by the dispatcher
    # before the event is counted as firing.
    def event_condition(index, event_index)
      mod = set_modules.fetch(index)
      spec = mod.event_specs.fetch(event_index)
      CardProxy.for_current(mod).event_condition_applies?(spec[:when_cond]) ? "true" : "false"
    end

    def run_event(index, event_index)
      mod = set_modules.fetch(index)
      spec = mod.event_specs.fetch(event_index)
      CardProxy.for_current(mod).instance_exec(&spec[:block])
      "fired"
    end

    # Abstract set modules by name (Card::Set::Abstract::X). A mod's own
    # set/abstract/x.rb files are loaded first and registered here; a name
    # no loaded mod defines answers an empty stand-in, recorded so the
    # loader can report it.
    def abstract_sets
      @abstract_sets ||= {}
    end

    def missing_abstracts
      @missing_abstracts ||= []
    end
  end

  # Minimal JSON writer: ruby.wasm's stdlib carries json, but keeping the
  # shim's output independent of it keeps the boot small.
  module JsonOut
    def self.dump(obj)
      case obj
      when Hash then "{" + obj.map { |k, v| dump(k.to_s) + ":" + dump(v) }.join(",") + "}"
      when Array then "[" + obj.map { |v| dump(v) }.join(",") + "]"
      when String then "\"" + obj.gsub(/["\\\u0000-\u001f]/) { |c| format("\\u%04x", c.ord) } + "\""
      when Symbol then dump(obj.to_s)
      when nil then "null"
      when true, false, Integer, Float then obj.to_s
      else dump(obj.to_s)
      end
    end
  end

  module ::Kernel
    def to_json_for_bridge
      DeckoRubyMods::JsonOut.dump(self)
    end
  end

  # The module a set file is evaluated into.
  module SetModule
    attr_reader :set_path, :view_specs, :event_specs, :accessor_names,
                :format_modules, :view_blocks

    def self.build(set_path)
      mod = Module.new
      mod.extend SetModule
      mod.instance_variable_set :@set_path, set_path.sub(/\.rb\z/, "")
      mod.instance_variable_set :@view_specs, []
      mod.instance_variable_set :@event_specs, []
      mod.instance_variable_set :@accessor_names, []
      mod.instance_variable_set :@format_modules, {}
      mod.instance_variable_set :@view_blocks, {}
      mod
    end

    # lib/card/set/format.rb#format: `format` with no names is the base
    # format, whose views every format inherits.
    def format(*formats, &block)
      formats = [:base] if formats.empty?
      formats.each do |f|
        fmod = (format_modules[f.to_sym] ||= FormatModule.build(self, f.to_sym))
        fmod.module_eval(&block) if block
      end
    end

    # lib/card/set/event.rb#event: event name, stage, opts.
    def event(name, stage_or_opts = {}, opts = {}, &block)
      if stage_or_opts.is_a?(Hash)
        opts = stage_or_opts
      else
        opts = opts.merge(stage_or_opts.to_sym => true)
      end
      stage = %i[initialize prepare_to_validate validate prepare_to_store store finalize
                 integrate after_integrate integrate_with_delay].find { |s| opts.key?(s) }
      on = Array(opts[:on]).map(&:to_s)
      event_specs << {
        event: name.to_s,
        at: stage&.to_s,
        on: on.empty? ? nil : on,
        changed: opts[:changed] && Array(opts[:changed]).map(&:to_s),
        when: opts[:when].is_a?(Symbol) ? opts[:when].to_s : (opts[:when] ? "<proc>" : nil),
        when_cond: opts[:when],
        block: block,
      }
    end

    # card_accessor :x / accessor :x - the field-card reader pair.
    def card_accessor(*names, **_opts)
      names.each do |n|
        accessor_names << n.to_s
        define_method("#{n}_card") { field_card(n) }
        define_method(n) { field_card(n).content }
      end
    end
    alias accessor card_accessor

    # Declarations the shim accepts and records but does not act on.
    def assign_type(*); end
    def add_to_basket(*); end

    # lib/card/set/advanced_api.rb#include_set: the included set's card
    # methods, format helpers and views become this set's own; views this
    # set defines itself (before or after) take precedence.
    def include_set(set, *_opts)
      return unless set.is_a?(Module) && set.singleton_class.include?(SetModule)

      include set
      set.format_modules.each do |f, fmod|
        (format_modules[f] ||= FormatModule.build(self, f)).include fmod
      end
      set.view_blocks.each do |k, block|
        next if view_blocks.key?(k)

        view_blocks[k] = block
        spec = set.view_specs.find { |s| s[:format] == k[0].to_s && s[:view] == k[1].to_s }
        view_specs << spec if spec
      end
    end

    # advanced_api.rb#setting_opts: handed to the loader's setting registry.
    def setting_opts(**opts)
      @setting_opts = opts.transform_values do |v|
        v.is_a?(Array) ? v.map(&:to_s) : (v.is_a?(Symbol) ? v.to_s : v)
      end
    end

    def setting_opts_spec
      @setting_opts
    end

    # Card::Set basket (lib/card/set/basket.rb): recorded, not acted on.
    def basket
      @basket ||= Hash.new { |h, k| h[k] = [] }
    end

    # ActiveSupport's Module#delegate, which set files use for card methods.
    def delegate(*methods, to:, **_opts)
      methods.each do |m|
        define_method(m) { |*a, &b| send(to).send(m, *a, &b) }
      end
    end
  end

  module FormatModule
    attr_reader :set_module, :format_name

    def self.build(set_module, format_name)
      fmod = Module.new
      fmod.extend FormatModule
      fmod.instance_variable_set :@set_module, set_module
      fmod.instance_variable_set :@format_name, format_name
      fmod
    end

    # lib/card/set/format/abstract_format.rb#view: `view :name, opts, &block`
    # or `view :name, :other_view` (an alias).
    def view(name, *args, &block)
      opts = args.last.is_a?(Hash) ? args.pop : {}
      alias_to = args.first
      config = {}
      VIEW_SETTINGS.each do |k|
        next unless opts.key?(k)
        v = opts[k]
        config[k] = v.is_a?(Symbol) ? v.to_s : v
      end
      if alias_to && !block
        # abstract_format.rb#alias_block binds the aliased view from the
        # DEFINING set module, not the card's most specific one.
        sm = set_module
        fname = format_name
        target = alias_to.to_sym
        block = proc do
          instance_exec(&(sm.view_blocks[[fname, target]] || sm.view_blocks[[:base, target]]))
        end
      end
      block ||= proc { "" }
      set_module.view_blocks[[format_name, name.to_sym]] = block
      set_module.view_specs.reject! { |s| s[:format] == format_name.to_s && s[:view] == name.to_s }
      set_module.view_specs << { format: format_name.to_s, view: name.to_s, config: config }
    end

    def before(*); end
    def wrapper(*); end

    def delegate(*methods, to:, **_opts)
      methods.each do |m|
        define_method(m) { |*a, &b| send(to).send(m, *a, &b) }
      end
    end
  end

  # The format object a view block runs on (`self` in a view body).
  class FormatProxy
    include ERB::Util

    def initialize(set_module, format_name)
      @set_module = set_module
      @format_name = format_name.to_sym
      [:base, @format_name].uniq.each do |f|
        fmod = set_module.format_modules[f]
        extend fmod if fmod
      end
    end

    def render_registered(view)
      block = @set_module.view_blocks[[@format_name, view.to_sym]] ||
              @set_module.view_blocks[[:base, view.to_sym]]
      raise "no view #{view} in #{@set_module.set_path}" unless block

      result = instance_exec(&block)
      result.is_a?(Array) ? output(result) : result
    end

    def card
      @card ||= CardProxy.for_current(@set_module)
    end

    # format/render.rb#render: hands the view back to the engine, so views the
    # port already implements (core, titled, link, ...) render with its bytes.
    def render(view, _opts = {})
      DeckoRubyMods.bridge.call(:renderView, view.to_s).to_s
    end
    alias _render render

    def method_missing(name, *args, &block)
      if (m = name.to_s.match(/\A_?(?:optional_)?render_(.+)\z/))
        render(m[1], *args)
      else
        super
      end
    end

    def respond_to_missing?(name, priv = false)
      name.to_s.match?(/\A_?(?:optional_)?render_/) || super
    end

    # format/content.rb#output.
    def output(*content)
      content = yield if block_given?
      Array(content).flatten.compact.join("\n")
    end

    # card-mod-format set/all/html/wrap.rb#wrap_with.
    def wrap_with(tag, content_or_args = {}, html_args = {}, &block)
      tag_args = block ? content_or_args : html_args
      inner = block ? output(instance_exec(&block)) : output(content_or_args)
      content_tag(tag, inner, tag_args)
    end

    # ActionView's content_tag, with the attribute escaping of tag_options.
    def content_tag(tag, content = nil, attrs = {}, &block)
      if content.is_a?(Hash)
        attrs = content
        content = nil
      end
      content = output(instance_exec(&block)) if block
      attr_s = attrs.map do |k, v|
        v = v.join(" ") if v.is_a?(Array)
        next if v.nil?
        " #{k}=\"#{html_escape(v.to_s)}\""
      end.join
      "<#{tag}#{attr_s}>#{content}</#{tag}>"
    end

    alias h html_escape

    # format/nest.rb#nest: hands the nest to the engine's own nest path.
    def nest(cardish, opts = {})
      name = cardish.respond_to?(:name) ? cardish.name.to_s : cardish.to_s
      opts = opts.transform_keys(&:to_s).transform_values { |v| v.is_a?(Array) ? v.join(" ") : v.to_s }
      DeckoRubyMods.bridge.call(:nest, name, opts.to_json_for_bridge).to_s
    end

    # card-mod-format set/all/html/link.rb#link_to_card (text and class
    # only; path options are not passed through).
    def link_to_card(cardish, text = nil, opts = {})
      name = cardish.respond_to?(:name) ? cardish.name.to_s : cardish.to_s
      DeckoRubyMods.bridge.call(:linkToCard, name, text.nil? ? "" : text.to_s, text.nil? ? "0" : "1",
                                opts.transform_keys(&:to_s).to_json_for_bridge).to_s
    end

    # Translation with the default only: no locale files are loaded.
    def t(key, default: nil, **_opts)
      raise "I18n key #{key} has no default; locale files are not loaded" if default.nil?

      default.to_s
    end
  end

  # The card a view or event sees (`card` in a view, `self` in an event).
  class CardProxy
    def self.for_current(set_module)
      proxy = new(nil)
      proxy.extend set_module
      proxy
    end

    def initialize(name)
      @name = name
    end

    def bridge
      DeckoRubyMods.bridge
    end

    def name
      @name || bridge.call(:cardName).to_s
    end

    def key
      bridge.call(:cardKey, name).to_s
    end

    def type_name
      bridge.call(:typeName, name).to_s
    end

    def id
      v = bridge.call(:cardId, name).to_s
      v.empty? ? nil : v.to_i
    end

    def content
      bridge.call(:content, @name || "").to_s
    end
    alias db_content content

    def content=(value)
      bridge.call(:setContent, value.to_s)
    end
    alias db_content= content=

    def action
      v = bridge.call(:action).to_s
      v.empty? ? nil : v.to_sym
    end

    def new?
      action == :create
    end
    alias new_card? new?

    def real?
      !id.nil?
    end

    def field_card(field)
      CardProxy.new("#{name}+#{field}")
    end

    def event_condition_applies?(cond)
      case cond
      when nil then true
      when Symbol then send(cond) ? true : false
      when Proc then cond.arity.zero? ? instance_exec(&cond) : cond.call(self)
      else true
      end
    end
  end
end

# Abstract set modules (Card::Set::Abstract::X), resolved by name.
module ::Abstract
  def self.const_missing(name)
    DeckoRubyMods.abstract_sets[name.to_s] ||= begin
      DeckoRubyMods.missing_abstracts << name.to_s
      DeckoRubyMods::SetModule.build("abstract/#{name}")
    end
  end
end

# Card.fetch for set code: answers a card proxy when the engine has the card
# seated for this render, nil otherwise.
class ::Card
  def self.fetch(cardish, *_args)
    name = cardish.respond_to?(:name) ? cardish.name.to_s : cardish.to_s
    return nil if DeckoRubyMods.bridge.call(:cardExists, name).to_s != "1"

    DeckoRubyMods::CardProxy.new(name)
  end

  def self.search(*)
    raise NotImplementedError, "Card.search is asynchronous in the port and is not bridged"
  end
end

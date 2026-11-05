# Finite source-pinned core-read invocation binding. Stored identity alone
# never substitutes for the actual render, permission gate and dispatch.
require "digest"
module NativeReadControlBinding
  class Refused < RuntimeError; end

  PINS = {
    controller: "e7bfa0708ae57dc7165f300f32744b68a5765252bb6f5c9ffd193f02686e7a24",
    response: "6986803d853960f299cd6176cc22806d30ac09ff9530e232b09daeed7163e8c4",
    errors: "0f54030536075fc5d6813cdd86fa4f2716c6c2991bbda8408c121b2253b5ab07",
    format: "a7397ed5bc27b99025f4bdeaeeea42490235345af1e4f4392a78bce315f73013",
    permission: "f3c3e35853b782398aa9a8cc2d2a1210b40af8cb4cf38245b11861e6199bde43",
    format_error: "5955467cba7559da9bf9022d008fccdfc47d239826286dd844a4b11806f161db",
    view: "7a70068ce0bc2c1a459a7c3ec06d62e8628708741ee748c2723cc78b23df2a55",
    render: "fa4dc437c1d576d1bfffaa2f64fa31847c708ef5f7cc9c9c09a3462004167e0c",
    states: "f8d541bf8a01a750080bb9905edb2212a65f7611aa3707ac5aa05369b29de29f",
    proxy: "aec8414795f742c01b6db1fadc88b8004cc83f08fec0161fd206f6b123e0e05e"
  }.transform_values(&:freeze).freeze

  def self.identity(controller, expected_id)
    raise Refused, "restoration-control-id-invalid" unless expected_id.is_a?(Integer) && expected_id.positive?
    raise Refused, "restoration-controller-card-missing" unless controller.respond_to?(:card) && controller.card
    raise Refused, "restoration-controller-format-missing" unless controller.respond_to?(:format) && controller.format
    card, format = controller.card, controller.format
    raise Refused, "restoration-render-card-missing" unless format.respond_to?(:card) && format.card
    render_card = format.card
    [card, render_card].each do |actual|
      raise Refused, "restoration-native-card-id-invalid" unless actual.respond_to?(:id) && actual.id.is_a?(Integer) && actual.id.positive?
      raise Refused, "restoration-native-card-id-mismatch" unless actual.id == expected_id
    end
    # The witnessed load_format path obtains the format from this card and
    # Format#initialize retains that receiver. A replacement is not chosen
    # merely because it happens to carry an equal integer ID.
    raise Refused, "restoration-render-card-replaced" unless card.equal?(render_card)
    { new_record?: false, new_card?: false, trash?: false, virtual?: false, real?: true, known?: true }.each do |name, expected|
      raise Refused, "restoration-native-persistence-unqualified" unless card.respond_to?(name) && card.public_send(name).equal?(expected)
    end
    rows = Card.connection.raw_connection.execute("SELECT id,trash FROM cards WHERE id=?", [expected_id])
    raise Refused, "restoration-stored-card-missing" unless rows.length == 1
    row = rows.first
    stored_id, trash = row.is_a?(Hash) ? [row["id"], row["trash"]] : [row[0], row[1]]
    raise Refused, "restoration-stored-card-invalid" unless stored_id == expected_id && trash == 0
    { card: card, format: format, id: expected_id }
  end

  def self.qualified_identity(controller, expected_id)
    result = identity(controller, expected_id)
    %i[new_card? virtual? real? known?].each do |name|
      method = result[:card].method(name)
      location = method.source_location
      original_name = name == :new_card? ? :new? : name
      raise Refused, "restoration-native-state-source-unqualified" unless method.respond_to?(:original_name) && method.original_name == original_name && location && File.file?(location[0]) && Digest::SHA256.file(location[0]).hexdigest == PINS[:states]
    end
    result
  end

  # An invocation is constructed only by installed Ruby wrappers, never by
  # receipt JSON. Every event retains actual receiver identity and call scope.
  class Invocation
    attr_reader :controller, :control, :card, :format

    def initialize(controller, control, action)
      @controller, @control, @thread = controller, control, Thread.current
      @request = controller.request
      # Zero denial is emitted evidence, not merely a missing-key lookup default.
      @events, @depth = Hash.new(0).merge(denial: 0), Hash.new(0)
      @invalid = nil
      refuse("route") unless action.to_s == "read" && @request.request_method == "GET"
      @parameters = read_parameters
    end

    def read_parameters
      params = controller.params
      allowed = %w[controller action mark id view v format layout]
      refuse("parameters") unless params.keys.all? { |key| allowed.include?(key.to_s) }
      fetch = ->(key) { params[key.to_sym] || params[key] }
      refuse("route") unless fetch.call("action").to_s == "read" && fetch.call("controller").to_s == "card"
      refuse("view") unless [fetch.call("view"), fetch.call("v")].compact.any? && [fetch.call("view"), fetch.call("v")].compact.all? { |value| value.to_s == "core" }
      refuse("format") unless fetch.call("format").to_s == "html" && fetch.call("layout").to_s == "none"
      allowed.to_h do |key|
        value = fetch.call(key)
        refuse("parameter-shape") unless value.nil? || value.is_a?(String) || value.is_a?(Symbol) || value.is_a?(Integer)
        [key, value.is_a?(String) ? value.dup.freeze : value.is_a?(Symbol) ? value.to_s.freeze : value]
      end.reject { |_, value| value.nil? }.freeze
    end

    def refuse(reason)
      @invalid ||= reason
      raise Refused, "restoration-native-read-#{reason}"
    end

    def context!
      refuse("context") unless Thread.current.equal?(@thread) && @controller.request.equal?(@request) && @request.request_method == "GET" && @request.path == @control.fetch("path")
      refuse("parameters-changed") unless read_parameters == @parameters
      actor = Card::Auth.current_id
      refuse("actor") unless actor == @control.fetch("actorId") && Card::Auth.as_id == actor
      refuse("actor-role") unless actor != Card::AnonymousID && actor != Card::DeckoBotID && !!Card::Auth.always_ok? == (@control.fetch("role") == "admin")
    end

    def once(name)
      @events[name] += 1
      refuse("repeated-#{name}") unless @events[name] == 1
    end

    def scope(name)
      @depth[name] += 1
      yield
    ensure
      @depth[name] -= 1
    end

    def active?(name) = @depth[name].positive?
    def invalid? = !@invalid.nil?
    def invalidate(reason) = @invalid ||= reason

    def identity!
      current = NativeReadControlBinding.qualified_identity(@controller, @control.fetch("cardId"))
      if @card
        refuse("replaced") unless @card.equal?(current[:card]) && @format.equal?(current[:format])
      else
        @card, @format = current[:card], current[:format]
      end
      refuse("format") unless @format.symbol == :html && @format.parent.nil? && @format.mime_type.to_s.split(";").first == "text/html"
    end

    def controller_call(name, args, kwargs)
      context!
      case name
      when :read
        once(:read)
        scope(:read) { yield }
      when :show
        refuse("show") unless active?(:read) && (args.empty? || args[0].nil?) && (args.length < 2 || args[1] == 200)
        once(:show)
        scope(:show) { yield }
      when :render_page
        refuse("render-page") unless active?(:show)
        identity!
        refuse("render-page") unless args[0].equal?(@format) && (args[1].nil? || args[1].to_s == "core")
        once(:render_page)
        result = scope(:render_page) { yield }
        refuse("page-result") unless result.is_a?(String) && @page_result && result == @page_result
        @render_result = result
        result
      when :respond
        identity!
        refuse("response") unless active?(:show) && args[0].equal?(@format) && args[1].is_a?(String) && args[1] == @render_result && args[2] == @control.fetch("status") && [200, 403].include?(args[2])
        once(:respond)
        scope(:respond) { yield }
      when :render_response
        refuse("response-body") unless active?(:respond) && args[0].is_a?(String) && args[0] == @render_result && args[1] == @control.fetch("status") && args[2] == @format.mime_type
        once(:render_response)
        @body_hash = Digest::SHA256.hexdigest(args[0].b)
        scope(:render_response) { yield }
      when :render
        body = kwargs[:body] || (args[0].is_a?(Hash) && args[0][:body])
        options = kwargs.empty? && args[0].is_a?(Hash) ? args[0] : kwargs
        refuse("render-dispatch") unless active?(:render_response) && body.is_a?(String) && body == @render_result && options[:status] == @control.fetch("status") && options[:content_type] == @format.mime_type && (options.keys - %i[body status content_type]).empty?
        once(:render)
        yield
      else
        # Native redirects/rescue responses keep their original behavior;
        # they poison admission instead of becoming a qualified core read.
        invalidate(name.to_s)
        yield
      end
    end

    def format_call(receiver, name, args)
      return yield unless @format && receiver.equal?(@format)
      context!
      identity!
      case name
      when :page
        refuse("page") unless active?(:render_page) && args[0].equal?(@controller) && args[1].to_s == "core"
        once(:page)
        result = scope(:page) { yield }
        refuse("page-result") unless result.is_a?(String) && @view_result && result == @view_result
        @page_result = result.dup.freeze
        result
      when :render!
        return yield if active?(:render_view)
        refuse("render-view") unless active?(:page) && args[0].to_s == "core"
        once(:render_view)
        result = scope(:render_view) { yield }
        refuse("render-view-result") unless result.is_a?(String)
        @view_result = result.dup.freeze
        result
      when :ok?
        if active?(:gate)
          refuse("task") unless args == [:read]
          once(:read_check)
          @allow = yield
          refuse("read-result") unless [true, false].include?(@allow)
          @allow
        else
          yield
        end
      when :view_for_denial
        refuse("denial") unless active?(:permission) && args == [:core, :read] && @allow == false
        once(:denial)
        result = yield
        refuse("denial-view") unless result == :denial
        result
      else
        refuse("format-call")
      end
    end

    def root_view?(view)
      @format && view.format.equal?(@format) && view.parent.nil?
    end

    def view_call(view, name)
      return yield unless root_view?(view)
      context!
      identity!
      refuse("view-card") unless view.card.equal?(@card) && view.requested_view == :core
      case name
      when :process
        refuse("view-process") unless active?(:page) && active?(:render_view)
        once(:process)
        scope(:process) { yield }
      when :altered_view
        refuse("permission-scope") unless active?(:process)
        once(:permission)
        result = scope(:permission) { yield }
        refuse("altered-view") unless result == (@allow == false ? :denial : nil)
        result
      when :skip_check?
        refuse("skip-scope") unless active?(:permission)
        once(:skip)
        result = yield
        refuse("skipped-permissions") unless result == false
        result
      when :denied_task
        refuse("gate") unless active?(:permission) && (view.view_perms == :read || view.view_perms == [:read])
        once(:gate)
        result = scope(:gate) { yield }
        refuse("denied-task") unless result == (@allow == false ? :read : nil)
        result
      else
        refuse("view-call")
      end
    end

    def complete
      context!
      identity!
      refuse(@invalid) if @invalid
      %i[read show render_page page render_view process permission skip gate read_check respond render_response render].each { |name| refuse("missing-#{name}") unless @events[name] == 1 }
      refuse("unfinished-scope") unless @depth.values.all?(&:zero?)
      refuse("permission-result") unless @allow == @control.fetch("allow") && @controller.response.status == (@allow ? 200 : 403)
      refuse("denial") unless @events[:denial] == (@allow ? 0 : 1)
      body = @controller.response.body
      body = body.join if body.is_a?(Array) && body.all? { |part| part.is_a?(String) }
      refuse("final-response-body") unless body.is_a?(String) && Digest::SHA256.hexdigest(body.b) == @body_hash
      predicates = %i[id new_record? new_card? trash? virtual? real? known?].to_h do |name|
        method = @card.method(name)
        location = method.source_location
        [name.to_s, { "owner" => method.owner.to_s, "sourceLocation" => location,
          "sourceSha256" => location && File.file?(location[0]) ? Digest::SHA256.file(location[0]).hexdigest : nil }]
      end
      { card: @card, allow: @allow, evidence: { "kind" => "qualified-core-read", "cardId" => @card.id,
        "renderCardId" => @format.card.id, "action" => "read", "view" => "core", "format" => "html",
        "task" => "read", "allow" => @allow, "bodySha256" => @body_hash, "events" => @events.transform_keys(&:to_s),
        "parameters" => @parameters, "persistenceMethods" => predicates } }
    end
  end

  class Installer
    THREAD_KEY = :decko_restoration_native_read_invocation
    attr_reader :wrappers

    def initialize(controller_class, format_class, view_class)
      @wrappers = []
      controller_hooks = { read: :controller, show: :controller, render_page: :controller,
        respond: :response, render_response: :response, hard_redirect: :response,
        soft_redirect: :response, handle_exception: :errors, render: nil }
      controller_hooks.each do |name, pin|
        install(controller_class, name, pin) do |receiver, args, kwargs, invocation, &original|
          invocation.refuse("controller-replaced") unless receiver.equal?(invocation.controller)
          invocation.controller_call(name, args, kwargs, &original)
        end
      end
      { page: :format, render!: :render, ok?: :format_error, view_for_denial: :format_error }.each do |name, pin|
        install(format_class, name, pin) do |receiver, args, _kwargs, invocation, &original|
          invocation.format_call(receiver, name, args, &original)
        end
      end
      { process: :view, altered_view: :permission, skip_check?: :permission, denied_task: :permission }.each do |name, pin|
        install(view_class, name, pin) do |receiver, _args, _kwargs, invocation, &original|
          invocation.view_call(receiver, name, &original)
        end
      end
      %i[as as_bot with].each do |name|
        install(Card::Auth.singleton_class, name, :proxy) do |_receiver, _args, _kwargs, invocation, &original|
          invocation.refuse("permission-proxy") if invocation.active?(:permission)
          original.call
        end
      end
      @installed = true
      @wrappers.freeze
    end

    def installed? = @installed == true

    def with_request(controller, control, action)
      invocation = Invocation.new(controller, control, action)
      previous = Thread.current.thread_variable_get(THREAD_KEY)
      Thread.current.thread_variable_set(THREAD_KEY, [self, invocation])
      begin
        yield invocation
      ensure
        Thread.current.thread_variable_set(THREAD_KEY, previous)
      end
    end

    def verify_method!(receiver, name, pin)
      return unless pin
      method = receiver.method(name)
      method = method.super_method while method && @wrappers.include?(method.owner)
      location = method&.source_location
      raise Refused, "restoration-native-method-source-unqualified" unless method.respond_to?(:original_name) && method.original_name == name && location && File.file?(location[0]) && Digest::SHA256.file(location[0]).hexdigest == PINS.fetch(pin)
    end

    def install(klass, name, pin, &handler)
      original = klass.instance_method(name)
      if pin
        location = original.source_location
        raise Refused, "restoration-native-method-source-unqualified" unless original.respond_to?(:original_name) && original.original_name == name && location && File.file?(location[0]) && Digest::SHA256.file(location[0]).hexdigest == PINS.fetch(pin)
      end
      visibility = klass.private_method_defined?(name) ? :private : klass.protected_method_defined?(name) ? :protected : :public
      installer = self
      wrapper = Module.new do
        define_method(name) do |*args, **kwargs, &block|
          scoped = Thread.current.thread_variable_get(THREAD_KEY)
          unless scoped && scoped[0].equal?(installer)
            next super(*args, **kwargs, &block)
          end
          next super(*args, **kwargs, &block) if scoped[1].invalid?
          installer.verify_method!(self, name, pin)
          handler.call(self, args, kwargs, scoped[1]) { super(*args, **kwargs, &block) }
        end
      end
      wrapper.__send__(visibility, name)
      @wrappers << wrapper
      klass.prepend(wrapper)
    end
    private :install
  end
end

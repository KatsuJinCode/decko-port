# Opt-in initializer component for the existing serving application. This
# file never boots Rails, changes accounts, creates a server or runs a shell.
require "json"
require "digest"
require "sqlite3"
require "securerandom"
require_relative "serving-restoration-platform"
require_relative "native-read-control-binding"

module RestorationSQLite
  def self.quote(value) = '"' + value.gsub('"', '""') + '"'

  # SQLite itself canonicalizes every value, retaining type, byte length,
  # duplicate rows and column order. ORDER BY uses binary collation.
  def self.logical(db)
    schema = db.execute("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type COLLATE BINARY,name COLLATE BINARY").map { |type, name, table, sql| [type, name, table, Digest::SHA256.hexdigest(sql.to_s)] }
    tables = db.execute("SELECT name,sql FROM sqlite_master WHERE type='table' ORDER BY name COLLATE BINARY").map do |name, sql|
      columns = db.execute("PRAGMA table_xinfo(#{quote(name)})").reject { |row| row[6] == 1 }.map { |row| row[1] }
      expressions = columns.map do |column|
        q = quote(column)
        bytes = "CASE WHEN typeof(#{q})='real' THEN CAST(printf('%!.26g',#{q}) AS BLOB) ELSE CAST(#{q} AS BLOB) END"
        "typeof(#{q})||':'||length(#{bytes})||':'||hex(#{bytes})||';'"
      end
      # NULL has no CAST length; coalesce the whole cell, preserving it as N.
      row = expressions.map { |expr| "coalesce(#{expr},'N;')" }.join("||")
      hash = Digest::SHA256.new
      count = 0
      db.execute("SELECT #{row} AS encoded FROM #{quote(name)} ORDER BY encoded COLLATE BINARY") do |record|
        hash.update(record[0] + "\n")
        count += 1
      end
      [name, Digest::SHA256.hexdigest(sql.to_s), count, hash.hexdigest]
    end
    { "schema" => "decko-logical-sqlite/1", "schemaObjects" => schema, "tables" => tables, "sha256" => Digest::SHA256.hexdigest(JSON.generate({ "schemaObjects" => schema, "tables" => tables })) }
  end
end

class ServingRestorationObserver
  attr_reader :phase

  class GuardReleaseError < StandardError
    attr_reader :rollback_error, :close_error
    def initialize(rollback_error, close_error)
      @rollback_error, @close_error = rollback_error, close_error
      super("restoration-guard-release-failed")
    end
  end

  def initialize(plan:, output:, token:)
    raise "restoration-token-required" unless token.is_a?(String) && token.bytesize >= 32
    @plan = JSON.parse(JSON.generate(plan))
    raise "restoration-new-state-required" unless @plan.fetch("stateId") != @plan.fetch("parentStateId") && @plan.fetch("stateId").match?(/\A[a-zA-Z0-9_-]+\z/)
    raise "restoration-changes-required" unless @plan.fetch("changes").is_a?(Array) && !@plan["changes"].empty?
    controls = @plan.fetch("controls")
    raise "restoration-controls-required" unless controls.is_a?(Array) && controls.map { |c| c.fetch("id") }.uniq.length == controls.length
    %w[member admin].each do |role|
      selected = controls.select { |c| c["role"] == role }
      raise "restoration-role-controls-required" unless selected.any? { |c| c["kind"] == "login" } && selected.any? { |c| c["kind"] == "permission" && c["allow"] == true }
    end
    raise "restoration-negative-control-required" unless controls.any? { |c| c["role"] == "member" && c["kind"] == "permission" && c["allow"] == false }
    actors = controls.group_by { |c| c.fetch("role") }.transform_values { |cs| cs.map { |c| c.fetch("actorId") }.uniq }
    raise "restoration-distinct-actors-required" unless actors.keys.sort == %w[admin member] && actors.values.all? { |ids| ids.length == 1 && ids.first.is_a?(Integer) && ids.first.positive? } && actors.values.flatten.uniq.length == 2
    raise "restoration-account-changes-required" unless actors.values.flatten.all? { |id| @plan["changes"].any? { |change| change["kind"] == "comparison-accounts" && change.fetch("actorIds", []).include?(id) } }
    controls.each do |control|
      raise "restoration-control-shape" unless %w[login permission].include?(control.fetch("kind")) && control.fetch("path").start_with?("/") && %w[GET POST].include?(control.fetch("method"))
      raise "restoration-read-controls-only" if control["kind"] == "permission" && (control["method"] != "GET" || control["task"] != "read" || ![true, false].include?(control["allow"]))
    end
    @token_hash = Digest::SHA256.digest(token)
    @output = File.expand_path(output)
    raise "restoration-output-must-be-new" if File.exist?(@output)
    @observed_sources = {}
    @observed_sources_lock = Mutex.new
    @boot = profile
    @phase = "idle"
    @records = {}
    @active = 0
    @mutex = Mutex.new
    @epoch = 0
    @recording = {}
    @cleanup_failures = []
    @diagnostic_failures = []
  end

  def authorized?(env)
    return false unless %w[127.0.0.1 ::1].include?(env["REMOTE_ADDR"])
    candidate = Digest::SHA256.digest(env["HTTP_X_RESTORATION_KEY"].to_s)
    candidate.bytes.zip(@token_hash.bytes).reduce(0) { |sum, pair| sum | (pair[0] ^ pair[1]) }.zero?
  end

  def profile
    profile_snapshot.first
  end

  # Every profile travels with the set of module owners that were reachable
  # when it was taken. The frozen comparison needs that set: a module that is
  # collected after the freeze takes its method rows with it, and that is
  # garbage collection rather than a change of the program.
  def profile_snapshot
    raise "restoration-serving-application-not-initialized" unless Rails.application.initialized?
    config = Cardio.config
    fields = %w[read_only no_authentication view_cache default_html_view deck_origin asset_refresh rescue_all_in_controller consider_all_requests_local]
    effective = fields.to_h do |name|
      value = config.public_send(name)
      raise "restoration-nonsecret-config-shape" unless [TrueClass, FalseClass, NilClass, String, Symbol].any? { |kind| value.is_a?(kind) }
      [name, value.is_a?(Symbol) ? value.to_s : value]
    end
    require "uri"
    origin = URI.parse(effective.fetch("deck_origin"))
    raise "restoration-nonsecret-origin-required" unless %w[http https].include?(origin.scheme) && origin.host && !origin.userinfo && !origin.query && !origin.fragment
    effective["cache_store"] = Rails.application.config.cache_store.then { |v| (v.is_a?(Array) ? v.first : v).to_s }
    effective["mail_deliveries"] = ActionMailer::Base.perform_deliveries
    effective["mail_method"] = ActionMailer::Base.delivery_method.to_s
    builtins = %w[enumerator.so thread.rb fiber.so rational.so complex.so ruby2_keywords.rb]
    missing = $LOADED_FEATURES.reject { |p| File.file?(p) }
    raise "restoration-loaded-feature-unreadable" unless (missing - builtins).empty?
    # Decko's DSL also uses load/class_eval; $LOADED_FEATURES alone misses
    # those set methods. Record their actual current source locations too.
    locations, owners = method_locations
    raise "restoration-unbacked-loaded-method" if locations.any? { |row| !File.file?(row[2]) }
    backed = locations.map { |row| row[2] }.select { |file| File.file?(file) }
    root = File.realpath(Rails.root.to_s)
    application_files = %w[Gemfile Gemfile.lock config.ru config/application.rb config/database.yml].map { |file| File.join(root, file) }
    # ObjectSpace may stop returning a detached DSL module after collection.
    # Its observed source remains part of this observer's custody: re-read it
    # rather than making continued byte verification depend on GC timing. The
    # custody is cumulative, so a source first seen after boot is kept too.
    files = (application_files + @plan.fetch("sourceFiles") + $LOADED_FEATURES.select { |p| File.file?(p) } + backed + observed_sources + [RbConfig.ruby]).map { |p| File.realpath(p) }.uniq.sort
    record_observed_sources(files)
    [{ "process" => RestorationPlatform.process_identity,
      "applicationClass" => Rails.application.class.name, "railsEnvironment" => Rails.env.to_s,
      "applicationRoot" => root,
      "effective" => effective,
      "builtinFeatures" => missing.sort,
      "methodLocations" => locations,
      "controllerObservation" => controller_inventory,
      "gems" => Gem.loaded_specs.sort.map { |name, spec| [name, spec.version.to_s, spec.platform.to_s, spec.full_gem_path] },
      "sources" => files.map { |p| [p, Digest::SHA256.file(p).hexdigest] } }, owners]
  end
  private :profile_snapshot

  # The owners that were reachable when the inventory was taken travel with
  # it. A module collected afterwards takes its rows with it, so the frozen
  # comparison can tell that apart from a definition that really changed.
  def method_locations
    modules = ObjectSpace.each_object(Module).select { |mod| mod.name&.match?(/\A(?:Card|Cardio|Decko)(?:::|Controller|\z)/) }
    controller_ancestors = defined?(CardController) ? CardController.ancestors.reject { |owner| [Object, Kernel, BasicObject].include?(owner) } : []
    modules = (modules + controller_ancestors).uniq
    owners = {}
    locations = modules.flat_map do |mod|
      [mod, mod.singleton_class].flat_map do |owner|
        owners[owner.to_s] = true
        (owner.instance_methods(false) + owner.private_instance_methods(false) + owner.protected_instance_methods(false)).uniq.filter_map do |name|
          location = owner.instance_method(name).source_location
          [owner.to_s, name.to_s, *location] if location
        end
      end
    end.sort
    [locations, owners]
  end
  private :method_locations

  # Source custody is cumulative: every path this observer has observed stays
  # under byte verification, whether it was first seen at boot or later, so a
  # collected module's file cannot drop out of the inventory.
  def observed_sources
    @observed_sources_lock.synchronize { @observed_sources.keys }
  end
  private :observed_sources

  def record_observed_sources(paths)
    @observed_sources_lock.synchronize { paths.each { |path| @observed_sources[path] = true } }
  end
  private :record_observed_sources

  # The frozen profile is compared against a fresh one. A module collected
  # after the freeze takes its method rows with it; that is garbage collection,
  # not a change of the program, so those rows are excused. Every other
  # difference is a change and is refused: source bytes, reachable module
  # definitions, configuration, database identity and the rest of the profile.
  def frozen_profile_matches?(fresh_profile, fresh_owners)
    return false unless fresh_profile.reject { |key, _| key == "methodLocations" } == @frozen_profile.reject { |key, _| key == "methodLocations" }
    expected = @frozen_profile.fetch("methodLocations").select { |row| fresh_owners.key?(row[0]) }
    expected == fresh_profile.fetch("methodLocations")
  end
  private :frozen_profile_matches?

  def controller_inventory
    return { "mode" => "uninstalled" } unless defined?(CardController)
    callbacks = CardController.respond_to?(:_process_action_callbacks) ? CardController._process_action_callbacks.map do |callback|
      filter = callback.filter
      identity = filter.is_a?(Symbol) ? filter.to_s : { "class" => filter.class.name,
        "sourceLocation" => filter.respond_to?(:source_location) ? filter.source_location : nil }
      [callback.kind.to_s, identity]
    end : []
    { "mode" => @controller_class ? "process-action" : "uninstalled", "class" => CardController.name,
      "cardRenderBinding" => @native_read_binding&.installed? ? "qualified-core-read" : "unqualified",
      "processActionChain" => CardController.ancestors.filter_map do |owner|
        methods = owner.instance_methods(false) + owner.private_instance_methods(false) + owner.protected_instance_methods(false)
        [owner.to_s, owner.instance_method(:process_action).source_location] if methods.include?(:process_action)
      end, "callbacks" => callbacks }
  end
  private :controller_inventory

  def start
    @mutex.synchronize do
      raise "restoration-not-idle" unless @phase == "idle" && @active.zero?
      Dir.mkdir(@output, 0700)
      @phase = "access"
    end
  end

  def database_identity(path)
    stat = File.stat(path)
    { "path" => File.realpath(path), "device" => stat.dev, "inode" => stat.ino }
  end

  def serving_database_path
    connection = Card.connection.raw_connection
    main = connection.execute("PRAGMA database_list").find { |row| (row.is_a?(Hash) ? row["name"] : row[1]) == "main" }
    raise "restoration-serving-main-database-missing" unless main
    main.is_a?(Hash) ? main.fetch("file") : main.fetch(2)
  end

  def freeze_state
    epoch, guard = @mutex.synchronize do
      raise "restoration-access-not-ready" unless @phase == "access" && @active.zero? && @recording.empty? && @plan["controls"].select { |c| c["kind"] == "login" }.all? { |c| @records.key?(c["id"]) }
      @database = serving_database_path
      @database_id = database_identity(@database)
      raise "restoration-login-database-changed" unless @records.values.all? { |record| record["database"] == @database_id }
      @guard = SQLite3::Database.new(@database)
      @guard.busy_timeout = 0
      @guard.execute("BEGIN IMMEDIATE")
      @phase = "freezing"
      [@epoch, @guard]
    end
    # Long IO and profiling do not own the state mutex. Abort can release the
    # hold promptly; the ticket below then prevents any state resurrection.
    snapshot = take_snapshot
    frozen_profile = profile
    @mutex.synchronize do
      return failed_result if @phase == "failed" || @epoch != epoch
      require_hold_locked(guard, "freezing")
      raise "restoration-database-replaced" unless database_identity(@database) == @database_id
      @snapshot = snapshot
      @frozen_profile = frozen_profile
      @frozen_guard = guard
      @phase = "frozen"
    end
  rescue StandardError => primary
    abort_after_failure(primary)
    raise
  end

  def take_snapshot
    source = dest = nil
    begin
      source = SQLite3::Database.new(@database, readonly: true)
      target = File.join(@output, "snapshot.sqlite")
      File.open(target, File::WRONLY | File::CREAT | File::EXCL, 0600) {}
      dest = SQLite3::Database.new(target)
      copy = SQLite3::Backup.new(dest, "main", source, "main")
      begin
        raise "restoration-backup-incomplete" unless copy.step(-1) == SQLite3::Constants::ErrorCode::DONE
      ensure
        copy.finish
      end
      dest.execute("PRAGMA journal_mode=DELETE")
      raise "restoration-snapshot-integrity" unless dest.get_first_value("PRAGMA integrity_check") == "ok"
      { "fileSha256" => Digest::SHA256.file(target).hexdigest, "logical" => RestorationSQLite.logical(dest) }
    ensure
      begin
        dest.close if dest
      ensure
        source.close if source
      end
    end
  end
  private :take_snapshot

  # The installed wrapper calls this inside the controller request, outside
  # its rescue-render layer. Direct calls without installation are mechanism
  # fixtures, not evidence that native authentication callbacks executed.
  def observe(controller)
    id = controller.request.get_header("HTTP_X_RESTORATION_CONTROL")
    return if id.nil?
    control, epoch, guard = @mutex.synchronize do
      return unless %w[access frozen].include?(@phase)
      planned = @plan["controls"].find { |c| c["id"] == id }
      raise "restoration-unknown-control" unless planned
      expected = planned["kind"] == "login" ? "access" : "frozen"
      raise "restoration-control-phase" unless @phase == expected
      require_hold_locked(@frozen_guard, "frozen") if expected == "frozen"
      raise "restoration-duplicate-control" if @records.key?(id) || @recording.key?(id)
      @recording[id] = @epoch
      [planned, @epoch, expected == "frozen" ? @frozen_guard : nil]
    end
    if @controller_class
      context = controller.instance_variable_get(:@_restoration_request_context)
      raise "restoration-request-authentication-not-observed" unless context && context[:owner].equal?(self) && context[:request].equal?(controller.request) && context[:thread].equal?(Thread.current) && context[:authenticated]
    end
    request = controller.request
    raise "restoration-control-request-mismatch" unless request.request_method == control["method"] && request.path == control["path"]
    actor = Card::Auth.current_id
    raise "restoration-native-actor-mismatch" unless actor == control["actorId"] && actor != Card::AnonymousID && actor != Card::DeckoBotID
    raise "restoration-native-role-mismatch" unless !!Card::Auth.always_ok? == (control["role"] == "admin")
    result = { "id" => id, "role" => control["role"], "actorId" => actor, "status" => controller.response.status,
      "database" => database_identity(serving_database_path), "process" => RestorationPlatform.process_identity }
    result["authenticationObserved"] = !!@controller_class
    raise "restoration-status-mismatch" unless result["status"] == control.fetch("status")
    if control["kind"] == "permission"
      if @native_read_binding
        binding = context && context[:read_binding]
        raise "restoration-native-read-invocation-missing" unless binding
        observed = binding.complete
        result["allow"] = observed[:allow]
        result["readBinding"] = observed[:evidence]
      else
        # Legacy mechanism-only fixtures cannot qualify native finish. Even
        # there, an explicitly supplied controller card cannot be substituted
        # with a convenient independently fetched plan card.
        if controller.respond_to?(:card) || controller.respond_to?(:format)
          NativeReadControlBinding.identity(controller, control.fetch("cardId"))
          raise "restoration-native-read-invocation-missing"
        end
        card = Card.fetch(control.fetch("cardId"))
        raise "restoration-card-missing" unless card && card.real?
        result["allow"] = !!card.ok?(:read)
      end
      raise "restoration-permission-mismatch" unless result["allow"] == control["allow"]
      fresh_profile, fresh_owners = profile_snapshot
      raise "restoration-control-profile-changed" unless frozen_profile_matches?(fresh_profile, fresh_owners)
      result["profileSha256"] = Digest::SHA256.hexdigest(JSON.generate(@frozen_profile))
    end
    @mutex.synchronize do
      return failed_result if @phase == "failed" || @epoch != epoch
      if control["kind"] == "permission"
        require_hold_locked(guard, "frozen")
        raise "restoration-database-replaced" unless database_identity(@database) == @database_id
        raise "restoration-control-database-changed" unless result["database"] == @database_id
      else
        raise "restoration-control-phase" unless @phase == "access"
      end
      @records[id] = result
    end
  rescue StandardError => primary
    abort_after_failure(primary)
    raise
  ensure
    @mutex.synchronize { @recording.delete(id) } if id
  end

  def finish
    epoch, guard = @mutex.synchronize do
      return failed_result if @phase == "failed"
      if @controller_class
        raise "restoration-native-card-render-binding-unqualified" unless @native_read_binding&.installed? && @plan["controls"].select { |c| c["kind"] == "permission" }.all? { |c| @records[c["id"]]&.dig("readBinding", "kind") == "qualified-core-read" }
      end
      raise "restoration-controls-incomplete" unless @phase == "frozen" && @active.zero? && @recording.empty? && @records.length == @plan["controls"].length
      require_hold_locked(@frozen_guard, "frozen")
      @phase = "finishing"
      [@epoch, @frozen_guard]
    end
    current, current_owners = profile_snapshot
    receipt = @mutex.synchronize do
      return failed_result if @phase == "failed" || @epoch != epoch
      require_hold_locked(guard, "finishing")
      raise "restoration-frozen-profile-changed" unless frozen_profile_matches?(current, current_owners)
      raise "restoration-process-changed" unless current["process"] == @boot["process"]
      raise "restoration-profile-changed" unless current.reject { |k, _| %w[sources gems methodLocations controllerObservation].include?(k) } == @boot.reject { |k, _| %w[sources gems methodLocations controllerObservation].include?(k) }
      old = @boot["sources"].to_h
      raise "restoration-loaded-source-changed" unless old.all? { |p, hash| current["sources"].to_h[p] == hash }
      raise "restoration-database-replaced" unless database_identity(@database) == @database_id
      { "schema" => "decko-serving-restoration/1", "plan" => @plan,
        "bootProfile" => @boot, "servingProfile" => current, "database" => @database_id,
        "snapshot" => @snapshot, "controls" => @records.values.sort_by { |r| r["id"] } }
    end
    pending = write_pending_receipt(receipt)
    @mutex.synchronize do
      return failed_result if @phase == "failed" || @epoch != epoch
      require_hold_locked(guard, "finishing")
      raise "restoration-database-replaced" unless database_identity(@database) == @database_id
      release_guard_locked
      # Atomic no-overwrite publication after successful flush and orderly
      # guard release. A failed/cancelled pending file is never completion.
      File.link(pending, File.join(@output, "ruby-receipt.json"))
      @receipt = receipt
      @phase = "complete"
      @receipt
    end
  rescue StandardError => primary
    abort_after_failure(primary)
    raise
  end

  def write_pending_receipt(receipt)
    pending = File.join(@output, "ruby-receipt.pending.json")
    File.open(pending, File::WRONLY | File::CREAT | File::EXCL, 0600) { |f| f.write(JSON.generate(receipt)); f.flush; f.fsync }
    pending
  end
  private :write_pending_receipt

  def require_hold_locked(guard, phase)
    raise "restoration-state-lock-required" unless @mutex.owned?
    raise "restoration-owned-write-hold-required" unless @phase == phase && guard && @guard.equal?(guard) && guard.transaction_active?
  end

  def failed_result
    { "phase" => "failed", "error" => "restoration-observation-aborted" }
  end

  def release_guard_locked
    raise "restoration-state-lock-required" unless @mutex.owned?
    return unless @guard
    rollback_error = close_error = nil
    begin
      @guard.execute("ROLLBACK") if !@guard.closed? && @guard.transaction_active?
    rescue StandardError => error
      rollback_error = error
      @cleanup_failures << { stage: "rollback", error: error }
    ensure
      begin
        @guard.close unless @guard.closed?
        raise "restoration-guard-close-unconfirmed" unless @guard.closed?
      rescue StandardError => error
        close_error = error
        @cleanup_failures << { stage: "close", error: error }
      end
    end
    unless close_error
      @guard = nil
      @frozen_guard = nil
    end
    if rollback_error || close_error
      @epoch += 1
      @phase = "failed"
      raise GuardReleaseError.new(rollback_error, close_error), cause: rollback_error if rollback_error && close_error
      raise rollback_error || close_error
    end
  end
  private :require_hold_locked, :release_guard_locked, :failed_result

  def abort_after_failure(_primary)
    needs_abort = @mutex.synchronize { !%w[failed complete].include?(@phase) }
    abort if needs_abort
  rescue StandardError => cleanup
    report_cleanup_failure(cleanup)
  end

  def report_cleanup_failure(error)
    failures = @mutex.synchronize { @cleanup_failures.dup }
    report_diagnostic("restoration cleanup failed", error) unless failures.any? { |entry| entry[:error].equal?(error) }
    failures.each { |entry| report_diagnostic("restoration cleanup failed (#{entry[:stage]})", entry[:error]) }
  end

  def report_diagnostic(stage, error)
    @mutex.synchronize { @diagnostic_failures << { stage: stage, error: error } }
    warn "#{stage}: #{error.class}: #{error.message}"
  rescue StandardError => reporting_error
    # A failed diagnostic sink must not replace the native error or escape
    # the constant Rack refusal. Retain that failure too for inspection.
    @mutex.synchronize { @diagnostic_failures << { stage: "diagnostic-output", error: reporting_error } }
  end
  private :abort_after_failure, :report_cleanup_failure, :report_diagnostic

  def diagnostic_failures
    @mutex.synchronize { @diagnostic_failures.map(&:dup) }
  end

  def unresolved_guard?
    @mutex.synchronize { @phase == "failed" && !@guard.nil? }
  end

  def abort
    @mutex.synchronize do
      return { "phase" => "complete" } if @phase == "complete"
      @epoch += 1
      @phase = "failed"
      release_guard_locked
      failed_result
    end
  end

  def install_controller!
    raise "restoration-controller-already-installed" if @controller_class
    controller_class = CardController
    %i[authenticate process_action].each { |name| controller_class.instance_method(name) }
    observer = self
    wrapper = Module.new
    wrapper.define_method(:authenticate) do |*args, **kwargs, &block|
      result = super(*args, **kwargs, &block)
      context = instance_variable_get(:@_restoration_request_context)
      if context && context[:owner].equal?(observer) && context[:request].equal?(request) && context[:thread].equal?(Thread.current)
        context[:authenticated] = true
      end
      result
    end
    wrapper.define_method(:process_action) do |*args, **kwargs, &block|
      previous = instance_variable_get(:@_restoration_request_context)
      context = { owner: observer, request: request, thread: Thread.current, authenticated: false }
      instance_variable_set(:@_restoration_request_context, context)
      begin
        begin
          native_binding = observer.instance_variable_get(:@native_read_binding)
          control = observer.__send__(:native_read_control, self)
          result = if native_binding && control
            raise NativeReadControlBinding::Refused, "restoration-native-controller-outer-wrapper-unqualified" unless method(:process_action).owner.equal?(wrapper)
            native_binding.with_request(self, control, args.first) do |invocation|
              context[:read_binding] = invocation
              super(*args, **kwargs, &block)
            end
          else
            super(*args, **kwargs, &block)
          end
        rescue Exception => original
          begin
            observer.__send__(:controller_exception)
          rescue Exception => cleanup
            # cleanup already has original as its Ruby cause; reversing that
            # link creates a cycle. Preserve the native exception and report
            # the separate cleanup failure without logging request contents.
            observer.__send__(:report_cleanup_failure, cleanup)
          end
          raise
        end
        observer.observe(self)
        result
      ensure
        if previous
          instance_variable_set(:@_restoration_request_context, previous)
        else
          remove_instance_variable(:@_restoration_request_context)
        end
      end
    end
    %i[authenticate process_action].each do |name|
      visibility = controller_class.private_method_defined?(name) ? :private : controller_class.protected_method_defined?(name) ? :protected : :public
      wrapper.__send__(visibility, name)
    end
    controller_class.prepend(wrapper)
    @controller_class = controller_class
    if Card.const_defined?(:Format, false) && Card.const_defined?(:View, false)
      @native_read_binding = NativeReadControlBinding::Installer.new(controller_class, Card::Format, Card::View)
    end
    wrapper
  end

  def native_read_control(controller)
    id = controller.request.get_header("HTTP_X_RESTORATION_CONTROL")
    @mutex.synchronize { @plan["controls"].find { |c| c["id"] == id && c["kind"] == "permission" } if @phase == "frozen" }
  end
  private :native_read_control

  def controller_exception
    active = @mutex.synchronize { %w[access freezing frozen finishing].include?(@phase) }
    abort if active
  end
  private :controller_exception

  # Mount on the existing Rack stack; control responses never expose the
  # receipt, source paths, database or credentials. No HTTP server is created.
  def middleware(app)
    observer = self
    lambda do |env|
      if env["PATH_INFO"].start_with?("/__restoration/")
        next [404, {}, []] unless env["REQUEST_METHOD"] == "POST" && observer.authorized?(env)
        operation = env["PATH_INFO"].delete_prefix("/__restoration/")
        next [404, {}, []] unless %w[start freeze_state finish abort].include?(operation)
        begin
          observer.public_send(operation)
          [operation != "abort" && observer.phase == "failed" ? 409 : 200, { "content-type" => "application/json" }, [JSON.generate({ "phase" => observer.phase })]]
        rescue StandardError => primary
          observer.__send__(:abort_after_failure, primary)
          observer.__send__(:report_diagnostic, "restoration control failed", primary)
          observer.__send__(:report_cleanup_failure, primary)
          [409, { "content-type" => "application/json" }, ['{"error":"restoration-observation-failed"}']]
        end
      else
        admitted = @mutex.synchronize do
          control = @plan["controls"].find { |c| c["id"] == env["HTTP_X_RESTORATION_CONTROL"] }
          controlled_phase = (control && ((@phase == "access" && control["kind"] == "login") || (@phase == "frozen" && control["kind"] == "permission")))
          unresolved = @phase == "failed" && !@guard.nil?
          allowed = !unresolved && (!%w[access freezing frozen finishing].include?(@phase) || (controlled_phase && observer.authorized?(env) && control["method"] == env["REQUEST_METHOD"] && control["path"] == env["PATH_INFO"]))
          @active += 1 if allowed
          allowed
        end
        next [503, { "retry-after" => "0" }, []] unless admitted
        begin
          app.call(env)
        ensure
          @mutex.synchronize { @active -= 1 }
        end
      end
    end
  end
end

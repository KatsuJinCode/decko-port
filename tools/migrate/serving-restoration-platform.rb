require "rbconfig"

module RestorationPlatform
  def self.linux_identity(stat, boot, pid)
    fields = stat.split(") ").last.split
    start = fields.fetch(19)
    raise "restoration-proc-stat-invalid" unless start.match?(/\A[0-9]+\z/)
    { "pid" => pid, "start" => start, "boot" => boot.strip }
  end

  def self.process_identity
    case RbConfig::CONFIG.fetch("host_os")
    when /linux/
      # comm may itself contain spaces and parentheses; fields after its
      # final closing parenthesis start at proc-stat field three.
      linux_identity(File.read("/proc/self/stat"), File.read("/proc/sys/kernel/random/boot_id"), Process.pid)
    when /mswin|mingw/
      require "fiddle/import"
      api = Module.new do
        extend Fiddle::Importer
        dlload "kernel32.dll"
        extern "void* GetCurrentProcess()"
        extern "int GetProcessTimes(void*, void*, void*, void*, void*)"
      end
      times = Array.new(4) { Fiddle::Pointer.malloc(8) }
      raise "restoration-process-times-failed" if api.GetProcessTimes(api.GetCurrentProcess, *times).zero?
      { "pid" => Process.pid, "start" => times.first[0, 8].unpack1("Q<").to_s, "boot" => "windows-filetime" }
    else
      raise "restoration-unsupported-platform"
    end
  end
end

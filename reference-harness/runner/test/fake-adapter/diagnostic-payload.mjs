export const stdoutDiagnostic = "  native-note:" + "x".repeat(900) + "🚀-VISIBLE_STDOUT_END  \r\n" +
  '{"broken":' + "y".repeat(700) + "-BAD_JSON_END\r\n";
export const stderrDiagnostic = Buffer.concat([
  Buffer.from(Array.from({ length: 140 }, (_, index) =>
    index === 35 ? "ONLY_USEFUL_NATIVE_CAUSE\r\n" : `native line ${index}\r\n`).join("")),
  Buffer.from("split UTF-8: 🚀 é\r\n"), Buffer.from([0xff, 0x00]), Buffer.from("FINAL_WITHOUT_NEWLINE"),
]);
export const shutdownDiagnostic = Buffer.from("\r\nOWNED_SHUTDOWN_TAIL");

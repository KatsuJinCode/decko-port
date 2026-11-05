export type ScriptCompressor = (js: string) => string;

export class ScriptCompressionError extends Error {
  constructor(cardName: string, cause: unknown) {
    const message = cause instanceof Error ? cause.message : String(cause);
    super(`JavaScript::SyntaxError (${cardName}): ${message}`);
    this.name = "ScriptCompressionError";
  }
}

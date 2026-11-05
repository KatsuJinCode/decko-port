import { CardActionError } from "../actions/types.js";

export function addValidationErrors(
  cardName: string,
  attribute: string,
  messages: readonly string[],
): never {
  if (messages.length === 0) {
    throw new Error(
      `addValidationErrors: no messages to add for :${attribute} on ${cardName}`,
    );
  }
  const key = attribute.toUpperCase();
  const last = messages[messages.length - 1]!;
  throw new CardActionError(
    "user-error",
    messages.join("\n"),
    messages.map((message) => `${key}: ${message}`).join("\n"),
    { [attribute]: last },
    cardName,
  );
}

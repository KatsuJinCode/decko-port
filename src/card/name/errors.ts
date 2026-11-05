export class NameNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NameNotFoundError";
  }
}

export class CodenameNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CodenameNotFoundError";
  }
}

export class UnsupportedIdentifierError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnsupportedIdentifierError";
  }
}

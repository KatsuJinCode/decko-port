declare module "coffeescript" {
  export function compile(
    script: string,
    options?: { bare?: boolean },
  ): string;
}

import { compile as coffeeCompile } from "coffeescript";
import type { CoffeeCompiler } from "../card/assets/coffee-compiler.js";

export function coffeeNpmCompiler(): CoffeeCompiler {
  return (script: string, noWrap: boolean) => coffeeCompile(script, { bare: noWrap });
}

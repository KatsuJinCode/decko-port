import { readFileSync, writeFileSync } from "node:fs";
import { bootDeck } from "./deck.js";
import { sowYaml } from "./sow.js";
import { eatYaml } from "./eat.js";

function option(args: string[], ...names: string[]): string | undefined {
  for (const n of names) {
    const i = args.indexOf(n);
    if (i !== -1 && i + 1 < args.length) return args[i + 1];
  }
  return undefined;
}

export async function main(argv: string[]): Promise<number> {
  const [command, ...args] = argv;
  const deckPath = option(args, "--deck", "-d");
  if ((command !== "sow" && command !== "eat") || deckPath === undefined) {
    process.stderr.write(
      "usage: sow --deck <deck> (-c <cql> | -n <names> [--items [only]] | --url <url> | --remote <url> -n <name>)\n" +
        "           [-f <tags>] [-o <out.yml> | -m <data file>]\n" +
        "       eat --deck <deck> <pod.yml> [-u <user>]\n",
    );
    return 2;
  }
  if (command === "sow") {
    const deck = await bootDeck(deckPath, { readonly: true });
    try {
      const cql = option(args, "-c", "--cql");
      const names = option(args, "-n", "--name");
      const tags = option(args, "-f", "--field_tags");
      const url = option(args, "--url");
      const remote = option(args, "--remote");
      const mergeInto = option(args, "-m", "--mod-file");
      const itemsAt = args.indexOf("--items");
      const items = itemsAt === -1 ? undefined : args[itemsAt + 1] === "only" ? "only" : true;
      const yaml = await sowYaml(deck.fetcher, {
        ...(cql !== undefined ? { cql: JSON.parse(cql) as Record<string, unknown> } : {}),
        ...(names !== undefined ? { names: names.split(",") } : {}),
        ...(tags !== undefined ? { fieldTags: tags.split(",") } : {}),
        ...(url !== undefined ? { url } : {}),
        ...(remote !== undefined ? { remote } : {}),
        ...(items !== undefined ? { items } : {}),
        ...(mergeInto !== undefined ? { mergeInto } : {}),
      });
      const out = option(args, "-o", "--out") ?? mergeInto;
      if (out !== undefined) writeFileSync(out, yaml);
      else process.stdout.write(yaml);
      return 0;
    } finally {
      deck.close();
    }
  }
  const podPath = args.find((a, i) => !a.startsWith("-") && !["--deck", "-d", "-u", "--user", "--files", "--store", "--coded-mod", "--coded-dir"].includes(args[i - 1] ?? ""));
  if (podPath === undefined) {
    process.stderr.write("eat: no pod file given\n");
    return 2;
  }
  const filesDir = option(args, "--files");
  const storeDir = option(args, "--store");
  const codedMod = option(args, "--coded-mod");
  const codedDir = option(args, "--coded-dir");
  const deck = await bootDeck(deckPath, {
    ...(storeDir !== undefined ? { filesDir: storeDir } : {}),
    ...(codedDir !== undefined ? { codedDir } : {}),
  });
  try {
    let actor = { id: 1, name: "Decko Bot" };
    const user = option(args, "-u", "--user");
    if (user !== undefined) {
      const record = await deck.fetcher.fetchByName(user);
      if (record?.id === undefined) throw new Error(`no such user: ${user}`);
      actor = { id: record.id, name: record.name?.s ?? user };
    }
    const report = await eatYaml(deck.fetcher, (a, now) => deck.engineFor(a, now), readFileSync(podPath, "utf8"), {
      defaultActor: actor,
      ...(filesDir !== undefined ? { filesDir } : {}),
      ...(codedMod !== undefined ? { codedMod } : {}),
    });
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
    return report.errors.length === 0 ? 0 : 1;
  } finally {
    deck.close();
  }
}

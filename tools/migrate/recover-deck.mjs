import { createRecoverySnapshot, restoreRecoverySnapshot } from "./recovery.mjs";

const [command, ...args] = process.argv.slice(2);
const options = {};
try {
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    if (!["--database", "--files", "--out", "--snapshot"].includes(key) || !value || value.startsWith("--") || options[key]) throw new Error("Invalid or duplicate recovery option");
    options[key] = value;
  }
  if (command === "snapshot" && options["--database"] && options["--files"] && options["--out"] && !options["--snapshot"]) {
    const manifest = await createRecoverySnapshot({ databasePath: options["--database"], filesPath: options["--files"], snapshotDir: options["--out"] });
    console.log(JSON.stringify({ snapshotCreated: true, databaseSha256: manifest.databaseSha256, files: manifest.files.filter(entry => !entry.directory).length }));
  } else if (command === "restore" && options["--snapshot"] && options["--out"] && !options["--database"] && !options["--files"]) {
    await restoreRecoverySnapshot({ snapshotDir: options["--snapshot"], targetDir: options["--out"] });
    console.log(JSON.stringify({ restored: true }));
  } else {
    throw new Error("Usage: recover-deck.mjs snapshot --database <sqlite> --files <uploads> --out <new-directory> | restore --snapshot <directory> --out <new-directory>");
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}

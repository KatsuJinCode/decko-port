export async function reconstructCardName({
  sourceName,
  sourceKey,
  leftId,
  rightId,
  driver,
  maxDepth = 64,
}) {
  if (typeof sourceName === "string" && sourceName.length > 0) {
    let key = sourceKey;
    if ((key === null || key === undefined) && typeof sourceName === "string") {
      key = null;
    }
    return { name: sourceName, key, via: "in-column", resolved: true };
  }

  if (leftId !== null && leftId !== undefined) {
    const walked = await walkBySides(driver, leftId, rightId, 0, maxDepth);
    if (walked.resolved) {
      return { name: walked.name, key: null, via: "lexicon", resolved: true };
    }
  }

  return { name: null, key: null, via: "unresolved", resolved: false };
}

async function walkBySides(driver, leftId, rightId, depth, maxDepth) {
  if (depth > maxDepth) return { name: null, resolved: false, depth };
  const left = await fetchSimpleName(driver, leftId, depth + 1, maxDepth);
  if (left === null) return { name: null, resolved: false, depth };
  const right =
    rightId === null || rightId === undefined
      ? ""
      : (await fetchSimpleName(driver, rightId, depth + 1, maxDepth)) ?? "";
  return { name: `${left}+${right}`, resolved: true, depth };
}

async function fetchSimpleName(driver, id, depth, maxDepth) {
  if (depth > maxDepth) return null;
  const r = await driver.query(
    "SELECT name, left_id, right_id FROM cards WHERE id = ? LIMIT 1",
    [id],
  );
  const row = r.rows[0];
  if (row === undefined) return null;
  if (typeof row.name === "string" && row.name !== "") return row.name;
  if (row.left_id === null || row.left_id === undefined) return null;
  return (await walkBySides(driver, row.left_id, row.right_id, depth + 1, maxDepth)).name;
}

export async function countNullNameJunctions(driver, table = "cards") {
  const r = await driver.query(
    `SELECT COUNT(*) AS n FROM "${table}"
     WHERE left_id IS NOT NULL AND (name IS NULL OR name = '')`,
    [],
  );
  return Number(r.rows[0]?.n ?? 0);
}
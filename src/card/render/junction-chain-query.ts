import type { SQLStatement } from "../../server/driver.js";
import { unionCtes } from "../live/request-store.js";

export function junctionChainQuery(tuples: readonly (readonly string[])[]): SQLStatement {
  const depth=tuples[0]?.length ?? 0;
  if(depth<3 || tuples.some(parts=>parts.length!==depth) || depth*tuples.length>90) throw new Error("junction chain query requires equal-depth tuples within 90 parameters");
  const keys=Array.from({length:depth},(_,i)=>`k${i}`);
  const parts=tuples.map(()=>`SELECT ${keys.map(()=>"?").join(", ")}`);
  const requestedCtes=unionCtes("requested",parts,keys.join(", "));
  const joins=[
    `CROSS JOIN cards p0 ON p0."key" = requested.k0 AND p0.trash = 0`,
    `CROSS JOIN cards p1 ON p1."key" = requested.k1 AND p1.trash = 0`,
    `CROSS JOIN cards c2 ON c2.left_id = p0.id AND c2.right_id = p1.id AND c2.trash = 0`,
  ];
  for(let n=2;n<depth;n++){
    joins.push(`CROSS JOIN cards p${n} ON p${n}."key" = requested.k${n} AND p${n}.trash = 0`);
    joins.push(`CROSS JOIN cards c${n+1} ON c${n+1}.left_id = c${n}.id AND c${n+1}.right_id = p${n}.id AND c${n+1}.trash = 0`);
  }
  const identities = Array.from({length: depth - 1}, (_, index) => {
    const alias = `c${index + 2}`;
    return `${alias}.id = (SELECT id FROM cards WHERE left_id = ${alias}.left_id AND right_id = ${alias}.right_id AND trash = 0 ORDER BY id LIMIT 1)`;
  });
  return {sql:`WITH ${requestedCtes.join(", ")} SELECT DISTINCT c${depth}.* FROM requested\n${joins.join("\n")}\nWHERE ${identities.join(" AND ")}`,params:tuples.flatMap(t=>[...t])};
}

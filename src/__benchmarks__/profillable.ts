import { compileQuery, isCompiledQuery } from "../";
import { query, schema } from "./schema-nested-array";

const compiled = compileQuery(schema(), query, "");

if (isCompiledQuery(compiled)) {
  const executableQuery = compiled.query;

  const now = Date.now();
  let operations = 0;
  const timelimit = getTimelimit();
  function benchmark() {
    if (Date.now() - now > timelimit) {
      console.log(`Ran ${operations} operations in ${timelimit / 1000}s`);
      return;
    }
    const p: any = executableQuery(undefined, undefined, {
      id: "2",
      width: 300,
      height: 500
    });
    p.then(benchmark);
    operations++;
  }
  benchmark();
} else {
  console.log("failed to compile");
}
const DEFAULT_TIMELIMIT = 60000;

function getTimelimit(): number {
  const arg = process.argv[2];
  if (!arg) {
    return DEFAULT_TIMELIMIT;
  }
  const parsed = Number.parseInt(arg, 10);
  if (!parsed || Number.isNaN(parsed)) {
    return DEFAULT_TIMELIMIT;
  }
  return parsed;
}

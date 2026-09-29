/**
 * Compiles a few corpus fixtures with the package under test and prints the facts that must not depend on the environment.
 *
 * script.test.mjs runs this file in two child processes — NODE_ENV=development and NODE_ENV=production — because the official Vue compiler reads NODE_ENV to decide
 * whether to print its once-per-process hints. The frontend runs the official compiler under a fixed environment, so the two runs must be identical.
 */
import { pathToFileURL } from 'node:url';
import { parseObix } from 'obix-compiler-parser';
import { toObixSfc } from 'obix-compiler-sfc';
import { compileObixScript } from '../dist/index.js';
import { manifest, readFixture } from '../../../tests/vuets/oracle.mjs';

export function probe(ids) {
  return ids.map((id) => {
    const f = manifest.fixtures.find((x) => x.id === id);
    const filename = `${f.name}.obix`;
    const r = compileObixScript(toObixSfc(parseObix(readFixture(id, filename), filename)));
    return {
      id,
      status: r.status,
      diagnostics: r.diagnostics.map((d) => ({ code: d.code, message: d.message, severity: d.severity, detail: d.detail ?? null, upstream: d.upstream ?? null, start: d.start ?? null, end: d.end ?? null })),
      content: r.artifact ? r.artifact.content : null,
      bindings: r.artifact ? JSON.parse(JSON.stringify(r.artifact.bindings)) : null,
    };
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write('@@' + JSON.stringify({ env: process.env.NODE_ENV ?? null, rows: probe(JSON.parse(process.argv[2])) }));
}

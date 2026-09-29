/**
 * C1 — OBIX authoring primitives, resolved at the Vue frontend's import boundary (docs/recovery/vuets-compiler.md §22).
 *
 * `import { ref, computed } from "obix"` is the authoring syntax of OBIX; the frontend resolves each name through an EXPLICIT REGISTRY — `ref` and `computed` only,
 * each proven equivalent to Vue's — into the same semantic primitive as the Vue import of that name. What it gives the later stages is normalized metadata
 * (`artifact.resolutions`), beside everything the official compiler said, unchanged: the source is never rewritten, the import keeps `"obix"` as its module, and
 * the compiled script and its binding metadata are exactly the official compiler's. Any other name imported from "obix" is an unregistered authoring name — never
 * taken to be Vue's by a blanket rule.
 *
 * The fixture is minimal and framework-neutral: a state, a derived value and an action — the shape AnyTune's PitchMeter and TunerDisplay needed, not their code.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { parseObix } from 'obix-compiler-parser';
import { toObixSfc } from 'obix-compiler-sfc';
import { OBIX_AUTHORING_PRIMITIVES, compileObixScript } from '../dist/index.js';
import { compileObixScriptSetup } from '../../obix-compiler-script-setup/dist/index.js';

const sfc = (source, filename = 'Counter.obix') => toObixSfc(parseObix(source, filename));
const FIXTURE = [
  '<script setup lang="ts">',
  'import { computed, ref } from "obix";',
  'const count = ref(0);',
  'const doubled = computed(() => count.value * 2);',
  'function increment(): void {',
  '  count.value++;',
  '}',
  '</script>',
  '<template><button type="button" @click="increment">{{ count }} / {{ doubled }}</button></template>',
  '',
].join('\n');
const vueTwin = FIXTURE.replace('from "obix"', 'from "vue"');

test('the registry: ref and computed, each Vue’s primitive of that name — and nothing else until another entry is proven', () => {
  assert.deepEqual(OBIX_AUTHORING_PRIMITIVES, { computed: { module: 'vue', export: 'computed' }, ref: { module: 'vue', export: 'ref' } });
  assert.ok(Object.isFrozen(OBIX_AUTHORING_PRIMITIVES) && Object.values(OBIX_AUTHORING_PRIMITIVES).every(Object.isFrozen));
});

test('ref and computed imported from "obix" resolve to Vue’s ref and computed; the import keeps "obix" as the module it was written from', () => {
  const r = compileObixScriptSetup(sfc(FIXTURE));
  assert.equal(r.status, 'compiled', JSON.stringify(r.diagnostics));
  assert.deepEqual(r.artifact.resolutions, [
    { local: 'computed', source: 'obix', imported: 'computed', primitive: { module: 'vue', export: 'computed' } },
    { local: 'ref', source: 'obix', imported: 'ref', primitive: { module: 'vue', export: 'ref' } },
  ]);
  assert.ok(Object.isFrozen(r.artifact.resolutions) && r.artifact.resolutions.every(Object.isFrozen));
});

test('the same names imported from "vue" resolve to the same primitives — the later stages see one primitive, from either module', () => {
  const fromObix = compileObixScriptSetup(sfc(FIXTURE)).artifact.resolutions.map((x) => [x.local, x.primitive]);
  const fromVue = compileObixScriptSetup(sfc(vueTwin, 'CounterFromVue.obix')).artifact.resolutions.map((x) => [x.local, x.primitive]);
  assert.deepEqual(fromObix, fromVue);
});

test('nothing the official compiler said changes: the imports as written, the compiled script with its "obix" import, the binding metadata', () => {
  const r = compileObixScriptSetup(sfc(FIXTURE));
  assert.deepEqual(r.artifact.imports.map((i) => [i.local, i.imported, i.source]), [['computed', 'computed', 'obix'], ['ref', 'ref', 'obix']]);
  assert.match(r.artifact.content, /import \{ computed, ref \} from "obix"/);
  // the official compiler cannot see the alias, and says so in its own binding kinds — the frontend adds its resolution beside them, never over them
  assert.equal(r.artifact.bindings.count, 'setup-maybe-ref');
  assert.equal(r.artifact.bindings.doubled, 'setup-maybe-ref');
});

test('a renamed import resolves by the name it imports; a type-only import resolves to nothing', () => {
  const r = compileObixScriptSetup(sfc('<script setup lang="ts">\nimport { ref as r, computed as c } from "obix";\nimport type { Ref } from "obix";\nconst n = r(0);\nconst d = c(() => n.value);\n</script>\n'));
  assert.deepEqual(r.artifact.resolutions, [
    { local: 'r', source: 'obix', imported: 'ref', primitive: { module: 'vue', export: 'ref' } },
    { local: 'c', source: 'obix', imported: 'computed', primitive: { module: 'vue', export: 'computed' } },
    { local: 'Ref', source: 'obix', imported: 'Ref', primitive: null },
  ]);
});

test('no blanket rule: a name from "obix" that the registry does not list is an unregistered authoring name — even one Vue exports; other modules resolve to nothing', () => {
  const r = compileObixScriptSetup(
    sfc('<script setup>\nimport { watch, reactive, defineTuner } from "obix";\nimport { watch as vueWatch } from "vue";\nimport Child from "./Child.vue";\nimport { helper } from "./helper";\n</script>\n'),
  );
  assert.deepEqual(r.artifact.resolutions.map((x) => [x.local, x.primitive]), [
    ['watch', 'unregistered-authoring'],
    ['reactive', 'unregistered-authoring'],
    ['defineTuner', 'unregistered-authoring'],
    ['vueWatch', { module: 'vue', export: 'watch' }],
    ['Child', null],
    ['helper', null],
  ]);
});

test('the edges of an import: a namespace or default import of "vue" is no primitive; an inline `type` specifier is a type; a string-named import resolves by its name', () => {
  const r = compileObixScriptSetup(
    sfc('<script setup lang="ts">\nimport * as Vue from "vue";\nimport vueDefault from "vue";\nimport { type Ref, "ref" as r } from "obix";\nimport * as O from "obix";\nconst n = r(0);\n</script>\n'),
  );
  assert.equal(r.status, 'compiled', JSON.stringify(r.diagnostics));
  assert.deepEqual(r.artifact.resolutions.map((x) => [x.local, x.imported, x.primitive]), [
    ['Vue', '*', null],
    ['vueDefault', 'default', null],
    ['Ref', 'Ref', null],
    ['r', 'ref', { module: 'vue', export: 'ref' }],
    ['O', '*', 'unregistered-authoring'],
  ]);
});

test('the blocks in the order of the file: a <script setup> written before the normal <script> is resolved first', () => {
  const r = compileObixScriptSetup(sfc('<script setup>\nimport { computed } from "obix";\n</script>\n<script>\nimport { ref } from "obix";\nexport default { name: "Both" };\n</script>\n'));
  assert.equal(r.status, 'compiled', JSON.stringify(r.diagnostics));
  assert.deepEqual(r.artifact.resolutions.map((x) => x.local), ['computed', 'ref']);
  const after = compileObixScriptSetup(sfc('<script>\nimport { ref } from "obix";\nexport default { name: "Both" };\n</script>\n<script setup>\nimport { computed } from "obix";\n</script>\n'));
  assert.deepEqual(after.artifact.resolutions.map((x) => x.local), ['ref', 'computed']);
});

test('only imports bind: a re-export from "obix" or "vue" is no binding of the component, and resolves nothing', () => {
  const r = compileObixScript(sfc('<script>\nexport { ref } from "obix";\nexport { computed } from "vue";\nexport default { name: "Reexports" };\n</script>\n'));
  assert.equal(r.status, 'compiled', JSON.stringify(r.diagnostics));
  assert.deepEqual(r.artifact.resolutions, []);
});

test('the normal <script> resolves its imports the same way — the resolution belongs to the frontend’s shared import boundary, not to one stage', () => {
  const r = compileObixScript(sfc('<script>\nimport { ref } from "obix";\nexport default { setup() { return { n: ref(0) }; } };\n</script>\n'));
  assert.equal(r.status, 'compiled', JSON.stringify(r.diagnostics));
  assert.deepEqual(r.artifact.resolutions, [{ local: 'ref', source: 'obix', imported: 'ref', primitive: { module: 'vue', export: 'ref' } }]);
});

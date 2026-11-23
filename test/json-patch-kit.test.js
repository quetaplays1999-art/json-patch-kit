import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

import {
  JsonPatchError,
  JsonPointerError,
  applyPatch,
  compilePointer,
  createPatch,
  deepEqual,
  escapeToken,
  getPointer,
  hasPointer,
  mergePatch,
  parsePointer,
  removePointer,
  setPointer,
  unescapeToken,
  validatePatch,
} from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const CLI_PATH = resolve(__dirname, '..', 'bin', 'json-patch-kit.js');
const PKG = JSON.parse(readFileSync(resolve(__dirname, '..', 'package.json'), 'utf8'));

describe('RFC 6901 JSON Pointer', () => {
  const rfcDoc = {
    foo: ['bar', 'baz'],
    '': 0,
    'a/b': 1,
    'c%d': 2,
    'e^f': 3,
    'g|h': 4,
    'i\\j': 5,
    'k"l': 6,
    ' ': 7,
    'm~n': 8,
  };

  it('evaluates all RFC 6901 Section 5 examples', () => {
    assert.deepEqual(getPointer(rfcDoc, ''), rfcDoc);
    assert.deepEqual(getPointer(rfcDoc, '/foo'), ['bar', 'baz']);
    assert.equal(getPointer(rfcDoc, '/foo/0'), 'bar');
    assert.equal(getPointer(rfcDoc, '/'), 0);
    assert.equal(getPointer(rfcDoc, '/a~1b'), 1);
    assert.equal(getPointer(rfcDoc, '/c%d'), 2);
    assert.equal(getPointer(rfcDoc, '/e^f'), 3);
    assert.equal(getPointer(rfcDoc, '/g|h'), 4);
    assert.equal(getPointer(rfcDoc, '/i\\j'), 5);
    assert.equal(getPointer(rfcDoc, '/k"l'), 6);
    assert.equal(getPointer(rfcDoc, '/ '), 7);
    assert.equal(getPointer(rfcDoc, '/m~0n'), 8);
  });

  it('handles escaping, unescaping, parsing, and compiling round-trips', () => {
    assert.equal(escapeToken('a/b~c'), 'a~1b~0c');
    assert.equal(unescapeToken('a~1b~0c'), 'a/b~c');
    assert.equal(unescapeToken('~01'), '~1');
    assert.equal(escapeToken('~1'), '~01');

    const tokens = ['users', 'a/b', 'm~n', '', '0'];
    const ptr = compilePointer(tokens);
    assert.equal(ptr, '/users/a~1b/m~0n//0');
    assert.deepEqual(parsePointer(ptr), tokens);
    assert.equal(compilePointer([]), '');
    assert.deepEqual(parsePointer(''), []);
  });

  it('rejects malformed pointers and invalid array indices', () => {
    assert.throws(() => parsePointer('foo'), { name: 'JsonPointerError', code: 'INVALID_POINTER' });
    assert.throws(() => parsePointer('/a~2b'), { name: 'JsonPointerError', code: 'INVALID_ESCAPE' });
    assert.throws(() => parsePointer('/a~'), { name: 'JsonPointerError', code: 'INVALID_ESCAPE' });
    assert.throws(() => getPointer(rfcDoc, '/foo/01'), { name: 'JsonPointerError', code: 'INVALID_ARRAY_INDEX' });
    assert.throws(() => getPointer(rfcDoc, '/foo/-1'), { name: 'JsonPointerError', code: 'INVALID_ARRAY_INDEX' });
    assert.throws(() => getPointer(rfcDoc, '/foo/2'), { name: 'JsonPointerError', code: 'INDEX_OUT_OF_BOUNDS' });
    assert.throws(() => getPointer(rfcDoc, '/foo/-'), { name: 'JsonPointerError', code: 'NONEXISTENT_TARGET' });
    assert.throws(() => getPointer(rfcDoc, '/missing'), { name: 'JsonPointerError', code: 'NONEXISTENT_TARGET' });
    assert.throws(() => getPointer(rfcDoc, '/toString'), { name: 'JsonPointerError', code: 'NONEXISTENT_TARGET' });
  });

  it('supports hasPointer including null values', () => {
    const doc = { a: null, b: [10] };
    assert.equal(hasPointer(doc, ''), true);
    assert.equal(hasPointer(doc, '/a'), true);
    assert.equal(hasPointer(doc, '/b/0'), true);
    assert.equal(hasPointer(doc, '/b/1'), false);
    assert.equal(hasPointer(doc, '/b/-'), false);
    assert.equal(hasPointer(doc, '/missing'), false);
    assert.throws(() => hasPointer(doc, 'invalid'), JsonPointerError);
  });

  it('supports immutable setPointer and removePointer', () => {
    const orig = { user: { name: 'Ada' }, tags: ['a', 'b'] };

    const updated = setPointer(orig, '/user/name', 'Grace');
    assert.deepEqual(updated, { user: { name: 'Grace' }, tags: ['a', 'b'] });
    assert.equal(orig.user.name, 'Ada');

    const appended = setPointer(orig, '/tags/-', 'c');
    assert.deepEqual(appended.tags, ['a', 'b', 'c']);
    assert.deepEqual(orig.tags, ['a', 'b']);

    const replacedElem = setPointer(orig, '/tags/1', 'z');
    assert.deepEqual(replacedElem.tags, ['a', 'z']);

    const replacedRoot = setPointer(orig, '', [1, 2, 3]);
    assert.deepEqual(replacedRoot, [1, 2, 3]);

    const removedKey = removePointer(orig, '/user/name');
    assert.deepEqual(removedKey, { user: {}, tags: ['a', 'b'] });
    assert.equal(orig.user.name, 'Ada');

    const removedArr = removePointer(orig, '/tags/0');
    assert.deepEqual(removedArr.tags, ['b']);

    assert.throws(() => removePointer(orig, ''), { name: 'JsonPointerError', code: 'INVALID_OPERATION' });
    assert.throws(() => removePointer(orig, '/tags/-'), { name: 'JsonPointerError', code: 'NONEXISTENT_TARGET' });
  });

  it('prevents prototype pollution on __proto__ pointer writes', () => {
    const doc = {};
    const out = setPointer(doc, '/__proto__', { polluted: true });
    assert.equal(({}).polluted, undefined);
    assert.equal(Object.hasOwn(out, '__proto__'), true);
    assert.deepEqual(getPointer(out, '/__proto__'), { polluted: true });
  });
});

describe('RFC 6902 JSON Patch', () => {
  it('passes RFC 6902 Appendix A examples', () => {
    // A.1 Adding an Object Member
    assert.deepEqual(
      applyPatch({ foo: 'bar' }, [{ op: 'add', path: '/baz', value: 'qux' }]),
      { foo: 'bar', baz: 'qux' }
    );

    // A.2 Adding an Array Element
    assert.deepEqual(
      applyPatch({ foo: ['bar', 'baz'] }, [{ op: 'add', path: '/foo/1', value: 'qux' }]),
      { foo: ['bar', 'qux', 'baz'] }
    );

    // A.3 Removing an Object Member
    assert.deepEqual(
      applyPatch({ baz: 'qux', foo: 'bar' }, [{ op: 'remove', path: '/baz' }]),
      { foo: 'bar' }
    );

    // A.4 Removing an Array Element
    assert.deepEqual(
      applyPatch({ foo: ['bar', 'qux', 'baz'] }, [{ op: 'remove', path: '/foo/1' }]),
      { foo: ['bar', 'baz'] }
    );

    // A.5 Replacing a Value
    assert.deepEqual(
      applyPatch({ baz: 'qux', foo: 'bar' }, [{ op: 'replace', path: '/baz', value: 'boo' }]),
      { baz: 'boo', foo: 'bar' }
    );

    // A.6 Moving a Value
    assert.deepEqual(
      applyPatch(
        { foo: { bar: 'baz', waldo: 'fred' }, qux: { corge: 'grault' } },
        [{ op: 'move', from: '/foo/waldo', path: '/qux/thud' }]
      ),
      { foo: { bar: 'baz' }, qux: { corge: 'grault', thud: 'fred' } }
    );

    // A.7 Moving an Array Element
    assert.deepEqual(
      applyPatch(
        { foo: ['all', 'grass', 'cows', 'eat'] },
        [{ op: 'move', from: '/foo/1', path: '/foo/3' }]
      ),
      { foo: ['all', 'cows', 'eat', 'grass'] }
    );

    // A.8 Testing a Value: Success
    assert.deepEqual(
      applyPatch(
        { baz: 'qux', foo: ['a', 2, 'c'] },
        [
          { op: 'test', path: '/baz', value: 'qux' },
          { op: 'test', path: '/foo/1', value: 2 },
        ]
      ),
      { baz: 'qux', foo: ['a', 2, 'c'] }
    );

    // A.9 Testing a Value: Error
    assert.throws(
      () => applyPatch({ baz: 'qux' }, [{ op: 'test', path: '/baz', value: 'bar' }]),
      { name: 'JsonPatchError', code: 'TEST_FAILED', index: 0 }
    );

    // A.10 Adding a Nested Member Object
    assert.deepEqual(
      applyPatch({ foo: 'bar' }, [{ op: 'add', path: '/child', value: { grandchild: {} } }]),
      { foo: 'bar', child: { grandchild: {} } }
    );

    // A.11 Ignoring Unrecognized Elements
    assert.deepEqual(
      applyPatch({ foo: 'bar' }, [{ op: 'add', path: '/baz', value: 'qux', xyz: 123 }]),
      { foo: 'bar', baz: 'qux' }
    );

    // A.12 Adding to a Nonexistent Target
    assert.throws(
      () => applyPatch({ foo: 'bar' }, [{ op: 'add', path: '/baz/bat', value: 'qux' }]),
      { name: 'JsonPatchError', code: 'NONEXISTENT_TARGET' }
    );

    // A.14 ~ Escape Ordering
    assert.deepEqual(
      applyPatch({ '/': 9, '~1': 10 }, [{ op: 'test', path: '/~01', value: 10 }]),
      { '/': 9, '~1': 10 }
    );

    // A.15 Comparing Strings and Numbers
    assert.throws(
      () => applyPatch({ '/': 9, '~1': 10 }, [{ op: 'test', path: '/~01', value: '10' }]),
      { name: 'JsonPatchError', code: 'TEST_FAILED' }
    );

    // A.16 Adding an Array Value with "-"
    assert.deepEqual(
      applyPatch({ foo: ['bar'] }, [{ op: 'add', path: '/foo/-', value: ['abc', 'def'] }]),
      { foo: ['bar', ['abc', 'def']] }
    );
  });

  it('applies patches atomically without mutating original input on success or failure', () => {
    const doc = { a: 1, nested: { list: [1, 2] } };
    const snapshot = structuredClone(doc);

    assert.throws(
      () =>
        applyPatch(doc, [
          { op: 'replace', path: '/a', value: 2 },
          { op: 'add', path: '/nested/list/-', value: 3 },
          { op: 'test', path: '/a', value: 999 },
        ]),
      (err) => err instanceof JsonPatchError && err.index === 2 && err.code === 'TEST_FAILED'
    );

    assert.deepEqual(doc, snapshot);
  });

  it('supports copy, root operations, and rejects invalid move prefixes', () => {
    const doc = { a: { x: [1, 2] } };
    const copied = applyPatch(doc, [
      { op: 'copy', from: '/a', path: '/b' },
      { op: 'add', path: '/b/x/-', value: 3 },
    ]);
    assert.deepEqual(copied, { a: { x: [1, 2] }, b: { x: [1, 2, 3] } });

    // Move subtree to root
    assert.deepEqual(
      applyPatch({ a: { ok: true }, b: 2 }, [{ op: 'move', from: '/a', path: '' }]),
      { ok: true }
    );

    // Self-move is a no-op when target exists
    assert.deepEqual(
      applyPatch({ a: 1 }, [{ op: 'move', from: '/a', path: '/a' }]),
      { a: 1 }
    );

    // Proper prefix move must fail
    assert.throws(
      () => applyPatch({ a: { b: 1 } }, [{ op: 'move', from: '/a', path: '/a/b' }]),
      { name: 'JsonPatchError', code: 'INVALID_MOVE' }
    );
    assert.throws(
      () => applyPatch({ a: 1 }, [{ op: 'move', from: '', path: '/a' }]),
      { name: 'JsonPatchError', code: 'INVALID_MOVE' }
    );
  });

  it('validates patch structures via validatePatch', () => {
    assert.deepEqual(
      validatePatch([
        { op: 'add', path: '/a', value: 1 },
        { op: 'move', from: '/a', path: '/b' },
      ]),
      { valid: true, errors: [] }
    );

    const invalid = validatePatch([
      { op: 'unknown', path: '/a' },
      { op: 'add', path: 'no-slash' },
      { op: 'move', from: '/a', path: '/a/b' },
    ]);
    assert.equal(invalid.valid, false);
    assert.ok(invalid.errors.length >= 3);
  });

  it('handles deepEqual edge cases accurately', () => {
    assert.equal(deepEqual({ a: 1, b: 2 }, { b: 2, a: 1 }), true);
    assert.equal(deepEqual(0, -0), true);
    assert.equal(deepEqual([1, 2], [1, 2, 3]), false);
    assert.equal(deepEqual(null, {}), false);
    assert.equal(deepEqual([], {}), false);
  });
});

describe('createPatch diff generator', () => {
  it('returns empty patch for equal documents', () => {
    assert.deepEqual(createPatch({ a: [1, { b: true }] }, { a: [1, { b: true }] }), []);
  });

  it('produces minimal patches for objects, escaped keys, and nested arrays', () => {
    const src = {
      'a/b': 1,
      'm~n': 'old',
      removeMe: true,
      items: [
        { id: 1, label: 'alpha' },
        { id: 2, label: 'beta' },
      ],
    };
    const tgt = {
      'a/b': 1,
      'm~n': 'new',
      added: [10, 20],
      items: [
        { id: 1, label: 'alpha' },
        { id: 2, label: 'BETA' },
        { id: 3, label: 'gamma' },
      ],
    };

    const patch = createPatch(src, tgt);
    assert.equal(validatePatch(patch).valid, true);
    assert.ok(patch.some((op) => op.op === 'replace' && op.path === '/items/1/label'));
    assert.ok(patch.some((op) => op.op === 'add' && op.path === '/items/-'));
    assert.deepEqual(applyPatch(src, patch), tgt);
  });

  it('satisfies applyPatch(source, createPatch(source, target)) === target across complex cases', () => {
    const cases = [
      [{ a: 1 }, { a: 2 }],
      [[1, 2, 3, 4], [1, 99, 2, 3, 4]],
      [[1, 2, 3, 4], [2, 4]],
      [['a', 'b', 'c', 'd'], ['x', 'b', 'y', 'z', 'd', 'w']],
      [[], [1, 2, 3]],
      [[1, 2, 3], []],
      [{ a: [1, 2] }, [1, 2]],
      ['hello', { nested: [null, false, 0, ''] }],
      [null, 42],
      [{ '': 'root-key', '/': 'slash', '~': 'tilde' }, { '': 'updated', '~1': 'x' }],
    ];

    for (const [source, target] of cases) {
      const sourceCopy = structuredClone(source);
      const targetCopy = structuredClone(target);
      const patch = createPatch(source, target);
      const patched = applyPatch(source, patch);
      assert.deepEqual(patched, target);
      assert.deepEqual(source, sourceCopy);
      assert.deepEqual(target, targetCopy);
    }
  });
});

describe('RFC 7396 JSON Merge Patch', () => {
  it('passes all 15 official RFC 7396 Appendix A test cases', () => {
    const cases = [
      [{ a: 'b' }, { a: 'c' }, { a: 'c' }],
      [{ a: 'b' }, { b: 'c' }, { a: 'b', b: 'c' }],
      [{ a: 'b' }, { a: null }, {}],
      [{ a: 'b', b: 'c' }, { a: null }, { b: 'c' }],
      [{ a: ['b'] }, { a: 'c' }, { a: 'c' }],
      [{ a: 'c' }, { a: ['b'] }, { a: ['b'] }],
      [{ a: { b: 'c' } }, { a: { b: 'd', c: null } }, { a: { b: 'd' } }],
      [{ a: [{ b: 'c' }] }, { a: [1] }, { a: [1] }],
      [['a', 'b'], ['c', 'd'], ['c', 'd']],
      [{ a: 'b' }, ['c'], ['c']],
      [{ a: 'foo' }, null, null],
      [{ a: 'foo' }, 'bar', 'bar'],
      [{ e: null }, { a: 1 }, { e: null, a: 1 }],
      [[1, 2], { a: 'b', c: null }, { a: 'b' }],
      [{}, { a: { bb: { ccc: null } } }, { a: { bb: {} } }],
    ];

    for (const [target, patch, expected] of cases) {
      const targetSnapshot = structuredClone(target);
      const patchSnapshot = structuredClone(patch);
      assert.deepEqual(mergePatch(target, patch), expected);
      assert.deepEqual(target, targetSnapshot);
      assert.deepEqual(patch, patchSnapshot);
    }
  });

  it('prevents prototype pollution during mergePatch', () => {
    const patch = JSON.parse('{"__proto__": {"pollutedMerge": true}}');
    const result = mergePatch({}, patch);
    assert.equal(({}).pollutedMerge, undefined);
    assert.equal(Object.hasOwn(result, '__proto__'), true);
  });
});

describe('CLI (bin/json-patch-kit.js)', () => {
  function runCli(args, options = {}) {
    return execFileSync(process.execPath, [CLI_PATH, ...args], {
      encoding: 'utf8',
      ...options,
    });
  }

  it('supports --version and --help', () => {
    assert.equal(runCli(['--version']).trim(), PKG.version);
    const help = runCli(['--help']);
    assert.match(help, /json-patch-kit/);
    assert.match(help, /diff <a\.json> <b\.json>/);
    assert.match(help, /apply <doc\.json> <patch\.json>/);
    assert.match(help, /merge <doc\.json> <merge\.json>/);
    assert.match(help, /get <doc\.json> <pointer>/);
  });

  it('runs diff, apply, merge, get, stdin, --compact, and --output end-to-end', () => {
    const dir = mkdtempSync(join(tmpdir(), 'json-patch-kit-test-'));
    try {
      const aPath = join(dir, 'a.json');
      const bPath = join(dir, 'b.json');
      const patchPath = join(dir, 'patch.json');
      const mergePath = join(dir, 'merge.json');
      const outPath = join(dir, 'out.json');

      const docA = { name: 'app', version: 1, 'a/b': 'slash', tags: ['v1'] };
      const docB = { name: 'app', version: 2, 'a/b': 'slash', tags: ['v1', 'v2'] };
      const mergeDoc = { version: 3, tags: null, active: true };

      writeFileSync(aPath, JSON.stringify(docA, null, 2));
      writeFileSync(bPath, JSON.stringify(docB, null, 2));
      writeFileSync(mergePath, JSON.stringify(mergeDoc, null, 2));

      // diff -> file
      runCli(['diff', aPath, bPath, '--output', patchPath]);
      const generatedPatch = JSON.parse(readFileSync(patchPath, 'utf8'));
      assert.ok(Array.isArray(generatedPatch) && generatedPatch.length > 0);

      // apply -> stdout compact
      const appliedOut = runCli(['apply', aPath, patchPath, '--compact']);
      assert.equal(appliedOut.trim(), JSON.stringify(docB));

      // merge -> file
      runCli(['merge', aPath, mergePath, '-o', outPath]);
      assert.deepEqual(JSON.parse(readFileSync(outPath, 'utf8')), {
        name: 'app',
        version: 3,
        'a/b': 'slash',
        active: true,
      });

      // get with escaped pointer and root pointer
      assert.equal(JSON.parse(runCli(['get', aPath, '/a~1b'])), 'slash');
      assert.deepEqual(JSON.parse(runCli(['get', aPath, ''])), docA);

      // get from stdin
      const stdinResult = runCli(['get', '-', '/tags/0'], {
        input: JSON.stringify(docA),
      });
      assert.equal(JSON.parse(stdinResult), 'v1');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('exits with code 1 and writes helpful message to stderr on errors', () => {
    assert.throws(
      () => runCli(['unknown-cmd'], { stdio: ['ignore', 'pipe', 'pipe'] }),
      (err) => err.status === 1 && /Unknown command/.test(String(err.stderr))
    );

    assert.throws(
      () => runCli(['get', '-', '/missing'], { input: '{"a":1}', stdio: ['pipe', 'pipe', 'pipe'] }),
      (err) => err.status === 1 && /does not exist/.test(String(err.stderr))
    );
  });
});

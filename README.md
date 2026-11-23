# json-patch-kit

[![CI](https://github.com/quetaplays1999-art/json-patch-kit/actions/workflows/ci.yml/badge.svg)](https://github.com/quetaplays1999-art/json-patch-kit/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-%3E%3D18.18.0-brightgreen.svg)](https://nodejs.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](./LICENSE)

A zero-dependency Node.js ESM library and CLI for working with JSON documents using standard IETF specifications:

- **RFC 6901** — JSON Pointer (`parsePointer`, `compilePointer`, `escapeToken`, `unescapeToken`, `hasPointer`, `getPointer`, `setPointer`, `removePointer`)
- **RFC 6902** — Atomic JSON Patch (`applyPatch`, `validatePatch`, `deepEqual`) + minimal diff generator (`createPatch`)
- **RFC 7396** — JSON Merge Patch (`mergePatch`)

## Features

- **Zero dependencies** — Pure ESM JavaScript built on standard Node.js APIs (`>=18.18.0`)
- **Immutable & atomic** — Never mutates input documents; failed patches leave the original document untouched
- **Smart array diffing** — Uses prefix/suffix trimming + LCS matching to emit minimal, idiomatic patches
- **Prototype-pollution safe** — Safely handles `__proto__` keys and checks own properties exclusively
- **TypeScript declarations included** — Full `.d.ts` definitions out of the box
- **Ready-to-use CLI** — `diff`, `apply`, `merge`, and `get` commands with stdin (`-`), `--compact`, and `--output` support

## Installation

```bash
npm install json-patch-kit
```

Or install globally / invoke via `npx` for the CLI:

```bash
npx json-patch-kit --help
```

## CLI Usage

```text
json-patch-kit diff <a.json> <b.json> [options]        Generate RFC 6902 JSON Patch from A to B
json-patch-kit apply <doc.json> <patch.json> [options] Apply RFC 6902 JSON Patch to a document
json-patch-kit merge <doc.json> <merge.json> [options] Apply RFC 7396 JSON Merge Patch to a document
json-patch-kit get <doc.json> <pointer> [options]      Read a value using RFC 6901 JSON Pointer
```

### Options

- `-c, --compact` — Output compact single-line JSON (default is 2-space pretty-printed JSON)
- `-o, --output <file>` — Write output to a file instead of stdout
- `-h, --help` — Show help message
- `-v, --version` — Print version number

### CLI Examples

```bash
# Generate a patch between two JSON files
json-patch-kit diff old.json new.json --output changes.patch.json

# Apply an RFC 6902 JSON Patch
json-patch-kit apply old.json changes.patch.json --output updated.json

# Apply an RFC 7396 JSON Merge Patch
json-patch-kit merge config.json overrides.json --compact

# Read a nested value using an RFC 6901 JSON Pointer
json-patch-kit get package.json /scripts/test

# Read JSON from stdin using "-"
cat package.json | json-patch-kit get - /name
```

## JavaScript / TypeScript API

### RFC 6901 — JSON Pointer

```js
import {
  getPointer,
  hasPointer,
  setPointer,
  removePointer,
  parsePointer,
  compilePointer,
} from 'json-patch-kit';

const doc = {
  users: [{ name: 'Ada' }],
  'a/b': 1,
  'm~n': 2,
};

getPointer(doc, '/users/0/name'); // 'Ada'
getPointer(doc, '/a~1b');         // 1
getPointer(doc, '/m~0n');         // 2
hasPointer(doc, '/missing');      // false

// Immutable updates (original `doc` is unchanged)
const updated = setPointer(doc, '/users/-', { name: 'Grace' });
const trimmed = removePointer(updated, '/users/0');

parsePointer('/a~1b/m~0n');       // ['a/b', 'm~n']
compilePointer(['a/b', 'm~n']);   // '/a~1b/m~0n'
```

### RFC 6902 — JSON Patch & Diff Generator

```js
import { applyPatch, createPatch, validatePatch } from 'json-patch-kit';

const source = {
  title: 'Draft',
  tags: ['json', 'node'],
  meta: { version: 1 },
};

const target = {
  title: 'Published',
  tags: ['json', 'esm', 'node'],
  meta: { version: 2 },
};

// Generate a minimal RFC 6902 patch
const patch = createPatch(source, target);

// Validate patch structure before applying
const { valid, errors } = validatePatch(patch);

// Atomically apply the patch (does not mutate `source`)
const result = applyPatch(source, patch);
```

Supported RFC 6902 operations: `add`, `remove`, `replace`, `move`, `copy`, `test`.

### RFC 7396 — JSON Merge Patch

```js
import { mergePatch } from 'json-patch-kit';

const base = {
  title: 'Goodbye!',
  author: {
    givenName: 'John',
    familyName: 'Doe',
  },
  tags: ['example', 'sample'],
};

const merged = mergePatch(base, {
  title: 'Hello!',
  author: {
    familyName: null, // removes `familyName`
  },
  tags: ['example'],  // replaces array
});
```

## Running Tests

```bash
npm test
```

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before opening a pull request.

## License

[MIT](./LICENSE) © 2026 quetaplays1999-art

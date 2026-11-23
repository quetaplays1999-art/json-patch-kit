# Contributing to `json-patch-kit`

Thank you for considering contributing to `json-patch-kit`!

## Guiding Principles

- **Zero dependencies**: Keep runtime and development dependencies at zero, using only built-in Node.js modules (`node:test`, `node:assert`, `node:fs`, etc.).
- **RFC compliance**: Follow RFC 6901 (JSON Pointer), RFC 6902 (JSON Patch), and RFC 7396 (JSON Merge Patch) strictly.
- **Immutability & safety**: Public functions must never mutate caller inputs and must guard against prototype pollution.
- **ESM & TypeScript parity**: Keep `src/index.d.ts` in sync with every public export in `src/index.js`.

## Local Development

1. Fork and clone the repository:
   ```bash
   git clone https://github.com/quetaplays1999-art/json-patch-kit.git
   cd json-patch-kit
   ```
2. Ensure you are running Node.js `>=18.18.0`:
   ```bash
   node -v
   ```
3. Run the full test suite:
   ```bash
   npm test
   ```

## Submitting a Pull Request

1. Create a focused branch from `main` (e.g., `fix/pointer-escape` or `feat/cli-flag`).
2. Add or update unit/CLI tests in `test/json-patch-kit.test.js` covering your changes and edge cases.
3. Update `src/index.d.ts` and `README.md` if you change any public API or CLI behavior.
4. Confirm `npm test` passes with zero failures.
5. Open a pull request describing the motivation, behavior change, and any relevant RFC section references.

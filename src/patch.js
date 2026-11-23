/**
 * RFC 6902 JSON Patch, diff generation, and RFC 7396 JSON Merge Patch.
 * @module json-patch-kit/patch
 */

import {
  JsonPointerError,
  cloneJson,
  compilePointer,
  escapeToken,
  getPointer,
  isPlainObject,
  parseArrayIndex,
  parsePointer,
  setOwnProperty,
} from './pointer.js';

const VALID_OPS = new Set(['add', 'remove', 'replace', 'move', 'copy', 'test']);
const MAX_LCS_CELLS = 100_000;

/**
 * Error thrown when validating or applying an RFC 6902 JSON Patch fails.
 */
export class JsonPatchError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   * @param {number} [index]
   * @param {unknown} [operation]
   */
  constructor(message, code, index, operation) {
    super(message);
    this.name = 'JsonPatchError';
    this.code = code;
    if (index !== undefined) {
      this.index = index;
    }
    if (operation !== undefined) {
      this.operation = operation;
    }
  }
}

/**
 * RFC 6902 Section 4.6 JSON value equality.
 * @param {unknown} a
 * @param {unknown} b
 * @returns {boolean}
 */
export function deepEqual(a, b) {
  if (a === b) {
    return true;
  }
  if (typeof a === 'number' && typeof b === 'number') {
    return Number.isNaN(a) && Number.isNaN(b);
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    return false;
  }
  if (Array.isArray(a)) {
    if (!Array.isArray(b) || a.length !== b.length) {
      return false;
    }
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) {
        return false;
      }
    }
    return true;
  }
  if (Array.isArray(b)) {
    return false;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) {
    return false;
  }
  for (const key of keysA) {
    if (!Object.hasOwn(b, key)) {
      return false;
    }
    if (!deepEqual(/** @type {Record<string, unknown>} */ (a)[key], /** @type {Record<string, unknown>} */ (b)[key])) {
      return false;
    }
  }
  return true;
}

/**
 * Check whether `fromTokens` is a proper prefix of `pathTokens`.
 * Per RFC 6902 Section 4.4, `from` must not be a proper prefix of `path`.
 * @param {string[]} fromTokens
 * @param {string[]} pathTokens
 * @returns {boolean}
 */
function isProperPrefix(fromTokens, pathTokens) {
  if (fromTokens.length >= pathTokens.length) {
    return false;
  }
  for (let i = 0; i < fromTokens.length; i++) {
    if (fromTokens[i] !== pathTokens[i]) {
      return false;
    }
  }
  return true;
}

/**
 * Resolve parent container for mutable internal patch execution.
 * @param {unknown} root
 * @param {string[]} tokens
 * @param {string} pointer
 * @param {number} index
 * @param {unknown} operation
 * @returns {unknown}
 */
function resolveMutableParent(root, tokens, pointer, index, operation) {
  let current = root;
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i];
    if (Array.isArray(current)) {
      if (token === '-') {
        throw new JsonPatchError(
          `Operation ${index}: cannot traverse past "-" in path "${pointer}"`,
          'NONEXISTENT_TARGET',
          index,
          operation
        );
      }
      const idx = parseArrayIndex(token);
      if (idx < 0 || idx >= current.length) {
        throw new JsonPatchError(
          `Operation ${index}: invalid or out-of-bounds array index "${token}" in path "${pointer}"`,
          idx < 0 ? 'INVALID_ARRAY_INDEX' : 'INDEX_OUT_OF_BOUNDS',
          index,
          operation
        );
      }
      current = current[idx];
    } else if (isPlainObject(current)) {
      if (!Object.hasOwn(current, token)) {
        throw new JsonPatchError(
          `Operation ${index}: parent path segment "${token}" does not exist in "${pointer}"`,
          'NONEXISTENT_TARGET',
          index,
          operation
        );
      }
      current = current[token];
    } else {
      throw new JsonPatchError(
        `Operation ${index}: cannot traverse non-container at "${token}" in "${pointer}"`,
        'NONEXISTENT_TARGET',
        index,
        operation
      );
    }
  }
  return current;
}

/**
 * Apply an RFC 6902 `add` operation in place on a cloned document.
 * @param {unknown} doc
 * @param {string[]} tokens
 * @param {string} pointer
 * @param {unknown} value
 * @param {number} index
 * @param {unknown} operation
 * @returns {unknown}
 */
function execAdd(doc, tokens, pointer, value, index, operation) {
  const cloned = cloneJson(value);
  if (tokens.length === 0) {
    return cloned;
  }
  const parent = resolveMutableParent(doc, tokens, pointer, index, operation);
  const last = tokens[tokens.length - 1];

  if (Array.isArray(parent)) {
    if (last === '-') {
      parent.push(cloned);
      return doc;
    }
    const idx = parseArrayIndex(last);
    if (idx < 0) {
      throw new JsonPatchError(
        `Operation ${index}: invalid array index "${last}" in path "${pointer}"`,
        'INVALID_ARRAY_INDEX',
        index,
        operation
      );
    }
    if (idx > parent.length) {
      throw new JsonPatchError(
        `Operation ${index}: array index ${idx} exceeds array length ${parent.length} in path "${pointer}"`,
        'INDEX_OUT_OF_BOUNDS',
        index,
        operation
      );
    }
    parent.splice(idx, 0, cloned);
    return doc;
  }

  if (isPlainObject(parent)) {
    setOwnProperty(parent, last, cloned);
    return doc;
  }

  throw new JsonPatchError(
    `Operation ${index}: cannot add "${last}" to non-container target at "${pointer}"`,
    'NONEXISTENT_TARGET',
    index,
    operation
  );
}

/**
 * Apply an RFC 6902 `remove` operation in place on a cloned document and return removed value.
 * @param {unknown} doc
 * @param {string[]} tokens
 * @param {string} pointer
 * @param {number} index
 * @param {unknown} operation
 * @returns {unknown}
 */
function execRemove(doc, tokens, pointer, index, operation) {
  if (tokens.length === 0) {
    throw new JsonPatchError(
      `Operation ${index}: cannot remove root document`,
      'INVALID_OPERATION',
      index,
      operation
    );
  }
  const parent = resolveMutableParent(doc, tokens, pointer, index, operation);
  const last = tokens[tokens.length - 1];

  if (Array.isArray(parent)) {
    if (last === '-') {
      throw new JsonPatchError(
        `Operation ${index}: cannot remove nonexistent "-" element in path "${pointer}"`,
        'NONEXISTENT_TARGET',
        index,
        operation
      );
    }
    const idx = parseArrayIndex(last);
    if (idx < 0) {
      throw new JsonPatchError(
        `Operation ${index}: invalid array index "${last}" in path "${pointer}"`,
        'INVALID_ARRAY_INDEX',
        index,
        operation
      );
    }
    if (idx >= parent.length) {
      throw new JsonPatchError(
        `Operation ${index}: array index ${idx} out of bounds in path "${pointer}"`,
        'INDEX_OUT_OF_BOUNDS',
        index,
        operation
      );
    }
    return parent.splice(idx, 1)[0];
  }

  if (isPlainObject(parent)) {
    if (!Object.hasOwn(parent, last)) {
      throw new JsonPatchError(
        `Operation ${index}: target property "${last}" does not exist at "${pointer}"`,
        'NONEXISTENT_TARGET',
        index,
        operation
      );
    }
    const removed = parent[last];
    delete parent[last];
    return removed;
  }

  throw new JsonPatchError(
    `Operation ${index}: cannot remove "${last}" from non-container at "${pointer}"`,
    'NONEXISTENT_TARGET',
    index,
    operation
  );
}

/**
 * Apply an RFC 6902 `replace` operation in place on a cloned document.
 * @param {unknown} doc
 * @param {string[]} tokens
 * @param {string} pointer
 * @param {unknown} value
 * @param {number} index
 * @param {unknown} operation
 * @returns {unknown}
 */
function execReplace(doc, tokens, pointer, value, index, operation) {
  const cloned = cloneJson(value);
  if (tokens.length === 0) {
    return cloned;
  }
  const parent = resolveMutableParent(doc, tokens, pointer, index, operation);
  const last = tokens[tokens.length - 1];

  if (Array.isArray(parent)) {
    if (last === '-') {
      throw new JsonPatchError(
        `Operation ${index}: cannot replace nonexistent "-" element at "${pointer}"`,
        'NONEXISTENT_TARGET',
        index,
        operation
      );
    }
    const idx = parseArrayIndex(last);
    if (idx < 0) {
      throw new JsonPatchError(
        `Operation ${index}: invalid array index "${last}" in path "${pointer}"`,
        'INVALID_ARRAY_INDEX',
        index,
        operation
      );
    }
    if (idx >= parent.length) {
      throw new JsonPatchError(
        `Operation ${index}: array index ${idx} out of bounds in path "${pointer}"`,
        'INDEX_OUT_OF_BOUNDS',
        index,
        operation
      );
    }
    parent[idx] = cloned;
    return doc;
  }

  if (isPlainObject(parent)) {
    if (!Object.hasOwn(parent, last)) {
      throw new JsonPatchError(
        `Operation ${index}: target property "${last}" does not exist at "${pointer}"`,
        'NONEXISTENT_TARGET',
        index,
        operation
      );
    }
    setOwnProperty(parent, last, cloned);
    return doc;
  }

  throw new JsonPatchError(
    `Operation ${index}: cannot replace "${last}" on non-container at "${pointer}"`,
    'NONEXISTENT_TARGET',
    index,
    operation
  );
}

/**
 * Parse a pointer for a patch operation and wrap pointer errors in `JsonPatchError`.
 * @param {unknown} pointer
 * @param {string} field
 * @param {number} index
 * @param {unknown} operation
 * @returns {string[]}
 */
function parseOpPointer(pointer, field, index, operation) {
  if (typeof pointer !== 'string') {
    throw new JsonPatchError(
      `Operation ${index}: "${field}" must be a string`,
      'INVALID_OPERATION',
      index,
      operation
    );
  }
  try {
    return parsePointer(pointer);
  } catch (err) {
    if (err instanceof JsonPointerError) {
      throw new JsonPatchError(
        `Operation ${index}: invalid "${field}" pointer: ${err.message}`,
        err.code,
        index,
        operation
      );
    }
    throw err;
  }
}

/**
 * Validate the structural correctness of an RFC 6902 JSON Patch array.
 * @param {unknown} patch
 * @returns {{ valid: boolean, errors: Array<{ index: number, message: string }> }}
 */
export function validatePatch(patch) {
  /** @type {Array<{ index: number, message: string }>} */
  const errors = [];

  if (!Array.isArray(patch)) {
    return {
      valid: false,
      errors: [{ index: -1, message: 'JSON Patch document must be an array' }],
    };
  }

  for (let i = 0; i < patch.length; i++) {
    const op = patch[i];
    if (!isPlainObject(op)) {
      errors.push({ index: i, message: 'Patch operation must be a JSON object' });
      continue;
    }

    if (typeof op.op !== 'string' || !VALID_OPS.has(op.op)) {
      errors.push({ index: i, message: `Unsupported or missing "op" member: ${String(op.op)}` });
      continue;
    }

    if (typeof op.path !== 'string') {
      errors.push({ index: i, message: 'Missing or non-string "path" member' });
    } else {
      try {
        parsePointer(op.path);
      } catch (err) {
        errors.push({ index: i, message: err instanceof Error ? err.message : String(err) });
      }
    }

    if (op.op === 'add' || op.op === 'replace' || op.op === 'test') {
      if (!Object.hasOwn(op, 'value') || op.value === undefined) {
        errors.push({ index: i, message: `Operation "${op.op}" requires a "value" member` });
      }
    } else if (op.op === 'move' || op.op === 'copy') {
      if (typeof op.from !== 'string') {
        errors.push({ index: i, message: `Operation "${op.op}" requires a string "from" member` });
      } else {
        try {
          const fromTokens = parsePointer(op.from);
          if (op.op === 'move' && typeof op.path === 'string') {
            try {
              const pathTokens = parsePointer(op.path);
              if (isProperPrefix(fromTokens, pathTokens)) {
                errors.push({
                  index: i,
                  message: `Move operation "from" ("${op.from}") cannot be a proper prefix of "path" ("${op.path}")`,
                });
              }
            } catch {
              // Path error already recorded above.
            }
          }
        } catch (err) {
          errors.push({ index: i, message: err instanceof Error ? err.message : String(err) });
        }
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Atomically apply an RFC 6902 JSON Patch array to `document`.
 * Never mutates `document` or `patch`. If any operation fails, throws `JsonPatchError`.
 * @param {unknown} document
 * @param {readonly Record<string, unknown>[]} patch
 * @returns {unknown}
 */
export function applyPatch(document, patch) {
  if (!Array.isArray(patch)) {
    throw new JsonPatchError('JSON Patch document must be an array', 'INVALID_PATCH');
  }

  let working = cloneJson(document);

  for (let i = 0; i < patch.length; i++) {
    const opObj = patch[i];
    if (!isPlainObject(opObj)) {
      throw new JsonPatchError(
        `Operation ${i}: patch operation must be a JSON object`,
        'INVALID_OPERATION',
        i,
        opObj
      );
    }

    const { op, path } = opObj;
    if (typeof op !== 'string' || !VALID_OPS.has(op)) {
      throw new JsonPatchError(
        `Operation ${i}: unsupported operation "${String(op)}"`,
        'INVALID_OPERATION',
        i,
        opObj
      );
    }

    const pathTokens = parseOpPointer(path, 'path', i, opObj);
    const pathStr = /** @type {string} */ (path);

    switch (op) {
      case 'add': {
        if (!Object.hasOwn(opObj, 'value') || opObj.value === undefined) {
          throw new JsonPatchError(
            `Operation ${i}: "add" requires a "value" member`,
            'INVALID_OPERATION',
            i,
            opObj
          );
        }
        working = execAdd(working, pathTokens, pathStr, opObj.value, i, opObj);
        break;
      }

      case 'remove': {
        execRemove(working, pathTokens, pathStr, i, opObj);
        break;
      }

      case 'replace': {
        if (!Object.hasOwn(opObj, 'value') || opObj.value === undefined) {
          throw new JsonPatchError(
            `Operation ${i}: "replace" requires a "value" member`,
            'INVALID_OPERATION',
            i,
            opObj
          );
        }
        working = execReplace(working, pathTokens, pathStr, opObj.value, i, opObj);
        break;
      }

      case 'move': {
        const fromTokens = parseOpPointer(opObj.from, 'from', i, opObj);
        const fromStr = /** @type {string} */ (opObj.from);
        if (isProperPrefix(fromTokens, pathTokens)) {
          throw new JsonPatchError(
            `Operation ${i}: "from" ("${fromStr}") cannot be a proper prefix of "path" ("${pathStr}")`,
            'INVALID_MOVE',
            i,
            opObj
          );
        }
        if (fromStr === pathStr) {
          // Verify target exists even for a self-move.
          try {
            getPointer(working, fromStr);
          } catch (err) {
            if (err instanceof JsonPointerError) {
              throw new JsonPatchError(
                `Operation ${i}: move source does not exist: ${err.message}`,
                err.code,
                i,
                opObj
              );
            }
            throw err;
          }
          break;
        }
        const moved = execRemove(working, fromTokens, fromStr, i, opObj);
        working = execAdd(working, pathTokens, pathStr, moved, i, opObj);
        break;
      }

      case 'copy': {
        parseOpPointer(opObj.from, 'from', i, opObj);
        const fromStr = /** @type {string} */ (opObj.from);
        let copied;
        try {
          copied = getPointer(working, fromStr);
        } catch (err) {
          if (err instanceof JsonPointerError) {
            throw new JsonPatchError(
              `Operation ${i}: copy source does not exist: ${err.message}`,
              err.code,
              i,
              opObj
            );
          }
          throw err;
        }
        working = execAdd(working, pathTokens, pathStr, copied, i, opObj);
        break;
      }

      case 'test': {
        if (!Object.hasOwn(opObj, 'value') || opObj.value === undefined) {
          throw new JsonPatchError(
            `Operation ${i}: "test" requires a "value" member`,
            'INVALID_OPERATION',
            i,
            opObj
          );
        }
        let actual;
        try {
          actual = getPointer(working, pathStr);
        } catch (err) {
          if (err instanceof JsonPointerError) {
            throw new JsonPatchError(
              `Operation ${i}: test target does not exist at "${pathStr}"`,
              'TEST_FAILED',
              i,
              opObj
            );
          }
          throw err;
        }
        if (!deepEqual(actual, opObj.value)) {
          throw new JsonPatchError(
            `Operation ${i}: test failed at "${pathStr}"`,
            'TEST_FAILED',
            i,
            opObj
          );
        }
        break;
      }
    }
  }

  return working;
}

/**
 * Compute LCS anchor index pairs for two array slices using `deepEqual`.
 * @param {unknown[]} src
 * @param {unknown[]} tgt
 * @returns {Array<[number, number]>}
 */
function computeLcsPairs(src, tgt) {
  const m = src.length;
  const n = tgt.length;
  const dp = Array.from({ length: m + 1 }, () => new Uint32Array(n + 1));

  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      if (deepEqual(src[i], tgt[j])) {
        dp[i][j] = dp[i + 1][j + 1] + 1;
      } else {
        dp[i][j] = dp[i + 1][j] >= dp[i][j + 1] ? dp[i + 1][j] : dp[i][j + 1];
      }
    }
  }

  /** @type {Array<[number, number]>} */
  const pairs = [];
  let i = 0;
  let j = 0;
  while (i < m && j < n) {
    if (deepEqual(src[i], tgt[j])) {
      pairs.push([i, j]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      i++;
    } else {
      j++;
    }
  }
  return pairs;
}

/**
 * Emit diff operations for a gap between two LCS anchors in an array.
 * @param {unknown[]} srcSlice
 * @param {unknown[]} tgtSlice
 * @param {string} basePath
 * @param {{ cursor: number, currentLen: number }} state
 * @param {Array<Record<string, unknown>>} ops
 */
function emitArrayGap(srcSlice, tgtSlice, basePath, state, ops) {
  const paired = Math.min(srcSlice.length, tgtSlice.length);

  for (let k = 0; k < paired; k++) {
    diffValues(srcSlice[k], tgtSlice[k], `${basePath}/${state.cursor}`, ops);
    state.cursor++;
  }

  if (srcSlice.length > tgtSlice.length) {
    const toRemove = srcSlice.length - tgtSlice.length;
    for (let k = 0; k < toRemove; k++) {
      ops.push({ op: 'remove', path: `${basePath}/${state.cursor}` });
      state.currentLen--;
    }
  } else if (tgtSlice.length > srcSlice.length) {
    for (let k = paired; k < tgtSlice.length; k++) {
      const segment = state.cursor === state.currentLen ? '-' : String(state.cursor);
      ops.push({
        op: 'add',
        path: `${basePath}/${segment}`,
        value: cloneJson(tgtSlice[k]),
      });
      state.cursor++;
      state.currentLen++;
    }
  }
}

/**
 * Recursively generate RFC 6902 patch operations transforming `source` into `target`.
 * @param {unknown} source
 * @param {unknown} target
 * @param {string} path
 * @param {Array<Record<string, unknown>>} ops
 */
function diffValues(source, target, path, ops) {
  if (deepEqual(source, target)) {
    return;
  }

  if (Array.isArray(source) && Array.isArray(target)) {
    // Trim common prefix and suffix for O(N) fast path.
    let prefix = 0;
    const minLen = Math.min(source.length, target.length);
    while (prefix < minLen && deepEqual(source[prefix], target[prefix])) {
      prefix++;
    }

    let suffix = 0;
    while (
      suffix < minLen - prefix &&
      deepEqual(source[source.length - 1 - suffix], target[target.length - 1 - suffix])
    ) {
      suffix++;
    }

    const srcMid = source.slice(prefix, source.length - suffix);
    const tgtMid = target.slice(prefix, target.length - suffix);

    const state = { cursor: prefix, currentLen: source.length };

    if (srcMid.length === 0 || tgtMid.length === 0 || srcMid.length * tgtMid.length > MAX_LCS_CELLS) {
      emitArrayGap(srcMid, tgtMid, path, state, ops);
      return;
    }

    const anchors = computeLcsPairs(srcMid, tgtMid);
    let srcPos = 0;
    let tgtPos = 0;

    for (const [ai, aj] of anchors) {
      emitArrayGap(srcMid.slice(srcPos, ai), tgtMid.slice(tgtPos, aj), path, state, ops);
      state.cursor++;
      srcPos = ai + 1;
      tgtPos = aj + 1;
    }

    emitArrayGap(srcMid.slice(srcPos), tgtMid.slice(tgtPos), path, state, ops);
    return;
  }

  if (isPlainObject(source) && isPlainObject(target)) {
    const srcKeys = Object.keys(source);
    const tgtKeys = Object.keys(target);

    for (const key of srcKeys) {
      const childPath = `${path}/${escapeToken(key)}`;
      if (!Object.hasOwn(target, key)) {
        ops.push({ op: 'remove', path: childPath });
      } else {
        diffValues(source[key], target[key], childPath, ops);
      }
    }

    for (const key of tgtKeys) {
      if (!Object.hasOwn(source, key)) {
        const childPath = `${path}/${escapeToken(key)}`;
        ops.push({ op: 'add', path: childPath, value: cloneJson(target[key]) });
      }
    }
    return;
  }

  ops.push({ op: 'replace', path, value: cloneJson(target) });
}

/**
 * Generate an RFC 6902 JSON Patch array that transforms `source` into `target`.
 * @param {unknown} source
 * @param {unknown} target
 * @returns {Array<Record<string, unknown>>}
 */
export function createPatch(source, target) {
  /** @type {Array<Record<string, unknown>>} */
  const ops = [];
  diffValues(source, target, '', ops);
  return ops;
}

/**
 * Apply an RFC 7396 JSON Merge Patch to `target` without mutating `target` or `patch`.
 * @param {unknown} target
 * @param {unknown} patch
 * @returns {unknown}
 */
export function mergePatch(target, patch) {
  if (!isPlainObject(patch)) {
    return cloneJson(patch);
  }

  const result = isPlainObject(target) ? cloneJson(target) : {};

  for (const key of Object.keys(patch)) {
    const patchValue = patch[key];
    if (patchValue === null) {
      if (Object.hasOwn(result, key)) {
        delete result[key];
      }
    } else {
      const targetValue = Object.hasOwn(result, key) ? result[key] : undefined;
      setOwnProperty(result, key, mergePatch(targetValue, patchValue));
    }
  }

  return result;
}

export { compilePointer, parsePointer };

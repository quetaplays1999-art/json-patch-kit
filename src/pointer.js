/**
 * RFC 6901 JSON Pointer implementation.
 * @module json-patch-kit/pointer
 */

const ARRAY_INDEX_RE = /^(?:0|[1-9][0-9]*)$/;
const INVALID_ESCAPE_RE = /~(?![01])/;

/**
 * Error thrown for invalid RFC 6901 JSON Pointer syntax or traversal failures.
 */
export class JsonPointerError extends Error {
  /**
   * @param {string} message
   * @param {string} code
   * @param {string} [pointer]
   */
  constructor(message, code, pointer) {
    super(message);
    this.name = 'JsonPointerError';
    this.code = code;
    if (pointer !== undefined) {
      this.pointer = pointer;
    }
  }
}

/**
 * Check whether a value is a plain JSON object (non-null, non-array object).
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
export function isPlainObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Safely set an own enumerable property on an object without risking prototype pollution.
 * @param {Record<string, unknown>} obj
 * @param {string} key
 * @param {unknown} value
 */
export function setOwnProperty(obj, key, value) {
  if (key === '__proto__') {
    Object.defineProperty(obj, '__proto__', {
      value,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  } else {
    obj[key] = value;
  }
}

/**
 * Deeply clone a JSON-compatible value while preserving own `__proto__` properties safely.
 * @template T
 * @param {T} value
 * @returns {T}
 */
export function cloneJson(value) {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return /** @type {T} */ (value.map(cloneJson));
  }
  const out = {};
  for (const key of Object.keys(value)) {
    setOwnProperty(out, key, cloneJson(/** @type {Record<string, unknown>} */ (value)[key]));
  }
  return /** @type {T} */ (out);
}

/**
 * Parse a strict RFC 6901 array index token (`0` or non-zero-prefixed digits).
 * Returns -1 when the token is not a valid array index.
 * @param {string} token
 * @returns {number}
 */
export function parseArrayIndex(token) {
  if (!ARRAY_INDEX_RE.test(token)) {
    return -1;
  }
  const idx = Number(token);
  return Number.isSafeInteger(idx) ? idx : -1;
}

/**
 * Escape a single reference token according to RFC 6901 (`~` -> `~0`, `/` -> `~1`).
 * @param {string | number} token
 * @returns {string}
 */
export function escapeToken(token) {
  return String(token).replace(/~/g, '~0').replace(/\//g, '~1');
}

/**
 * Unescape a single RFC 6901 reference token (`~1` -> `/`, `~0` -> `~`).
 * Throws `JsonPointerError` on malformed escape sequences.
 * @param {string} token
 * @param {string} [pointer]
 * @returns {string}
 */
export function unescapeToken(token, pointer) {
  if (typeof token !== 'string') {
    throw new JsonPointerError('Reference token must be a string', 'INVALID_POINTER', pointer);
  }
  if (INVALID_ESCAPE_RE.test(token)) {
    throw new JsonPointerError(
      `Invalid escape sequence in JSON Pointer token "${token}"`,
      'INVALID_ESCAPE',
      pointer
    );
  }
  return token.replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * Parse an RFC 6901 JSON Pointer string into an array of unescaped reference tokens.
 * @param {string} pointer
 * @returns {string[]}
 */
export function parsePointer(pointer) {
  if (typeof pointer !== 'string') {
    throw new JsonPointerError('JSON Pointer must be a string', 'INVALID_POINTER');
  }
  if (pointer === '') {
    return [];
  }
  if (pointer[0] !== '/') {
    throw new JsonPointerError(
      `Invalid JSON Pointer "${pointer}": non-empty pointers must start with "/"`,
      'INVALID_POINTER',
      pointer
    );
  }
  return pointer
    .slice(1)
    .split('/')
    .map((segment) => unescapeToken(segment, pointer));
}

/**
 * Compile an array of unescaped reference tokens into an RFC 6901 JSON Pointer string.
 * @param {readonly (string | number)[]} tokens
 * @returns {string}
 */
export function compilePointer(tokens) {
  if (!Array.isArray(tokens)) {
    throw new JsonPointerError('Pointer tokens must be an array', 'INVALID_POINTER');
  }
  if (tokens.length === 0) {
    return '';
  }
  return '/' + tokens.map(escapeToken).join('/');
}

/**
 * Traverse a document along a list of tokens and return the parent container of the final token.
 * @param {unknown} root
 * @param {string[]} tokens
 * @param {string} pointer
 * @returns {unknown}
 */
function resolveParent(root, tokens, pointer) {
  let current = root;
  for (let i = 0; i < tokens.length - 1; i++) {
    const token = tokens[i];
    if (Array.isArray(current)) {
      if (token === '-') {
        throw new JsonPointerError(
          `Cannot traverse past "-" token in JSON Pointer "${pointer}"`,
          'NONEXISTENT_TARGET',
          pointer
        );
      }
      const idx = parseArrayIndex(token);
      if (idx < 0) {
        throw new JsonPointerError(
          `Invalid array index "${token}" in JSON Pointer "${pointer}"`,
          'INVALID_ARRAY_INDEX',
          pointer
        );
      }
      if (idx >= current.length) {
        throw new JsonPointerError(
          `Array index ${idx} out of bounds in JSON Pointer "${pointer}"`,
          'INDEX_OUT_OF_BOUNDS',
          pointer
        );
      }
      current = current[idx];
    } else if (isPlainObject(current)) {
      if (!Object.hasOwn(current, token)) {
        throw new JsonPointerError(
          `Missing property "${token}" while traversing JSON Pointer "${pointer}"`,
          'NONEXISTENT_TARGET',
          pointer
        );
      }
      current = current[token];
    } else {
      throw new JsonPointerError(
        `Cannot traverse into non-container value at token "${token}" in JSON Pointer "${pointer}"`,
        'NONEXISTENT_TARGET',
        pointer
      );
    }
  }
  return current;
}

/**
 * Check whether an RFC 6901 JSON Pointer resolves to an existing value in `document`.
 * Throws `JsonPointerError` if `pointer` has invalid syntax.
 * @param {unknown} document
 * @param {string} pointer
 * @returns {boolean}
 */
export function hasPointer(document, pointer) {
  const tokens = parsePointer(pointer);
  let current = document;
  for (const token of tokens) {
    if (Array.isArray(current)) {
      if (token === '-') {
        return false;
      }
      const idx = parseArrayIndex(token);
      if (idx < 0 || idx >= current.length) {
        return false;
      }
      current = current[idx];
    } else if (isPlainObject(current)) {
      if (!Object.hasOwn(current, token)) {
        return false;
      }
      current = current[token];
    } else {
      return false;
    }
  }
  return true;
}

/**
 * Resolve an RFC 6901 JSON Pointer against `document` and return the referenced value.
 * Throws `JsonPointerError` if the pointer is invalid or the target does not exist.
 * @param {unknown} document
 * @param {string} pointer
 * @returns {unknown}
 */
export function getPointer(document, pointer) {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) {
    return document;
  }
  const parent = resolveParent(document, tokens, pointer);
  const lastToken = tokens[tokens.length - 1];

  if (Array.isArray(parent)) {
    if (lastToken === '-') {
      throw new JsonPointerError(
        `Array "-" token references a nonexistent element in JSON Pointer "${pointer}"`,
        'NONEXISTENT_TARGET',
        pointer
      );
    }
    const idx = parseArrayIndex(lastToken);
    if (idx < 0) {
      throw new JsonPointerError(
        `Invalid array index "${lastToken}" in JSON Pointer "${pointer}"`,
        'INVALID_ARRAY_INDEX',
        pointer
      );
    }
    if (idx >= parent.length) {
      throw new JsonPointerError(
        `Array index ${idx} out of bounds in JSON Pointer "${pointer}"`,
        'INDEX_OUT_OF_BOUNDS',
        pointer
      );
    }
    return parent[idx];
  }

  if (isPlainObject(parent)) {
    if (!Object.hasOwn(parent, lastToken)) {
      throw new JsonPointerError(
        `Property "${lastToken}" does not exist at JSON Pointer "${pointer}"`,
        'NONEXISTENT_TARGET',
        pointer
      );
    }
    return parent[lastToken];
  }

  throw new JsonPointerError(
    `Cannot resolve "${lastToken}" on non-container value at JSON Pointer "${pointer}"`,
    'NONEXISTENT_TARGET',
    pointer
  );
}

/**
 * Return a new document with `value` set at the RFC 6901 `pointer` without mutating `document`.
 * For arrays, `"-"` or an index equal to `array.length` appends `value`; an existing index replaces it.
 * @param {unknown} document
 * @param {string} pointer
 * @param {unknown} value
 * @returns {unknown}
 */
export function setPointer(document, pointer, value) {
  const tokens = parsePointer(pointer);
  const clonedValue = cloneJson(value);

  if (tokens.length === 0) {
    return clonedValue;
  }

  const root = cloneJson(document);
  const parent = resolveParent(root, tokens, pointer);
  const lastToken = tokens[tokens.length - 1];

  if (Array.isArray(parent)) {
    if (lastToken === '-') {
      parent.push(clonedValue);
      return root;
    }
    const idx = parseArrayIndex(lastToken);
    if (idx < 0) {
      throw new JsonPointerError(
        `Invalid array index "${lastToken}" in JSON Pointer "${pointer}"`,
        'INVALID_ARRAY_INDEX',
        pointer
      );
    }
    if (idx > parent.length) {
      throw new JsonPointerError(
        `Array index ${idx} out of bounds in JSON Pointer "${pointer}"`,
        'INDEX_OUT_OF_BOUNDS',
        pointer
      );
    }
    if (idx === parent.length) {
      parent.push(clonedValue);
    } else {
      parent[idx] = clonedValue;
    }
    return root;
  }

  if (isPlainObject(parent)) {
    setOwnProperty(parent, lastToken, clonedValue);
    return root;
  }

  throw new JsonPointerError(
    `Cannot set "${lastToken}" on non-container value at JSON Pointer "${pointer}"`,
    'NONEXISTENT_TARGET',
    pointer
  );
}

/**
 * Return a new document with the value at the RFC 6901 `pointer` removed without mutating `document`.
 * Throws `JsonPointerError` if `pointer` is root (`""`), invalid, or does not exist.
 * @param {unknown} document
 * @param {string} pointer
 * @returns {unknown}
 */
export function removePointer(document, pointer) {
  const tokens = parsePointer(pointer);
  if (tokens.length === 0) {
    throw new JsonPointerError('Cannot remove root document', 'INVALID_OPERATION', pointer);
  }

  const root = cloneJson(document);
  const parent = resolveParent(root, tokens, pointer);
  const lastToken = tokens[tokens.length - 1];

  if (Array.isArray(parent)) {
    if (lastToken === '-') {
      throw new JsonPointerError(
        `Cannot remove nonexistent "-" element at JSON Pointer "${pointer}"`,
        'NONEXISTENT_TARGET',
        pointer
      );
    }
    const idx = parseArrayIndex(lastToken);
    if (idx < 0) {
      throw new JsonPointerError(
        `Invalid array index "${lastToken}" in JSON Pointer "${pointer}"`,
        'INVALID_ARRAY_INDEX',
        pointer
      );
    }
    if (idx >= parent.length) {
      throw new JsonPointerError(
        `Array index ${idx} out of bounds in JSON Pointer "${pointer}"`,
        'INDEX_OUT_OF_BOUNDS',
        pointer
      );
    }
    parent.splice(idx, 1);
    return root;
  }

  if (isPlainObject(parent)) {
    if (!Object.hasOwn(parent, lastToken)) {
      throw new JsonPointerError(
        `Property "${lastToken}" does not exist at JSON Pointer "${pointer}"`,
        'NONEXISTENT_TARGET',
        pointer
      );
    }
    delete parent[lastToken];
    return root;
  }

  throw new JsonPointerError(
    `Cannot remove "${lastToken}" from non-container value at JSON Pointer "${pointer}"`,
    'NONEXISTENT_TARGET',
    pointer
  );
}

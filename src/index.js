/**
 * json-patch-kit
 * Zero-dependency RFC 6901 JSON Pointer, RFC 6902 JSON Patch, diff generator,
 * and RFC 7396 JSON Merge Patch library.
 * @module json-patch-kit
 */

export {
  JsonPointerError,
  compilePointer,
  escapeToken,
  getPointer,
  hasPointer,
  parsePointer,
  removePointer,
  setPointer,
  unescapeToken,
} from './pointer.js';

export {
  JsonPatchError,
  applyPatch,
  createPatch,
  deepEqual,
  mergePatch,
  validatePatch,
} from './patch.js';

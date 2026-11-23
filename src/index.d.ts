export type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonObject | JsonArray;
export interface JsonObject {
  [key: string]: JsonValue;
}
export type JsonArray = JsonValue[];

export interface AddOperation {
  op: 'add';
  path: string;
  value: JsonValue;
}

export interface RemoveOperation {
  op: 'remove';
  path: string;
}

export interface ReplaceOperation {
  op: 'replace';
  path: string;
  value: JsonValue;
}

export interface MoveOperation {
  op: 'move';
  from: string;
  path: string;
}

export interface CopyOperation {
  op: 'copy';
  from: string;
  path: string;
}

export interface TestOperation {
  op: 'test';
  path: string;
  value: JsonValue;
}

export type JsonPatchOperation =
  | AddOperation
  | RemoveOperation
  | ReplaceOperation
  | MoveOperation
  | CopyOperation
  | TestOperation;

export type JsonPatch = JsonPatchOperation[];

export interface PatchValidationError {
  index: number;
  message: string;
}

export interface PatchValidationResult {
  valid: boolean;
  errors: PatchValidationError[];
}

export class JsonPointerError extends Error {
  code: string;
  pointer?: string;
  constructor(message: string, code: string, pointer?: string);
}

export class JsonPatchError extends Error {
  code: string;
  index?: number;
  operation?: unknown;
  constructor(message: string, code: string, index?: number, operation?: unknown);
}

/**
 * Escape a single RFC 6901 reference token (`~` -> `~0`, `/` -> `~1`).
 */
export function escapeToken(token: string | number): string;

/**
 * Unescape a single RFC 6901 reference token (`~1` -> `/`, `~0` -> `~`).
 */
export function unescapeToken(token: string, pointer?: string): string;

/**
 * Parse an RFC 6901 JSON Pointer string into unescaped reference tokens.
 */
export function parsePointer(pointer: string): string[];

/**
 * Compile an array of reference tokens into an RFC 6901 JSON Pointer string.
 */
export function compilePointer(tokens: readonly (string | number)[]): string;

/**
 * Check whether an RFC 6901 JSON Pointer resolves to an existing value in `document`.
 */
export function hasPointer(document: JsonValue, pointer: string): boolean;

/**
 * Resolve an RFC 6901 JSON Pointer against `document`.
 * Throws `JsonPointerError` if the pointer is invalid or the target does not exist.
 */
export function getPointer(document: JsonValue, pointer: string): JsonValue;

/**
 * Return a new document with `value` set at `pointer` without mutating `document`.
 */
export function setPointer(document: JsonValue, pointer: string, value: JsonValue): JsonValue;

/**
 * Return a new document with the target at `pointer` removed without mutating `document`.
 */
export function removePointer(document: JsonValue, pointer: string): JsonValue;

/**
 * RFC 6902 Section 4.6 deep JSON equality comparison.
 */
export function deepEqual(a: unknown, b: unknown): boolean;

/**
 * Validate the structural correctness of an RFC 6902 JSON Patch array.
 */
export function validatePatch(patch: unknown): PatchValidationResult;

/**
 * Atomically apply an RFC 6902 JSON Patch to `document` without mutating inputs.
 */
export function applyPatch(document: JsonValue, patch: readonly JsonPatchOperation[]): JsonValue;

/**
 * Generate an RFC 6902 JSON Patch transforming `source` into `target`.
 */
export function createPatch(source: JsonValue, target: JsonValue): JsonPatch;

/**
 * Apply an RFC 7396 JSON Merge Patch to `target` without mutating inputs.
 */
export function mergePatch(target: JsonValue, patch: JsonValue): JsonValue;

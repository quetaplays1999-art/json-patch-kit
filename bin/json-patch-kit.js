#!/usr/bin/env node

import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyPatch,
  createPatch,
  getPointer,
  mergePatch,
} from '../src/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const pkgPath = resolve(__dirname, '..', 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

const HELP_TEXT = `json-patch-kit v${pkg.version}
Zero-dependency RFC 6901 JSON Pointer, RFC 6902 JSON Patch, diff, and RFC 7396 Merge Patch CLI.

Usage:
  json-patch-kit diff <a.json> <b.json> [options]      Generate RFC 6902 JSON Patch from A to B
  json-patch-kit apply <doc.json> <patch.json> [options]  Apply RFC 6902 JSON Patch to a document
  json-patch-kit merge <doc.json> <merge.json> [options]  Apply RFC 7396 JSON Merge Patch to a document
  json-patch-kit get <doc.json> <pointer> [options]    Read a value using RFC 6901 JSON Pointer

Options:
  -c, --compact          Output compact single-line JSON (default: pretty 2-space indent)
  -o, --output <file>    Write output JSON to a file instead of stdout
  -h, --help             Show this help message
  -v, --version          Print version number

Notes:
  Use "-" as a file path to read JSON from stdin (one input per command).
  For the root document pointer in "get", pass an empty string ("").

Examples:
  json-patch-kit diff old.json new.json
  json-patch-kit apply doc.json patch.json --output updated.json
  json-patch-kit merge config.json overrides.json --compact
  json-patch-kit get package.json /scripts/test
`;

/**
 * Parse CLI arguments into command, positional args, and flags.
 * @param {string[]} argv
 */
function parseArgs(argv) {
  const positionals = [];
  let compact = false;
  let outputFile = null;
  let help = false;
  let version = false;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--') {
      positionals.push(...argv.slice(i + 1));
      break;
    }
    if (arg === '-h' || arg === '--help') {
      help = true;
    } else if (arg === '-v' || arg === '--version') {
      version = true;
    } else if (arg === '-c' || arg === '--compact') {
      compact = true;
    } else if (arg === '-o' || arg === '--output') {
      if (i + 1 >= argv.length) {
        throw new Error(`Option "${arg}" requires a file path argument.`);
      }
      outputFile = argv[++i];
    } else if (arg.startsWith('--output=')) {
      outputFile = arg.slice('--output='.length);
      if (!outputFile) {
        throw new Error('Option "--output=" requires a non-empty file path.');
      }
    } else if (arg.startsWith('-') && arg !== '-') {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positionals.push(arg);
    }
  }

  return { positionals, compact, outputFile, help, version };
}

/**
 * Read and parse JSON from a file path or stdin (`-`).
 * @param {string} source
 * @param {{ stdinUsed: boolean }} state
 */
function readJsonInput(source, state) {
  let raw;
  if (source === '-') {
    if (state.stdinUsed) {
      throw new Error('Stdin ("-") can only be used for one input per command.');
    }
    state.stdinUsed = true;
    raw = readFileSync(0, 'utf8');
  } else {
    try {
      raw = readFileSync(source, 'utf8');
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      throw new Error(`Failed to read file "${source}": ${msg}`);
    }
  }

  try {
    return JSON.parse(raw);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const label = source === '-' ? 'stdin' : `"${source}"`;
    throw new Error(`Invalid JSON in ${label}: ${msg}`);
  }
}

/**
 * Format and write result JSON to stdout or output file.
 * @param {unknown} value
 * @param {{ compact: boolean, outputFile: string | null }} options
 */
function writeJsonOutput(value, { compact, outputFile }) {
  const serialized = (compact ? JSON.stringify(value) : JSON.stringify(value, null, 2)) + '\n';
  if (outputFile) {
    writeFileSync(outputFile, serialized, 'utf8');
  } else {
    process.stdout.write(serialized);
  }
}

function main() {
  const { positionals, compact, outputFile, help, version } = parseArgs(process.argv.slice(2));

  if (version) {
    process.stdout.write(`${pkg.version}\n`);
    return;
  }

  if (help || positionals.length === 0) {
    process.stdout.write(HELP_TEXT);
    return;
  }

  const [command, ...args] = positionals;
  const ioState = { stdinUsed: false };

  switch (command) {
    case 'diff': {
      if (args.length !== 2) {
        throw new Error('Usage: json-patch-kit diff <a.json> <b.json>');
      }
      const docA = readJsonInput(args[0], ioState);
      const docB = readJsonInput(args[1], ioState);
      const patch = createPatch(docA, docB);
      writeJsonOutput(patch, { compact, outputFile });
      break;
    }

    case 'apply': {
      if (args.length !== 2) {
        throw new Error('Usage: json-patch-kit apply <doc.json> <patch.json>');
      }
      const doc = readJsonInput(args[0], ioState);
      const patch = readJsonInput(args[1], ioState);
      const result = applyPatch(doc, patch);
      writeJsonOutput(result, { compact, outputFile });
      break;
    }

    case 'merge': {
      if (args.length !== 2) {
        throw new Error('Usage: json-patch-kit merge <doc.json> <merge.json>');
      }
      const doc = readJsonInput(args[0], ioState);
      const patch = readJsonInput(args[1], ioState);
      const result = mergePatch(doc, patch);
      writeJsonOutput(result, { compact, outputFile });
      break;
    }

    case 'get': {
      if (args.length !== 2) {
        throw new Error('Usage: json-patch-kit get <doc.json> <pointer>');
      }
      const doc = readJsonInput(args[0], ioState);
      const value = getPointer(doc, args[1]);
      writeJsonOutput(value, { compact, outputFile });
      break;
    }

    default:
      throw new Error(`Unknown command "${command}". Run "json-patch-kit --help" for usage.`);
  }
}

try {
  main();
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  process.stderr.write(`Error: ${message}\n`);
  process.exitCode = 1;
}

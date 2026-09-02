#!/usr/bin/env node

/*
 * Read a Laya DCC 2.0 cache that was bundled inside an APK.
 *
 * Usage:
 *   node tools/extract-laya-dcc.cjs <dcc-root> <layadcc.js> [output-dir]
 *
 * The APK's own layadcc.js supplies the tree parser. This script only adapts
 * Node file IO and unwraps the optional `layadcc2` XOR envelope.
 */

const fs = require("node:fs");
const path = require("node:path");

const [dccRootArg, layaDccArg, outputDirArg] = process.argv.slice(2);

if (!dccRootArg || !layaDccArg) {
  console.error("Usage: node tools/extract-laya-dcc.cjs <dcc-root> <layadcc.js> [output-dir]");
  process.exit(2);
}

const dccRoot = path.resolve(dccRootArg);
const layaDccPath = path.resolve(layaDccArg);
const outputDir = outputDirArg ? path.resolve(outputDirArg) : null;
const DCC_FLAG = Buffer.from("layadcc2", "ascii");

function toArrayBuffer(buffer) {
  return buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength);
}

function unwrapObject(buffer) {
  if (buffer.length < 24 || !buffer.subarray(0, 8).equals(DCC_FLAG)) return buffer;

  const version = buffer.readUInt32LE(8);
  const key = buffer.subarray(12, 20);
  const expectedSize = buffer.readUInt32LE(20);
  const encrypted = buffer.subarray(24);
  const hasKey = key.some((value) => value !== 0);

  if (encrypted.length !== expectedSize) {
    throw new Error(`Invalid DCC object: expected ${expectedSize} bytes, got ${encrypted.length}`);
  }

  if (!hasKey) return encrypted;

  const plain = Buffer.allocUnsafe(encrypted.length);
  for (let index = 0; index < encrypted.length; index += 1) {
    plain[index] = encrypted[index] ^ key[index % key.length];
  }
  plain.dccVersion = version;
  return plain;
}

class NodeDccFileIO {
  async init() {}

  async read(relativePath, encoding, onlyLocal, validator) {
    const absolutePath = path.join(dccRoot, relativePath);
    if (!fs.existsSync(absolutePath)) {
      if (onlyLocal) return null;
      throw new Error(`Missing DCC object: ${relativePath}`);
    }

    let data = fs.readFileSync(absolutePath);
    if (relativePath.startsWith("objects/")) data = unwrapObject(data);
    if (validator && !(await validator(toArrayBuffer(data)))) return null;
    return encoding === "utf8" ? data.toString("utf8") : toArrayBuffer(data);
  }

  async isFileExist(relativePath) {
    return fs.existsSync(path.join(dccRoot, relativePath));
  }

  unzip(data) { return data; }
  zip(data) { return data; }
  textencode(value) { return new TextEncoder().encode(value); }
  textdecode(value) { return new TextDecoder().decode(value); }
  async write() { throw new Error("Extractor is read-only"); }
  async rm() { throw new Error("Extractor is read-only"); }
  async mv() { throw new Error("Extractor is read-only"); }
  async enumCachedObjects() {}
}

async function main() {
  global.window = globalThis;
  const { LayaDCCClient } = require(layaDccPath);
  const client = new LayaDCCClient("", NodeDccFileIO);
  const ready = await client.init(null, null);
  if (!ready) throw new Error("Could not initialize the DCC tree");

  const entries = [];
  await client.visitAll(
    async () => {},
    async (entry) => {
      const directory = entry.owner.fullPath.replace(/^\//, "");
      const relativePath = path.posix.join(directory.replaceAll("\\", "/"), entry.path);
      entries.push({ relativePath, id: entry.idstring });
    },
  );

  entries.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
  for (const entry of entries) {
    process.stdout.write(`${entry.id}  ${entry.relativePath}\n`);
    if (!outputDir) continue;

    const target = path.resolve(outputDir, entry.relativePath);
    const outputRootWithSep = outputDir.endsWith(path.sep) ? outputDir : `${outputDir}${path.sep}`;
    if (target !== outputDir && !target.startsWith(outputRootWithSep)) {
      throw new Error(`Unsafe output path: ${entry.relativePath}`);
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const data = await client.readFile(`/${entry.relativePath}`);
    fs.writeFileSync(target, Buffer.from(data));
  }

  console.error(`Indexed ${entries.length} files${outputDir ? `; extracted to ${outputDir}` : ""}.`);
}

main().catch((error) => {
  console.error(error.stack || error);
  process.exit(1);
});

#!/usr/bin/env node

/**
 * Build script for Seelen UI widgets.
 * Bundles JS with esbuild, copies other assets from src/ to dist/.
 *
 * Usage:
 *   npm run build       # Build all widgets
 *   npm run dev         # Watch mode (rebuild on changes)
 */

import fs from "node:fs/promises";
import path from "node:path";
import * as esbuild from "esbuild";

const SRC_DIR = "src";
const DIST_DIR = "dist";

// File extensions to copy from src/ to dist/ (non-JS assets)
const ASSET_EXTENSIONS = new Set([
  ".yml",
  ".yaml",
  ".html",
  ".css",
  ".scss",
  ".sass",
]);

/**
 * Check if a filename is a non-JS asset that should be copied.
 */
function isAsset(filename) {
  const ext = path.extname(filename).toLowerCase();
  return ASSET_EXTENSIONS.has(ext);
}

/**
 * Copy all non-JS assets from src/ to dist/.
 */
async function copyAssets() {
  const entries = await fs.readdir(SRC_DIR);
  let copyCount = 0;

  for (const entry of entries) {
    const fullPath = path.join(SRC_DIR, entry);
    const stat = await fs.stat(fullPath);
    if (!stat.isFile()) continue;

    if (isAsset(entry)) {
      await fs.copyFile(
        path.join(SRC_DIR, entry),
        path.join(DIST_DIR, entry)
      );
      copyCount++;
    }
  }

  return copyCount;
}

/**
 * Check if src/ contains a metadata.yml (flat widget structure).
 */
async function hasMetadata() {
  const entries = await fs.readdir(SRC_DIR);
  return entries.some(
    (name) => name === "metadata.yml" || name === "metadata.yaml"
  );
}

/**
 * Build all widgets: copy assets + bundle JS with esbuild.
 */
async function buildAll() {
  console.log("Building widgets...");

  if (!(await hasMetadata())) {
    console.log("No widget found — src/ must contain metadata.yml");
    return;
  }

  await fs.mkdir(DIST_DIR, { recursive: true });

  const copyCount = await copyAssets();

  await esbuild.build({
    entryPoints: [path.join(SRC_DIR, "index.js")],
    outfile: path.join(DIST_DIR, "index.js"),
    target: "chrome100",
    format: "iife",
    bundle: true,
    logLevel: "error",
  });

  console.log(`  ✓ built ${copyCount} asset(s) + bundled JS → ${DIST_DIR}/`);
}

// Run - detect if this module is the entry point
const isMain =
  process.argv[1] === new URL(import.meta.url).pathname ||
  process.argv[1] === path.resolve("build.mjs");
const isWatch = process.argv.includes("--watch");

if (isMain) {
  if (isWatch) {
    console.log("Watch mode enabled. Watching src/ for changes...");
    const chokidar = await import("chokidar");

    // Initial build
    await buildAll();

    // Watch for changes
    chokidar
      .watch(SRC_DIR, { ignoreInitial: true })
      .on("all", async (event, filePath) => {
        console.log(`\n[${event}] ${path.relative(process.cwd(), filePath)}`);
        try {
          await buildAll();
        } catch (err) {
          console.error("Build failed:", err.message);
        }
      });
  } else {
    await buildAll();
  }
}

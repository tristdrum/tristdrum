import { access, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { execFileSync } from "node:child_process";

export function normalizeRelativePath(value) {
  return value
    .normalize("NFC")
    .replaceAll("\\", "/")
    .replace(/^\.\//, "");
}

export async function listFilesRecursively(rootPath) {
  const results = [];

  async function visit(currentPath) {
    const entries = await readdir(currentPath, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name, "en"));

    for (const entry of entries) {
      const fullPath = path.join(currentPath, entry.name);
      if (entry.isDirectory()) {
        await visit(fullPath);
      } else if (entry.isFile()) {
        results.push(fullPath);
      }
    }
  }

  await visit(rootPath);
  return results;
}

export async function assertReadableDirectory(rootPath) {
  const absolutePath = path.resolve(rootPath);
  const metadata = await stat(absolutePath);
  if (!metadata.isDirectory()) {
    throw new Error(`Source is not a directory: ${absolutePath}`);
  }
  await access(absolutePath);
  return absolutePath;
}

export function findGitRoot(startPath = process.cwd()) {
  try {
    return execFileSync("git", ["rev-parse", "--show-toplevel"], {
      cwd: startPath,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return null;
  }
}

export function isPathInside(parentPath, candidatePath) {
  const relative = path.relative(parentPath, candidatePath);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export function assertLocalOutputPath(outputPath, gitRoot = findGitRoot()) {
  const absolutePath = path.resolve(outputPath);
  if (!gitRoot || !isPathInside(gitRoot, absolutePath)) {
    return absolutePath;
  }

  let ignored = false;
  try {
    execFileSync("git", ["check-ignore", "--quiet", "--no-index", absolutePath], {
      cwd: gitRoot,
      stdio: "ignore",
    });
    ignored = true;
  } catch {
    ignored = false;
  }

  if (!ignored) {
    throw new Error(
      `Refusing to write sensitive finance output to a tracked repository path: ${absolutePath}`,
    );
  }

  return absolutePath;
}

export function defaultOutputPath() {
  const gitRoot = findGitRoot();
  if (!gitRoot) {
    throw new Error("Cannot determine a safe default output path outside a Git repository.");
  }
  return path.join(gitRoot, ".finance-local", "finance-ingest");
}

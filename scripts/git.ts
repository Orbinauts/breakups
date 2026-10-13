import { execFileSync } from "node:child_process";

/**
 * git, as the scripts run it: in a directory, its output as text, up to a
 * gigabyte of it (a file's whole history read back), its error output kept
 * from the terminal and carried by the error where git fails.
 */
export function gitOutput(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 1 << 30, stdio: ["ignore", "pipe", "pipe"] });
}

/** git's output with its trailing newline trimmed: a hash, a branch's name, a status. */
export const git = (cwd: string, ...args: string[]): string => gitOutput(cwd, ...args).trim();

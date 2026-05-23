import { existsSync } from "node:fs";

type RunResult = {
  success: boolean;
  stdout: string;
  stderr: string;
};

type ChangeRecord = {
  status: string;
  path: string;
};

async function runGitText(args: string[]): Promise<RunResult> {
  const proc = Bun.spawn({
    cmd: ["git", ...args],
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    proc.stdout ? new Response(proc.stdout).text() : Promise.resolve(""),
    proc.stderr ? new Response(proc.stderr).text() : Promise.resolve(""),
    proc.exited,
  ]);
  return { success: exitCode === 0, stdout, stderr };
}

function parseNameStatus(output: string): ChangeRecord[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, ...rest] = line.split("\t");
      return status ? { status, path: rest.at(-1) ?? "" } : null;
    })
    .filter((entry): entry is ChangeRecord => entry !== null)
    .filter((entry) => entry.path);
}

function collectForbiddenDemoChanges(changes: ChangeRecord[]): string[] {
  return changes
    .filter((entry) => entry.path.startsWith("demo/"))
    .filter((entry) => !entry.status.startsWith("D"))
    .map((entry) => `${entry.status} ${entry.path}`);
}

function collectBinaryChanges(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => {
      const parts = line.split("\t");
      return parts.length >= 3 && parts[0] === "-" && parts[1] === "-";
    })
    .map((line) => {
      const parts = line.split("\t");
      return parts.at(-1) ?? "";
    })
    .filter((path) => path && !path.startsWith("tmp/"));
}

async function resolveBaseRef(): Promise<string | null> {
  const envBase = process.env.YASH_VALIDATE_BASE?.trim();
  if (envBase) return envBase;

  const githubBase = process.env.GITHUB_BASE_REF?.trim();
  if (githubBase) {
    const candidates = [`origin/${githubBase}`, githubBase];
    for (const candidate of candidates) {
      const check = await runGitText(["rev-parse", "--verify", candidate]);
      if (check.success) return candidate;
    }
  }

  for (const candidate of ["origin/master", "origin/main", "master", "main"]) {
    const check = await runGitText(["rev-parse", "--verify", candidate]);
    if (check.success) return candidate;
  }

  return null;
}

async function gatherRangeChanges(baseRef: string): Promise<{
  forbiddenDemo: string[];
  binaryPaths: string[];
}> {
  const mergeBase = await runGitText(["merge-base", "HEAD", baseRef]);
  if (!mergeBase.success) {
    throw new Error(`Unable to determine merge-base against ${baseRef}: ${mergeBase.stderr.trim() || mergeBase.stdout.trim()}`);
  }
  const base = mergeBase.stdout.trim();

  const nameStatus = await runGitText(["diff", "--name-status", "--diff-filter=ACMR", `${base}..HEAD`]);
  const numstat = await runGitText(["diff", "--numstat", "--diff-filter=ACMR", `${base}..HEAD`]);
  if (!nameStatus.success || !numstat.success) {
    throw new Error("Unable to inspect git diff for branch validation.");
  }

  return {
    forbiddenDemo: collectForbiddenDemoChanges(parseNameStatus(nameStatus.stdout)),
    binaryPaths: collectBinaryChanges(numstat.stdout),
  };
}

async function gatherWorkingTreeChanges(): Promise<{
  forbiddenDemo: string[];
  binaryPaths: string[];
}> {
  const unstagedNames = await runGitText(["diff", "--name-status", "--diff-filter=ACMR"]);
  const stagedNames = await runGitText(["diff", "--cached", "--name-status", "--diff-filter=ACMR"]);
  const unstagedNumstat = await runGitText(["diff", "--numstat", "--diff-filter=ACMR"]);
  const stagedNumstat = await runGitText(["diff", "--cached", "--numstat", "--diff-filter=ACMR"]);

  if (
    !unstagedNames.success ||
    !stagedNames.success ||
    !unstagedNumstat.success ||
    !stagedNumstat.success
  ) {
    throw new Error("Unable to inspect working tree changes for repo validation.");
  }

  const forbiddenDemo = [unstagedNames, stagedNames].flatMap((result) =>
    collectForbiddenDemoChanges(parseNameStatus(result.stdout)),
  );
  const binaryPaths = [unstagedNumstat, stagedNumstat].flatMap((result) =>
    collectBinaryChanges(result.stdout),
  );

  return {
    forbiddenDemo: [...new Set(forbiddenDemo)],
    binaryPaths: [...new Set(binaryPaths)],
  };
}

async function main() {
  const gitDir = existsSync(".git");
  if (!gitDir) {
    console.error("validate:repo must run from the repository root.");
    process.exit(1);
  }

  const baseRef = await resolveBaseRef();
  const violations = baseRef ? await gatherRangeChanges(baseRef) : await gatherWorkingTreeChanges();
  const problems: string[] = [];

  if (violations.forbiddenDemo.length > 0) {
    problems.push(
      [
        "Forbidden tracked demo artifact changes detected outside tmp/:",
        ...violations.forbiddenDemo.map((entry) => `- ${entry}`),
      ].join("\n"),
    );
  }

  if (violations.binaryPaths.length > 0) {
    problems.push(
      [
        "Forbidden tracked binary changes detected outside tmp/:",
        ...violations.binaryPaths.map((path) => `- ${path}`),
      ].join("\n"),
    );
  }

  if (problems.length > 0) {
    console.error(problems.join("\n\n"));
    process.exit(1);
  }

  const mode = baseRef ? `branch diff against ${baseRef}` : "working tree changes";
  console.log(`validate:repo passed (${mode})`);
}

await main();

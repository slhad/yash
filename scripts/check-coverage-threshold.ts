const MIN_COVERAGE_PERCENT = 80;

const proc = Bun.spawnSync(['bun', 'test', '--coverage'], {
  stdout: 'pipe',
  stderr: 'pipe',
});

const output = `${proc.stdout.toString()}${proc.stderr.toString()}`;
process.stdout.write(output);

if (proc.exitCode !== 0) {
  process.exit(proc.exitCode);
}

const match = output.match(/All files\s+\|\s+([\d.]+)\s+\|\s+([\d.]+)\s+\|/);
if (!match) {
  console.error('[coverage] Could not find the "All files" coverage summary.');
  process.exit(1);
}

const functionsCoverage = Number(match[1]);
const linesCoverage = Number(match[2]);
const failures: string[] = [];

if (functionsCoverage < MIN_COVERAGE_PERCENT) {
  failures.push(`functions ${functionsCoverage.toFixed(2)}% < ${MIN_COVERAGE_PERCENT}%`);
}
if (linesCoverage < MIN_COVERAGE_PERCENT) {
  failures.push(`lines ${linesCoverage.toFixed(2)}% < ${MIN_COVERAGE_PERCENT}%`);
}

if (failures.length > 0) {
  console.error(`[coverage] Minimum coverage requirement failed: ${failures.join(', ')}`);
  process.exit(1);
}

console.log(
  `[coverage] Minimum coverage requirement met: functions ${functionsCoverage.toFixed(2)}%, lines ${linesCoverage.toFixed(2)}%`,
);

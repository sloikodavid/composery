// Bun discovers a test by these parts of its file name, but runs only the tests under the root that
// bunfig.toml sets. A test file anywhere else would never run, and nothing would say so.
const testRoot = "tests/";
const testFileNamePattern =
	/(?:\.test|_test_|\.spec|_spec_)[^/]*\.[cm]?[jt]sx?$/;

const result = Bun.spawnSync(
	["git", "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
	{ stdout: "pipe", stderr: "pipe" },
);
if (!result.success) {
	throw new Error(result.stderr.toString().trim());
}

const misplaced = result.stdout
	.toString()
	.split("\0")
	.filter(
		(path) => testFileNamePattern.test(path) && !path.startsWith(testRoot),
	)
	.sort();

if (misplaced.length > 0) {
	console.error(
		`These test files are outside ${testRoot}, so bun test never runs them:\n${misplaced.map((path) => `  ${path}`).join("\n")}`,
	);
	process.exitCode = 1;
}

import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const scriptPath = resolve(
	repoRoot,
	"rootfs/opt/agentbox/services/code-server.sh",
);
const describeBash = process.platform === "win32" ? describe.skip : describe;

describeBash("code-server service script", () => {
	test("maps Agentbox password auth into code-server config", () => {
		const output = runBash("code_server_config_yaml", {
			AGENTBOX_PASSWORD: "secret",
			PASSWORD: "ignored",
			HASHED_PASSWORD: "ignored",
			CODE_SERVER_CONFIG: "ignored",
			CS_DISABLE_PROXY: "ignored",
		});

		expect(output).toBe(
			'bind-addr: 127.0.0.1:13337\nauth: password\npassword: "secret"\ncert: false\n',
		);
	});

	test("maps Agentbox hashed password into code-server config", () => {
		const output = runBash("code_server_config_yaml", {
			AGENTBOX_HASHED_PASSWORD: "hashed",
		});

		expect(output).toContain("auth: password");
		expect(output).toContain('hashed-password: "hashed"');
	});

	test("supports explicit auth none", () => {
		const output = runBash("code_server_config_yaml", {
			AGENTBOX_AUTH: "none",
		});

		expect(output).toContain("auth: none");
		expect(output).not.toContain("password:");
	});

	test("renders sanitized child env", () => {
		const output = runBash(
			'build_code_server_env; printf "%s\\n" "${CODE_SERVER_ENV[@]}"',
			{
				AGENTBOX_PASSWORD: "secret",
				PATH: "/bin:/usr/bin",
				PORT: "18080",
				PASSWORD: "ignored",
				HASHED_PASSWORD: "ignored",
				CODE_SERVER_CONFIG: "ignored",
				CS_DISABLE_PROXY: "ignored",
			},
		);
		const env = output.trim().split("\n");

		expect(env).toContain("PATH=/bin:/usr/bin");
		expect(env).toContain("VSCODE_PROXY_URI=./proxy/{{port}}");
		expect(env).not.toContain("PORT=18080");
		expect(env.some((entry) => entry.startsWith("PASSWORD="))).toBe(false);
		expect(env.some((entry) => entry.startsWith("HASHED_PASSWORD="))).toBe(
			false,
		);
		expect(env.some((entry) => entry.startsWith("CODE_SERVER_CONFIG="))).toBe(
			false,
		);
		expect(env.some((entry) => entry.startsWith("CS_DISABLE_PROXY="))).toBe(
			false,
		);
	});

	test("renders code-server args from Agentbox policy", () => {
		const output = runBash(
			'build_code_server_args; printf "%s\\n" "${CODE_SERVER_ARGS[@]}"',
			{
				AGENTBOX_WORKSPACE_PATH: "/workspace",
				AGENTBOX_DISABLE_FILE_DOWNLOADS: "true",
				AGENTBOX_DISABLE_FILE_UPLOADS: "yes",
				AGENTBOX_PUBLIC_URL: "http://localhost:8080/agentbox",
				AGENTBOX_PUBLIC_PROXY_URL_TEMPLATE: "https://{{port}}.box.example.com",
			},
		);
		const args = output.trim().split("\n");

		expect(args).toContain("/workspace");
		expect(args).toContain("--config");
		expect(args).toContain("/run/code-server/config.yaml");
		expect(args).toContain("--bind-addr");
		expect(args).toContain("127.0.0.1:13337");
		expect(args).toContain("--disable-update-check");
		expect(args).toContain("--disable-file-downloads");
		expect(args).toContain("--disable-file-uploads");
		expect(args).toContain("--abs-proxy-base-path");
		expect(args).toContain("/agentbox");
		expect(args).toContain("--proxy-domain");
		expect(args).toContain("{{port}}.box.example.com");
	});
});

function runBash(source: string, env: NodeJS.ProcessEnv): string {
	const result = spawnSync(
		"bash",
		[
			"-lc",
			`source ${shellQuote(scriptPath)}; NODE_BIN=${shellQuote(process.execPath)}; ${source}`,
		],
		{
			encoding: "utf8",
			env: {
				...process.env,
				...env,
			},
		},
	);
	if (result.status !== 0) {
		throw new Error(
			`bash exited ${result.status}\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
		);
	}
	return result.stdout;
}

function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}

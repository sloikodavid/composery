#!/usr/bin/env node
import { execFile } from "node:child_process";
import { Buffer } from "node:buffer";
import { readFile, rename, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const run = promisify(execFile);
const tool = dirname(fileURLToPath(import.meta.url));
const root = resolve(tool, "../../../..");
const pagePath = resolve(tool, "index.html");
const themePath = resolve(root, "packages/shared/theme.json");
const port = Number(process.env.PORT ?? 7331);
const origins = new Set([
	`http://127.0.0.1:${port}`,
	`http://localhost:${port}`
]);

function buildAssets() {
	return process.platform === "win32"
		? run(
				process.env.ComSpec ?? "cmd.exe",
				["/d", "/s", "/c", "pnpm.cmd assets"],
				{ cwd: root }
			)
		: run("pnpm", ["assets"], { cwd: root });
}

function validTheme(value, shape) {
	if (
		!value ||
		typeof value !== "object" ||
		Object.keys(value).join() !== "web,ide"
	)
		return false;
	for (const area of ["web", "ide"]) {
		if (!value[area] || Object.keys(value[area]).join() !== "light,dark")
			return false;
		for (const scheme of ["light", "dark"]) {
			if (
				!value[area][scheme] ||
				Object.keys(value[area][scheme]).join() !==
					Object.keys(shape[area][scheme]).join()
			)
				return false;
			if (
				!Object.values(value[area][scheme]).every(
					(color) =>
						typeof color === "string" &&
						/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(color)
				)
			)
				return false;
		}
	}
	return true;
}

async function readBody(request) {
	const chunks = [];
	let bytes = 0;
	for await (const chunk of request) {
		bytes += chunk.length;
		if (bytes > 64 * 1024) throw new Error("request is too large");
		chunks.push(chunk);
	}
	return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function saveTheme(next) {
	const before = await readFile(themePath, "utf8");
	const shape = JSON.parse(before);
	if (!validTheme(next, shape)) throw new Error("invalid theme");
	const temporary = `${themePath}.${process.pid}.tmp`;
	const write = async (contents) => {
		await writeFile(temporary, contents, "utf8");
		await rename(temporary, themePath);
	};
	await write(`${JSON.stringify(next, null, "\t")}\n`);
	try {
		await buildAssets();
	} catch (error) {
		await write(before);
		await buildAssets().catch(() => {});
		throw error;
	}
}

const server = createServer(async (request, response) => {
	try {
		if (request.method === "GET" && request.url === "/") {
			response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
			return response.end(await readFile(pagePath));
		}
		if (request.method === "GET" && request.url === "/theme") {
			response.writeHead(200, {
				"content-type": "application/json",
				"cache-control": "no-store"
			});
			return response.end(await readFile(themePath));
		}
		if (request.method === "PUT" && request.url === "/theme") {
			if (!origins.has(request.headers.origin))
				throw new Error("request did not come from this colors editor");
			await saveTheme(await readBody(request));
			response.writeHead(204);
			return response.end();
		}
		response.writeHead(404);
		response.end("not found");
	} catch (error) {
		response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
		response.end(String(error?.message ?? error));
	}
});

server.listen(port, "127.0.0.1", () =>
	console.log(`colors: http://127.0.0.1:${port}`)
);

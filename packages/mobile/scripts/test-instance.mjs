import { createServer } from "node:http";

const port = Number(process.env.COMPOSERY_TEST_INSTANCE_PORT ?? 4173);
if (!Number.isInteger(port) || port < 1 || port > 65_535) {
	throw new RangeError(
		"COMPOSERY_TEST_INSTANCE_PORT must be an integer from 1 to 65535"
	);
}

const server = createServer((request, response) => {
	if (request.url === "/_composery") {
		response.writeHead(200, { "content-type": "application/json" });
		response.end('{"composery":true}');
		return;
	}
	if (request.url === "/ide/version") {
		response.writeHead(200, { "content-type": "text/plain" });
		response.end("0000000");
		return;
	}

	response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
	response.end(`<!doctype html>
<html><head><meta name="viewport" content="width=device-width"></head>
<body style="font-family:sans-serif"><h1>Composery test instance</h1>
<a href="https://example.com/" id="external-link">External link</a></body></html>`);
});

server.listen(port, "0.0.0.0", () => {
	console.log(`Composery test instance listening on ${port}`);
});

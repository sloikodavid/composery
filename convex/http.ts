import { httpRouter } from "convex/server";
import { receiveClerkWebhook } from "./clerk_http";
import { registerSshHostKey } from "./ssh/bootstrap_http";

const http = httpRouter();

http.route({
	path: "/ssh/host-keys",
	method: "POST",
	handler: registerSshHostKey,
});

http.route({
	path: "/webhooks/clerk",
	method: "POST",
	handler: receiveClerkWebhook,
});

export default http;

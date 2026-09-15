import { httpRouter } from "convex/server";
import { receiveClerkWebhook } from "./clerk";
import { registerSshHostKey } from "./ssh/access_http";

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

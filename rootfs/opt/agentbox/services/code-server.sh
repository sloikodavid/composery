#!/usr/bin/env bash
set -euo pipefail

args=(
  /home/user/Desktop
  --auth none
  --bind-addr 127.0.0.1:13337
  --disable-update-check
)

agentbox_config_json="$(
  node --input-type=module <<'JS'
import { parseConfig } from "/opt/agentbox/config.ts";

const config = parseConfig(process.env, { loadTlsFiles: false });
console.log(JSON.stringify({
	basePath: config.basePath,
	publicProxyUrlTemplate: config.publicProxyUrlTemplate,
	proxyDomain: config.proxyDomain ?? "",
}));
JS
)"

base_path="$(jq -r .basePath <<<"$agentbox_config_json")"
public_proxy_url_template="$(jq -r .publicProxyUrlTemplate <<<"$agentbox_config_json")"
proxy_domain="$(jq -r .proxyDomain <<<"$agentbox_config_json")"

if [[ "$base_path" != "/" ]]; then
  args+=(--abs-proxy-base-path "$base_path")
fi
if [[ -n "$proxy_domain" ]]; then
  args+=(--proxy-domain "$proxy_domain")
fi

# `PORT` configures the public Agentbox gateway. code-server has its own
# fixed loopback listener behind that gateway, so clear the public port env to
# avoid code-server rebinding it.
unset PORT
export VSCODE_PROXY_URI="$public_proxy_url_template"
exec /usr/local/bin/code-server "${args[@]}"

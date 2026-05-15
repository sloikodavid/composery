#!/usr/bin/env bash
set -euo pipefail

CODE_SERVER_BIN="/usr/local/bin/code-server"
CODE_SERVER_BIND_ADDR="127.0.0.1:13337"
CODE_SERVER_CONFIG_PATH="/run/code-server/config.yaml"
CODE_SERVER_WORKSPACE_PATH_DEFAULT="/home/user/Desktop"
CODE_SERVER_PUBLIC_URL_DEFAULT="http://localhost"
CODE_SERVER_PUBLIC_PROXY_URL_TEMPLATE_DEFAULT="./proxy/{{port}}"
NODE_BIN="/usr/local/bin/node"

CHILD_HOME="/home/user"
CHILD_USER="user"
CHILD_SHELL="/bin/bash"
CHILD_PATH_DEFAULT="/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"

die() {
	echo "$*" >&2
	exit 2
}

trim() {
	local value="${1-}"
	value="${value#"${value%%[![:space:]]*}"}"
	value="${value%"${value##*[![:space:]]}"}"
	printf '%s' "$value"
}

env_string() {
	trim "${!1-}"
}

yaml_string() {
	"$NODE_BIN" -e 'process.stdout.write(JSON.stringify(process.argv[1] ?? ""));' -- "$1"
}

code_server_auth_type() {
	local auth_type
	auth_type="$(env_string AGENTBOX_AUTH)"
	printf '%s' "${auth_type:-password}"
}

validate_code_server_auth() {
	local auth_type="$1"
	local password="$2"
	local hashed_password="$3"

	if [[ "$auth_type" != "password" && "$auth_type" != "none" ]]; then
		die "AGENTBOX_AUTH must be password or none"
	fi
	if [[ -n "$password" && -n "$hashed_password" ]]; then
		die "AGENTBOX_PASSWORD and AGENTBOX_HASHED_PASSWORD must not both be set"
	fi
	if [[ "$auth_type" == "password" && -z "$password" && -z "$hashed_password" ]]; then
		die "AGENTBOX_PASSWORD or AGENTBOX_HASHED_PASSWORD is required when AGENTBOX_AUTH=password"
	fi
	if [[ "$auth_type" == "none" && ( -n "$password" || -n "$hashed_password" ) ]]; then
		die "AGENTBOX_PASSWORD and AGENTBOX_HASHED_PASSWORD must not be set when AGENTBOX_AUTH=none"
	fi
}

code_server_config_yaml() {
	local auth_type password hashed_password
	auth_type="$(code_server_auth_type)"
	password="$(env_string AGENTBOX_PASSWORD)"
	hashed_password="$(env_string AGENTBOX_HASHED_PASSWORD)"
	validate_code_server_auth "$auth_type" "$password" "$hashed_password"

	printf 'bind-addr: %s\n' "$CODE_SERVER_BIND_ADDR"
	if [[ "$auth_type" == "none" ]]; then
		printf 'auth: none\n'
	else
		printf 'auth: password\n'
	fi
	if [[ -n "$password" ]]; then
		local quoted_password
		quoted_password="$(yaml_string "$password")"
		printf 'password: %s\n' "$quoted_password"
	fi
	if [[ -n "$hashed_password" ]]; then
		local quoted_hashed_password
		quoted_hashed_password="$(yaml_string "$hashed_password")"
		printf 'hashed-password: %s\n' "$quoted_hashed_password"
	fi
	printf 'cert: false\n'
}

write_code_server_config() {
	mkdir -p "$(dirname "$CODE_SERVER_CONFIG_PATH")"
	code_server_config_yaml > "$CODE_SERVER_CONFIG_PATH"
	chmod 600 "$CODE_SERVER_CONFIG_PATH"

	if [[ "$(code_server_auth_type)" == "none" ]]; then
		echo "[agentbox-code-server] WARNING: AGENTBOX_AUTH=none disables workspace authentication. Only use behind trusted external access control." >&2
	fi
}

boolean_enabled() {
	local name="$1"
	local value
	value="$(env_string "$name")"

	case "${value,,}" in
		1|true|yes|on)
			return 0
			;;
		""|0|false|no|off)
			return 1
			;;
		*)
			die "$name must be a boolean (1/0, true/false, yes/no, on/off)"
			;;
	esac
}

base_url_path() {
	local public_url
	public_url="$(env_string AGENTBOX_PUBLIC_URL)"
	public_url="${public_url:-$CODE_SERVER_PUBLIC_URL_DEFAULT}"
	"$NODE_BIN" -e '
const fail = () => {
	console.error("AGENTBOX_PUBLIC_URL must be a valid absolute http/https URL without query or fragment");
	process.exit(2);
};
try {
	const url = new URL(process.argv[1]);
	if ((url.protocol !== "http:" && url.protocol !== "https:") || url.search || url.hash || url.username || url.password) fail();
	let result = url.pathname.trim() || "/";
	result = result.startsWith("/") ? result : `/${result}`;
	while (result.length > 1 && result.endsWith("/")) result = result.slice(0, -1);
	process.stdout.write(result);
} catch {
	fail();
}
' -- "$public_url"
}

proxy_hostname_template() {
	local template
	template="$(env_string AGENTBOX_PUBLIC_PROXY_URL_TEMPLATE)"
	template="${template:-$CODE_SERVER_PUBLIC_PROXY_URL_TEMPLATE_DEFAULT}"
	if [[ "$template" == ./* ]]; then
		return 0
	fi
	"$NODE_BIN" -e '
const fail = () => {
	console.error("AGENTBOX_PUBLIC_PROXY_URL_TEMPLATE must be relative or an absolute http/https URL containing {{port}}");
	process.exit(2);
};
try {
	const value = process.argv[1];
	if (!value.includes("{{port}}")) fail();
	const url = new URL(value);
	if ((url.protocol !== "http:" && url.protocol !== "https:") || url.search || url.hash || url.username || url.password) fail();
	if (url.hostname.includes("{{port}}")) process.stdout.write(url.hostname);
} catch {
	fail();
}
' -- "$template"
}

CODE_SERVER_ENV=()

append_code_server_env() {
	CODE_SERVER_ENV+=("$1=$2")
}

copy_env_if_set() {
	local name="$1"
	if [[ -v $name ]]; then
		append_code_server_env "$name" "${!name}"
	fi
}

build_code_server_env() {
	local child_path public_proxy_url_template
	CODE_SERVER_ENV=()
	child_path="$CHILD_PATH_DEFAULT"
	if [[ -v PATH ]]; then
		child_path="$PATH"
	fi
	public_proxy_url_template="$(env_string AGENTBOX_PUBLIC_PROXY_URL_TEMPLATE)"
	public_proxy_url_template="${public_proxy_url_template:-$CODE_SERVER_PUBLIC_PROXY_URL_TEMPLATE_DEFAULT}"

	append_code_server_env HOME "$CHILD_HOME"
	append_code_server_env USER "$CHILD_USER"
	append_code_server_env SHELL "$CHILD_SHELL"
	append_code_server_env PATH "$child_path"
	append_code_server_env EDITOR "code --wait"
	append_code_server_env VISUAL "code --wait"
	append_code_server_env GIT_EDITOR "code --wait"
	append_code_server_env KUBE_EDITOR "code --wait"
	append_code_server_env VSCODE_PROXY_URI "$public_proxy_url_template"
	copy_env_if_set LANG
	copy_env_if_set LC_ALL
	copy_env_if_set TZ
	copy_env_if_set HTTP_PROXY
	copy_env_if_set HTTPS_PROXY
	copy_env_if_set NO_PROXY
	copy_env_if_set http_proxy
	copy_env_if_set https_proxy
	copy_env_if_set no_proxy
}

CODE_SERVER_ARGS=()

build_code_server_args() {
	local workspace_path public_base_path public_proxy_hostname
	CODE_SERVER_ARGS=()
	workspace_path="$(env_string AGENTBOX_WORKSPACE_PATH)"
	workspace_path="${workspace_path:-$CODE_SERVER_WORKSPACE_PATH_DEFAULT}"

	CODE_SERVER_ARGS+=(
		"$workspace_path"
		"--config"
		"$CODE_SERVER_CONFIG_PATH"
		"--bind-addr"
		"$CODE_SERVER_BIND_ADDR"
		"--disable-update-check"
	)

	if boolean_enabled AGENTBOX_DISABLE_FILE_DOWNLOADS; then
		CODE_SERVER_ARGS+=("--disable-file-downloads")
	fi
	if boolean_enabled AGENTBOX_DISABLE_FILE_UPLOADS; then
		CODE_SERVER_ARGS+=("--disable-file-uploads")
	fi

	public_base_path="$(base_url_path)"
	if [[ "$public_base_path" != "/" ]]; then
		CODE_SERVER_ARGS+=("--abs-proxy-base-path" "$public_base_path")
	fi

	public_proxy_hostname="$(proxy_hostname_template)"
	if [[ -n "$public_proxy_hostname" ]]; then
		CODE_SERVER_ARGS+=("--proxy-domain" "$public_proxy_hostname")
	fi
}

main() {
	write_code_server_config
	build_code_server_env
	build_code_server_args
	exec env -i "${CODE_SERVER_ENV[@]}" "$CODE_SERVER_BIN" "${CODE_SERVER_ARGS[@]}"
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
	main "$@"
fi

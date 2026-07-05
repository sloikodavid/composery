const { getDefaultConfig } = require("expo/metro-config");

const config = getDefaultConfig(__dirname);

const generatedWorkspacePaths = [
	/^(?:build|tmp)(?:[/\\]|$)/,
	/^(?:\.\.[/\\])?ide[/\\](?:build|tmp)(?:[/\\]|$)/,
	/(?:^|[/\\])packages[/\\]ide[/\\](?:build|tmp)(?:[/\\]|$)/,
	/^(?:\.\.[/\\])?cli[/\\]target(?:[/\\]|$)/,
	/(?:^|[/\\])packages[/\\]cli[/\\]target(?:[/\\]|$)/
];

config.resolver.blockList = [
	...[].concat(config.resolver.blockList ?? []),
	...generatedWorkspacePaths
];

module.exports = config;

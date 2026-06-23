import { promises as fs } from "fs";
import { dump, load } from "js-yaml";
import * as path from "path";
import * as express from "express";
import { getPasswordMethod, handlePasswordValidation } from "../util";

type ConfigFile = {
	auth?: string;
	password?: string;
	"hashed-password"?: string;
};

export const hasPassword = (req: express.Request): boolean =>
	!!(req.args.password || req.args["hashed-password"]);

export const isEnvPasswordManaged = (req: express.Request): boolean =>
	!!(req.args.usingEnvPassword || req.args.usingEnvHashedPassword);

let passwordConfigWriteQueue: Promise<void> = Promise.resolve();

const withPasswordConfigWriteLock = async <T>(
	write: () => Promise<T>
): Promise<T> => {
	const previousWrite = passwordConfigWriteQueue;
	let releaseWrite: (() => void) | undefined;
	passwordConfigWriteQueue = new Promise<void>((resolve) => {
		releaseWrite = resolve;
	});

	await previousWrite;
	try {
		return await write();
	} finally {
		releaseWrite?.();
	}
};

const readConfig = async (configPath: string): Promise<ConfigFile> => {
	let configFile = "";
	try {
		configFile = await fs.readFile(configPath, "utf8");
	} catch (error: any) {
		if (error.code !== "ENOENT") {
			throw error;
		}
	}

	const config = configFile ? load(configFile, { filename: configPath }) : {};
	if (!config || typeof config === "string" || Array.isArray(config)) {
		throw new Error(`invalid config: ${config}`);
	}

	return config as ConfigFile;
};

export const writeHashedPassword = async (
	req: express.Request,
	hashedPassword: string,
	options?: { allowExisting?: boolean }
): Promise<boolean> => {
	const configPath = req.args.config;
	if (!configPath) {
		throw new Error("Missing config path");
	}

	await fs.mkdir(path.dirname(configPath), { recursive: true });
	return await withPasswordConfigWriteLock(async () => {
		const config = await readConfig(configPath);
		if (
			(config.password || config["hashed-password"]) &&
			!options?.allowExisting
		) {
			return false;
		}

		config.auth = "password";
		delete config.password;
		config["hashed-password"] = hashedPassword;
		// Write atomically so a crash mid-write can't corrupt the auth config.
		const tmpPath = `${configPath}.${process.pid}.tmp`;
		await fs.writeFile(tmpPath, dump(config, { lineWidth: -1 }));
		await fs.rename(tmpPath, configPath);

		req.args.password = undefined;
		req.args["hashed-password"] = hashedPassword;
		req.args.usingEnvPassword = false;
		req.args.usingEnvHashedPassword = false;
		return true;
	});
};

export const validateExistingPassword = async (
	req: express.Request,
	password: string
): Promise<boolean> => {
	const hashedPasswordFromArgs = req.args["hashed-password"];
	const passwordMethod = getPasswordMethod(hashedPasswordFromArgs);
	const { isPasswordValid } = await handlePasswordValidation({
		passwordMethod,
		hashedPasswordFromArgs,
		passwordFromRequestBody: password,
		passwordFromArgs: req.args.password
	});

	return isPasswordValid;
};

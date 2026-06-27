import { defineConfig } from "eslint/config";
import expoConfig from "eslint-config-expo/flat.js";

// Extends the Expo flat config (JSX, TypeScript, React Native globals, Expo
// rules). Generated/build files are ignored.
export default defineConfig([
	...expoConfig,
	{
		ignores: ["dist/**", ".expo/**", "expo-env.d.ts"]
	}
]);

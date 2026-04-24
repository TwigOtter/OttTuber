import { defineConfig } from "eslint/config";
import tseslint from "typescript-eslint";
import prettier from "eslint-plugin-prettier/recommended";

export default defineConfig([
	tseslint.configs.recommended,
	prettier,
	{
		ignores: ["out/**", "scripts/**"],
	},
]);

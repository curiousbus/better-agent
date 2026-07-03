/** @type {import('eslint').Linter.Config} */
export default [
	{
		ignores: [
			"**/node_modules/**",
			"**/dist/**",
			"**/build/**",
			"**/.next/**",
			"**/.turbo/**",
			"**/*.config.{js,ts}",
			"**/routeTree.gen.ts",
			"apps/authz/app/**",
			// vendored shadcn primitives keep upstream shape (size/complexity)
			"packages/ui/src/components/sidebar.tsx",
		],
	},
	{
		files: ["**/*.ts", "**/*.tsx"],
		languageOptions: {
			parser: await import("@typescript-eslint/parser"),
			parserOptions: {
				ecmaVersion: "latest",
				sourceType: "module",
				project: ["./**/tsconfig.json"],
			},
		},
		plugins: {
			"@typescript-eslint": (await import("@typescript-eslint/eslint-plugin"))
				.default,
		},
		rules: {
			// 禁止非空断言
			"@typescript-eslint/no-non-null-assertion": "error",

			// 禁止 any
			"@typescript-eslint/no-explicit-any": "error",

			// 强制使用 readonly (警告级别)
			"@typescript-eslint/prefer-readonly": "warn",

			// 函数行数限制
			"max-lines-per-function": [
				"error",
				{
					max: 50,
					skipBlankLines: true,
					skipComments: true,
				},
			],

			// 圈复杂度
			complexity: ["error", 10],

			// 魔术数字
			"no-magic-numbers": [
				"warn",
				{
					ignore: [-1, 0, 1],
					ignoreArrayIndexes: true,
					ignoreDefaultValues: true,
					ignoreEnums: true,
				},
			],

			// 参数个数限制
			"max-params": ["warn", 4],

			// 嵌套层数限制
			"max-depth": ["warn", 4],

			// 禁止 console.log
			"no-console": "warn",

			// 必须返回值
			"consistent-return": "error",
		},
	},
];

#!/usr/bin/env node

/**
 * 自定义代码规则检查
 * - 文件命名:
 *   - 组件文件 (.tsx): PascalCase 或简单小写 (如 label.tsx, button.tsx)
 *   - 其他文件: kebab-case
 * - 文件行数: 不超过 300 行
 */

// biome-ignore-all lint/suspicious/noConsole: CLI 检查脚本，需向终端输出检查结果

import { readFileSync } from "node:fs";

const MAX_LINES = 300;

// 去除文件扩展名的正则
const EXTENSION = /\.(tsx?|jsx?)$/;

// 常见例外文件名（约定俗成，无需检查命名）
const EXCEPTIONS = [
	"index",
	"_app",
	"_document",
	"_error",
	"layout",
	"loading",
	"error",
	"page",
	"template",
	"not-found",
	"route",
	"routes",
	"server",
	"client",
	"main",
	"app",
	"root",
	"__root", // TanStack Router 根路由
	"routeTree.gen", // TanStack Router 自动生成的路由树
];

// kebab-case 正则（支持多段扩展名，如 .config.ts、.test.ts、.gen.ts）
const KEBAB_CASE = /^[a-z0-9]+(-[a-z0-9]+)*(\.[a-z0-9]+)*$/;

// PascalCase 正则（组件文件）
const PASCAL_CASE = /^[A-Z][a-zA-Z0-9]*(\.(test|spec))?\.tsx?$/;

function checkFileName(filePath) {
	const fileName = filePath.split("/").pop();
	const baseName = fileName.replace(EXTENSION, "");

	// 检查例外文件名
	if (EXCEPTIONS.includes(baseName)) {
		return { valid: true };
	}

	// TSX 组件文件允许 PascalCase 或 kebab-case（shadcn 约定，如 dropdown-menu.tsx）
	if (fileName.endsWith(".tsx")) {
		if (PASCAL_CASE.test(fileName) || KEBAB_CASE.test(fileName)) {
			return { valid: true };
		}
		return {
			valid: false,
			error:
				"TSX 组件文件应使用 PascalCase (如 UserProfile.tsx) 或 kebab-case (如 dropdown-menu.tsx)",
		};
	}

	// 其他文件使用 kebab-case
	if (KEBAB_CASE.test(fileName)) {
		return { valid: true };
	}

	return {
		valid: false,
		error: "文件名应使用 kebab-case，如: user-profile.ts",
	};
}

function checkFileLines(content) {
	const lines = content.split("\n").length;

	if (lines > MAX_LINES) {
		return {
			valid: false,
			error: `文件超过 ${MAX_LINES} 行 (当前: ${lines} 行)`,
		};
	}

	return { valid: true };
}

function main() {
	const files = process.argv.slice(2);

	if (files.length === 0) {
		console.log("没有文件需要检查");
		process.exit(0);
	}

	let hasErrors = false;

	for (const file of files) {
		try {
			// 检查文件命名
			const nameCheck = checkFileName(file);
			if (!nameCheck.valid) {
				console.error(`\n❌ ${file}`);
				console.error(`   ${nameCheck.error}`);
				hasErrors = true;
			}

			// 检查文件行数
			const content = readFileSync(file, "utf-8");
			const linesCheck = checkFileLines(content);
			if (!linesCheck.valid) {
				console.error(`\n❌ ${file}`);
				console.error(`   ${linesCheck.error}`);
				hasErrors = true;
			}
		} catch {
			// 忽略无法读取的文件
		}
	}

	if (hasErrors) {
		console.error("\n❌ 文件规则检查失败");
		process.exit(1);
	}

	console.log("✅ 文件规则检查通过");
	process.exit(0);
}

main();

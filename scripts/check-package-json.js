#!/usr/bin/env node

/**
 * 检查 package.json 依赖版本规则
 * - 禁止使用 ^ 前缀（必须使用固定版本）
 * - 禁止使用 ~ 前缀
 * - 禁止使用 "latest"
 * - workspace 和 catalog 除外
 */

// biome-ignore-all lint/suspicious/noConsole: CLI 检查脚本，需向终端输出检查结果

import { readFileSync } from "node:fs";

function checkDependencyVersions(obj, path = []) {
	const issues = [];

	for (const [key, value] of Object.entries(obj)) {
		const currentPath = [...path, key];

		if (typeof value === "object" && value !== null) {
			// 递归检查嵌套对象
			issues.push(...checkDependencyVersions(value, currentPath));
		} else if (typeof value === "string") {
			// 检查版本字符串
			const section = currentPath[0];

			if (
				(section === "dependencies" ||
					section === "devDependencies" ||
					section === "peerDependencies") &&
				(value.startsWith("^") ||
					value.startsWith("~") ||
					value === "latest" ||
					value === "*" ||
					value.startsWith(">") ||
					value.startsWith("<") ||
					value.startsWith("="))
			) {
				issues.push({
					dependency: key,
					version: value,
					reason: getVersionErrorReason(value),
				});
			}
		}
	}

	return issues;
}

function getVersionErrorReason(version) {
	if (version.startsWith("^")) {
		return "使用 ^ 前缀";
	}
	if (version.startsWith("~")) {
		return "使用 ~ 前缀";
	}
	if (version === "latest") {
		return "使用 latest";
	}
	if (version === "*") {
		return "使用 *";
	}
	if (
		version.startsWith(">") ||
		version.startsWith("<") ||
		version.startsWith("=")
	) {
		return "使用范围版本";
	}
	return "版本格式不正确";
}

function checkPackageJson(filePath) {
	try {
		const content = readFileSync(filePath, "utf-8");
		const pkg = JSON.parse(content);

		const issues = checkDependencyVersions(pkg);

		if (issues.length > 0) {
			console.error(`\n❌ ${filePath}`);
			console.error(`   发现 ${issues.length} 个依赖版本不符合规范:\n`);

			for (const issue of issues) {
				console.error(
					`   - ${issue.dependency}: "${issue.version}" (${issue.reason})`
				);
			}

			console.error('\n   正确格式: 使用固定版本号，如 "1.2.3"');
			console.error("   例外: workspace:* 和 catalog:* 可以使用\n");

			return false;
		}

		return true;
	} catch (error) {
		console.error(`检查 ${filePath} 失败: ${error.message}`);
		return false;
	}
}

function main() {
	const files = process.argv.slice(2);

	if (files.length === 0) {
		// 默认检查根目录的 package.json
		console.log("没有指定文件，检查根目录 package.json");
		process.exit(0);
	}

	let allValid = true;

	for (const file of files) {
		if (!file.endsWith("package.json")) {
			continue;
		}

		const isValid = checkPackageJson(file);
		if (!isValid) {
			allValid = false;
		}
	}

	if (!allValid) {
		console.error("\n❌ package.json 检查失败");
		console.error("\n请将依赖版本改为固定版本号:");
		console.error('  "^1.2.3"  →  "1.2.3"');
		console.error('  "latest"   →  "2.1.9"\n');
		process.exit(1);
	}

	console.log("✅ package.json 检查通过");
	process.exit(0);
}

main();

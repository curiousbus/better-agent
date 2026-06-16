#!/usr/bin/env node

/**
 * 检查 Tailwind CSS 任意值使用
 * - 禁止使用任意值语法，如 w-[96px]、h-[50%]、bg-[#fff]
 * - 只允许使用标准的 Tailwind 类名
 */

// biome-ignore-all lint/suspicious/noConsole: CLI 检查脚本，需向终端输出检查结果

import { readFileSync } from "node:fs";

// 任意值正则：匹配 [xxx] 格式
const ARBITRARY_VALUE_PATTERN = /\[[^\]]+\]/g;

/**
 * 判断中括号语法是否为「结构性任意值」（允许），而非「设计令牌旁路」（禁止）。
 * 允许：
 * - 任意选择器变体：[&>svg]、[&_p]（以 & 开头）
 * - 属性/状态选择器：data-[size=sm]、[state=checked]（含 =）
 * - 多值布局：grid-rows-[auto_1fr]、calc(100%_-_8px)（含 _，下划线代表空格）
 * - 任意变体（其后紧跟 :）：data-[...]:、min-[600px]:、[&>svg]:
 * 禁止：w-[96px]、h-[50%]、bg-[#fff]、p-[1.5rem] 这类设计值旁路。
 */
function isStructuralArbitrary(inner, charAfter) {
	return (
		inner.startsWith("&") ||
		inner.includes("_") ||
		inner.includes("=") ||
		charAfter === ":"
	);
}

// 检查一行中的类名
function checkLineForArbitraryValues(line, lineNumber) {
	const issues = [];

	// 查找所有可能的类名位置
	// 匹配 className=, class:, tw` 等模式
	const classNamePatterns = [
		/(?:className|class)\s*=\s*[{("']([^{}()"']*)[})"']/g,
		/tw`([^`]*)`/g,
		/cn\(([^)]*)\)/g,
		/clsx\(([^)]*)\)/g,
		/cva\(([^)]*)\)/g,
	];

	for (const pattern of classNamePatterns) {
		for (const match of line.matchAll(pattern)) {
			const classNames = match[1];

			// 查找任意值
			const arbitraryMatches = classNames.matchAll(ARBITRARY_VALUE_PATTERN);

			for (const arbitraryMatch of arbitraryMatches) {
				const value = arbitraryMatch[0]; // 含中括号，如 "[96px]"
				const inner = value.slice(1, -1);
				const charAfter = classNames[arbitraryMatch.index + value.length];

				if (isStructuralArbitrary(inner, charAfter)) {
					continue;
				}

				issues.push({
					line: lineNumber,
					value,
					context: line.trim().slice(0, 60),
				});
			}
		}
	}

	return issues;
}

// 检查文件
function checkFile(filePath) {
	try {
		const content = readFileSync(filePath, "utf-8");
		const lines = content.split("\n");
		const issues = [];

		for (const [index, line] of lines.entries()) {
			const lineIssues = checkLineForArbitraryValues(line, index + 1);
			issues.push(...lineIssues);
		}

		return issues;
	} catch {
		return [];
	}
}

function main() {
	const files = process.argv.slice(2);

	if (files.length === 0) {
		console.log("没有文件需要检查");
		process.exit(0);
	}

	let hasErrors = false;

	for (const file of files) {
		// 只检查 TSX/TS/JSX/JS 文件
		if (
			!(
				file.endsWith(".tsx") ||
				file.endsWith(".ts") ||
				file.endsWith(".jsx") ||
				file.endsWith(".js")
			)
		) {
			continue;
		}

		const issues = checkFile(file);

		if (issues.length > 0) {
			console.error(`\n❌ ${file}`);
			console.error(`   发现 ${issues.length} 处 Tailwind 任意值使用:\n`);

			for (const issue of issues) {
				console.error(`   第 ${issue.line} 行: ${issue.value}`);
				console.error(`   上下文: ${issue.context}...`);
			}

			hasErrors = true;
		}
	}

	if (hasErrors) {
		console.error("\n❌ Tailwind CSS 检查失败");
		console.error("\n请使用标准 Tailwind 类名:");
		console.error('  "w-[96px]"    →  "w-24"');
		console.error('  "h-[50%]"     →  "h-1/2"');
		console.error('  "bg-[#fff]"   →  "bg-white"');
		console.error('  "p-[1.5rem]"  →  "p-6"');
		console.error("\n如果必须使用自定义值，请在 tailwind.config.js 中定义:\n");
		console.error("  module.exports = {");
		console.error("    theme: {");
		console.error("      extend: {");
		console.error("        width: { '96': '24rem' }");
		console.error("      }");
		console.error("    }");
		console.error("  }\n");
		process.exit(1);
	}

	console.log("✅ Tailwind CSS 检查通过");
	process.exit(0);
}

main();

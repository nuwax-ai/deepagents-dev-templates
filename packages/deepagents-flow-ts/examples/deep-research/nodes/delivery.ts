/**
 * 最终交付节点：在报告收尾时问询用户保存位置，并生成 Markdown + HTML 文件。
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { interrupt, type LangGraphRunnableConfig } from "@langchain/langgraph";
import type { AppConfig } from "../../../src/runtime/index.js";
import { resolveSessionDir } from "../../../src/runtime/services/file-checkpoint-saver.js";
import type { DeliveryArtifacts, ResearchStateShape } from "./types.js";

function safeSegment(text: string): string {
  const cleaned = text
    .trim()
    .replace(/[^\w\u4e00-\u9fa5.-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return cleaned || "deep-research-report";
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 轻量 Markdown → HTML。这里只覆盖报告常用结构，避免新增依赖。
 * 复杂 Markdown 仍会以安全文本形式保留在段落中。
 */
export function markdownToHtml(markdown: string, title = "Deep Research Report"): string {
  const body = markdown
    .split(/\n{2,}/)
    .map((block) => {
      const trimmed = block.trim();
      if (!trimmed) return "";
      const heading = trimmed.match(/^(#{1,6})\s+(.+)$/);
      if (heading) {
        const level = heading[1]!.length;
        return `<h${level}>${escapeHtml(heading[2]!)}</h${level}>`;
      }
      const lines = trimmed.split("\n");
      if (lines.every((line) => /^[-*]\s+/.test(line.trim()))) {
        return `<ul>${lines
          .map((line) => `<li>${escapeHtml(line.trim().replace(/^[-*]\s+/, ""))}</li>`)
          .join("")}</ul>`;
      }
      return `<p>${escapeHtml(trimmed).replace(/\n/g, "<br>")}</p>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(title)}</title>
  <style>
    body { max-width: 860px; margin: 40px auto; padding: 0 24px; font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #172033; }
    h1, h2, h3 { line-height: 1.25; margin-top: 1.6em; }
    h1 { border-bottom: 1px solid #e5e7eb; padding-bottom: .35em; }
    p, li { color: #2f3a4a; }
    ul { padding-left: 1.4em; }
  </style>
</head>
<body>
${body}
</body>
</html>
`;
}

function defaultArtifactDir(appConfig: AppConfig | undefined, threadId: string): string {
  const sessionDir = appConfig
    ? resolveSessionDir(appConfig)
    : resolve(process.cwd(), ".flow-sessions");
  return join(sessionDir, "artifacts", safeSegment(threadId));
}

function resolveArtifactDir(
  raw: string,
  appConfig: AppConfig | undefined,
  threadId: string
): string {
  const input = raw.trim();
  if (!input) return defaultArtifactDir(appConfig, threadId);
  return input.startsWith("/") ? input : resolve(process.cwd(), input);
}

export function writeDeliveryArtifacts(
  report: string,
  opts: {
    topic: string;
    outputDir: string;
  }
): DeliveryArtifacts {
  mkdirSync(opts.outputDir, { recursive: true });
  const base = safeSegment(opts.topic);
  const markdownPath = join(opts.outputDir, `${base}.md`);
  const htmlPath = join(opts.outputDir, `${base}.html`);
  writeFileSync(markdownPath, report, "utf-8");
  writeFileSync(htmlPath, markdownToHtml(report, opts.topic), "utf-8");
  return { markdownPath, htmlPath };
}

export function formatDeliveryAnswer(artifacts: DeliveryArtifacts): string {
  return [
    "报告已生成：",
    `- Markdown：${artifacts.markdownPath}`,
    `- HTML：${artifacts.htmlPath}`,
  ].join("\n");
}

/**
 * delivery：最终交付节点。
 *
 * 节点先用 interrupt 问询保存位置；用户直接回车时使用 `.flow-sessions/artifacts/<thread_id>/`。
 * 这样目录选择属于运行时用户决策，而不是模板硬编码一个新规范。
 */
export function deliveryNode(
  state: ResearchStateShape,
  appConfig: AppConfig | undefined,
  config?: LangGraphRunnableConfig
): Partial<ResearchStateShape> {
  const report = state.lastAnswer || state.finalReport || state.draft;
  const threadId = String(config?.configurable?.thread_id ?? "default");
  const defaultDir = defaultArtifactDir(appConfig, threadId);
  const requestedDir = String(
    interrupt({
      question:
        `最终报告准备交付。\n\n` +
        `请输入 Markdown/HTML 保存目录；直接回车使用默认目录：\n${defaultDir}`,
    }) ?? ""
  );
  const outputDir = resolveArtifactDir(requestedDir, appConfig, threadId);
  const artifacts = writeDeliveryArtifacts(report, {
    topic: state.refinedTopic || state.topic || "deep-research-report",
    outputDir,
  });
  return {
    finalReport: report,
    artifactMarkdownPath: artifacts.markdownPath,
    artifactHtmlPath: artifacts.htmlPath,
    lastAnswer: formatDeliveryAnswer(artifacts),
    lastAnswerStreamed: false,
  };
}

export function artifactParentDir(markdownPath: string): string {
  return dirname(markdownPath);
}

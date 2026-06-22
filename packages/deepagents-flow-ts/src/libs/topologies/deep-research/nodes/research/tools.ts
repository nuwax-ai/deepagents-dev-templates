/**
 * MCP 错误正文检测。
 *
 * 部分 MCP 常以 200 + 正文 `Error: ...` 返回限流/异常（不抛 MCP 异常）——原为 duckduckgo-mcp-server
 * 限流正文检测，duckduckgo 实测不稳定已移除；本检测逻辑通用，保留供单测与降级判断。
 */

/**
 * 检测 MCP 返回正文是否为错误/限流（常以 200 + Error 正文返回，不抛异常）。
 * 保留函数名 isDdgErrorText 以兼容既有调用与单测。
 */
export function isDdgErrorText(text: string): boolean {
  const t = text.trim();
  return (
    /^Error:/i.test(t) ||
    /anomaly|too quickly|rate.?limit|blocked|captcha/i.test(t)
  );
}

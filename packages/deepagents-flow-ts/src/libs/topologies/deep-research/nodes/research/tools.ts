/**
 * MCP 错误正文检测。
 *
 * 部分 MCP 以 200 + 正文 `Error: ...` 返回限流/异常（不抛 MCP 异常）；用于降级判断与单测。
 */

/** 检测 MCP 返回正文是否为错误/限流（常以 200 + Error 正文返回，不抛异常）。 */
export function isMcpErrorBodyText(text: string): boolean {
  const t = text.trim();
  return (
    /^Error:/i.test(t) ||
    /anomaly|too quickly|rate.?limit|blocked|captcha/i.test(t)
  );
}

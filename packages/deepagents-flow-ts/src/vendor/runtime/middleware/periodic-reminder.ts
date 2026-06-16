/**
 * Periodic Reminder Middleware
 *
 * Injects a goal-anchoring reminder every N turns to prevent agent drift
 * in long-running conversations. Inspired by pydantic-deepagents'
 * PeriodicReminderCapability.
 *
 * The reminder re-states the original user goal so the agent stays on track.
 */

import { createMiddleware, HumanMessage } from "langchain";

export interface PeriodicReminderOptions {
  /** Turn number for the first reminder. Default: 5 */
  firstAt?: number;
  /** Remind every N turns after the first. Default: 10 */
  every?: number;
}

/**
 * Create a periodic reminder middleware.
 *
 * Tracks the turn count and injects a <system-reminder> message
 * before model calls at the configured intervals.
 */
export function createPeriodicReminderMiddleware(options: PeriodicReminderOptions = {}) {
  const firstAt = options.firstAt ?? 5;
  const every = options.every ?? 10;

  let turnCount = 0;
  let firstUserGoal = "";

  return createMiddleware({
    name: "periodicReminder",

    beforeAgent: async (state) => {
      turnCount = 0;
      // Capture the first user message as the goal
      const messages = state.messages ?? [];
      for (const msg of messages) {
        if (msg instanceof HumanMessage) {
          firstUserGoal = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content);
          break;
        }
      }
    },

    beforeModel: async (_state) => {
      turnCount++;

      // Check if we should remind at this turn
      const shouldRemind =
        turnCount === firstAt || (turnCount > firstAt && (turnCount - firstAt) % every === 0);

      if (!shouldRemind || !firstUserGoal) return;

      // Truncate goal to first 500 chars if too long
      const goalExcerpt = firstUserGoal.length > 500
        ? firstUserGoal.slice(0, 500) + "..."
        : firstUserGoal;

      return {
        messages: [
          new HumanMessage({
            content: `<system-reminder>
目标回顾（第 ${turnCount} 轮）：你正在处理以下任务——
"${goalExcerpt}"

请检查当前进度是否仍在朝这个目标前进。如果偏离了方向，请及时调整。
</system-reminder>`,
          }),
        ],
      };
    },
  });
}

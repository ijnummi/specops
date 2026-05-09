import type { Decision, ReviewReminder } from "../domain";

export function scheduleReview(decision: Decision, dueAt: string, reason: string): ReviewReminder {
  return {
    id: `reminder.${decision.id}`,
    decisionId: decision.id,
    dueAt,
    reason,
    status: "open",
  };
}

export function findDueReminders(reminders: ReviewReminder[], now: string): ReviewReminder[] {
  const nowTime = Date.parse(now);
  return reminders.filter((reminder) => reminder.status === "open" && Date.parse(reminder.dueAt) <= nowTime);
}

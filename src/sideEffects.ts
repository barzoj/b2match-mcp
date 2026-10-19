export const SIDE_EFFECT_READS_ENV = "B2MATCH_ALLOW_SIDE_EFFECT_READS";

export function sideEffectReadsAllowed(): boolean {
  return process.env[SIDE_EFFECT_READS_ENV] === "1";
}

export const CONVERSATION_SIDE_EFFECT_MESSAGE = [
  "Fetching a conversation's messages marks that conversation as read on B2match (the unread-conversations count decreases), even though this client never sends MarkConversationAsSeen.",
  `This tool is disabled unless ${SIDE_EFFECT_READS_ENV}=1 is set and acknowledge_marks_read is true.`,
  "Use list_conversations to see conversation metadata and the last message without that side effect."
].join(" ");

export const NOTIFICATION_LIST_SIDE_EFFECT_MESSAGE = [
  "Fetching the notification list resets B2match's unseen notification counter (unseen goes to 0). The unread counter is unchanged.",
  `This tool returns only unread/unseen counters by default. The full list is disabled unless ${SIDE_EFFECT_READS_ENV}=1 is set and acknowledge_marks_seen is true.`
].join(" ");

export function conversationMessagesGate(acknowledgeMarksRead?: boolean): string | undefined {
  if (sideEffectReadsAllowed() && acknowledgeMarksRead) {
    return undefined;
  }
  return CONVERSATION_SIDE_EFFECT_MESSAGE;
}

export function notificationListGate(acknowledgeMarksSeen?: boolean): string | undefined {
  if (sideEffectReadsAllowed() && acknowledgeMarksSeen) {
    return undefined;
  }
  return NOTIFICATION_LIST_SIDE_EFFECT_MESSAGE;
}

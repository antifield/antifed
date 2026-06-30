export const Colors = {
  Ban: 0xed4245,
  Warn: 0xfee75c,
  Note: 0x5865f2,
  Success: 0x57f287,
  Info: 0x5865f2,
  Error: 0xed4245,
} as const;

export const INFRACTIONS_PER_PAGE = 5;

export const DM_FAILED_MESSAGE = "\n*Could not DM user - their DMs are likely closed.*";

export const AUDIT_FAILED_MESSAGE =
  "\n*Action completed, but writing the audit record failed — please tell a dev.*";

// Discord's maximum message-deletion window on a ban (7 days), used by softban
// and the honeypot auto-ban to purge recent messages.
export const MESSAGE_PURGE_SECONDS = 7 * 86400;

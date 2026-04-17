/**
 * Match scheduled_date by month and day only (same question every year).
 * Mirrors SQL: EXTRACT(MONTH FROM scheduled_date) = current month
 * AND EXTRACT(DAY FROM scheduled_date) = current day (using local "today").
 */
function getMonthDayFromScheduledDateRaw(raw: unknown): { month: number; day: number } | null {
  if (raw == null) {
    return null;
  }
  if (typeof raw === 'string') {
    const trimmed = raw.trim();
    const ymd = /^(\d{4})-(\d{2})-(\d{2})/.exec(trimmed);
    if (ymd) {
      return { month: Number.parseInt(ymd[2], 10), day: Number.parseInt(ymd[3], 10) };
    }
    const d = new Date(trimmed.includes('T') ? trimmed : `${trimmed}T12:00:00`);
    if (!Number.isNaN(d.getTime())) {
      return { month: d.getMonth() + 1, day: d.getDate() };
    }
    return null;
  }
  if (raw instanceof Date) {
    return { month: raw.getMonth() + 1, day: raw.getDate() };
  }
  return null;
}

export function scheduledDateMatchesTodayMonthDay(scheduledDateRaw: unknown, today: Date): boolean {
  const md = getMonthDayFromScheduledDateRaw(scheduledDateRaw);
  if (!md) {
    return false;
  }
  return md.month === today.getMonth() + 1 && md.day === today.getDate();
}

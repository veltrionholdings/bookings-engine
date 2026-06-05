/**
 * Timezone and time manipulation utilities.
 * All business logic operates in UTC. These helpers convert between
 * tenant local time and UTC for storage and display.
 */

import { format, parse, addMinutes } from 'date-fns';
import { toZonedTime, fromZonedTime } from 'date-fns-tz';

/**
 * Convert a local datetime string to a UTC Date.
 * Input: "2025-03-15T10:00:00" + timezone "Africa/Johannesburg"
 * Output: Date representing 2025-03-15T08:00:00Z
 */
export function localToUtc(localDatetime: string, timezone: string): Date {
  // Parse the local datetime as if it's in the specified timezone
  const localDate = new Date(localDatetime);
  return fromZonedTime(localDate, timezone);
}

/**
 * Convert a UTC Date to a local time string.
 * Input: Date(2025-03-15T08:00:00Z) + timezone "Africa/Johannesburg"
 * Output: "2025-03-15T10:00:00"
 */
export function utcToLocal(utcDate: Date, timezone: string): string {
  const zonedDate = toZonedTime(utcDate, timezone);
  return format(zonedDate, "yyyy-MM-dd'T'HH:mm:ss");
}

/**
 * Convert a UTC Date to just the local time string (HH:mm).
 */
export function utcToLocalTime(utcDate: Date, timezone: string): string {
  const zonedDate = toZonedTime(utcDate, timezone);
  return format(zonedDate, 'HH:mm');
}

/**
 * Get the day of week (0=Monday, 6=Sunday) for a date in a given timezone.
 */
export function getDayOfWeek(date: Date, timezone: string): number {
  const zonedDate = toZonedTime(date, timezone);
  // JavaScript's getDay() returns 0=Sunday, we want 0=Monday
  const jsDay = zonedDate.getDay();
  return jsDay === 0 ? 6 : jsDay - 1;
}

/**
 * Parse a "HH:mm" time string and a date string into a full Date in a timezone,
 * then convert to UTC.
 * Input: "10:00", "2025-03-15", "Africa/Johannesburg"
 * Output: Date(2025-03-15T08:00:00Z)
 */
export function timeAndDateToUtc(
  time: string,
  dateStr: string,
  timezone: string
): Date {
  const localDatetime = `${dateStr}T${time}:00`;
  return localToUtc(localDatetime, timezone);
}

/**
 * Add minutes to a Date.
 */
export function addMinutesToDate(date: Date, minutes: number): Date {
  return addMinutes(date, minutes);
}

/**
 * Parse a HH:mm string into total minutes since midnight.
 */
export function timeToMinutes(time: string): number {
  const [hours, mins] = time.split(':').map(Number);
  return hours * 60 + mins;
}

/**
 * Convert total minutes since midnight to HH:mm string.
 */
export function minutesToTime(totalMinutes: number): string {
  const hours = Math.floor(totalMinutes / 60);
  const mins = totalMinutes % 60;
  return `${hours.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}`;
}

import { timeToMinutes, minutesToTime, addMinutesToDate } from '../../../src/utils/time';

describe('timeToMinutes', () => {
  it('converts 00:00 to 0', () => {
    expect(timeToMinutes('00:00')).toBe(0);
  });

  it('converts 09:00 to 540', () => {
    expect(timeToMinutes('09:00')).toBe(540);
  });

  it('converts 17:30 to 1050', () => {
    expect(timeToMinutes('17:30')).toBe(1050);
  });

  it('converts 23:59 to 1439', () => {
    expect(timeToMinutes('23:59')).toBe(1439);
  });
});

describe('minutesToTime', () => {
  it('converts 0 to 00:00', () => {
    expect(minutesToTime(0)).toBe('00:00');
  });

  it('converts 540 to 09:00', () => {
    expect(minutesToTime(540)).toBe('09:00');
  });

  it('converts 1050 to 17:30', () => {
    expect(minutesToTime(1050)).toBe('17:30');
  });

  it('converts 615 to 10:15', () => {
    expect(minutesToTime(615)).toBe('10:15');
  });
});

describe('addMinutesToDate', () => {
  it('adds minutes correctly', () => {
    const base = new Date('2025-03-15T10:00:00Z');
    const result = addMinutesToDate(base, 45);
    expect(result.toISOString()).toBe('2025-03-15T10:45:00.000Z');
  });

  it('handles crossing hour boundary', () => {
    const base = new Date('2025-03-15T10:45:00Z');
    const result = addMinutesToDate(base, 30);
    expect(result.toISOString()).toBe('2025-03-15T11:15:00.000Z');
  });

  it('handles 0 minutes', () => {
    const base = new Date('2025-03-15T10:00:00Z');
    const result = addMinutesToDate(base, 0);
    expect(result.toISOString()).toBe('2025-03-15T10:00:00.000Z');
  });
});

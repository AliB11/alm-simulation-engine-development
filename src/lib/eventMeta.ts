/* ------------------------------------------------------------------ *
 *  EVENT META — تعریف واحد رویدادهای جریان نقد
 *
 *  نشانهٔ هر رویداد در ماتریس جریان نقد، برچسب فارسی و رنگ آن. این ماژول
 *  تنها منبع حقیقت است تا جدول جریان نقد و تحلیل انتساب پله‌ها هرگز در
 *  قرارداد نشانه‌ها اختلاف پیدا نکنند.
 * ------------------------------------------------------------------ */

import type { EventType } from '../types';

export interface EventMeta {
  label: string;
  sign: 1 | -1;
  color: string;
}

export const EVENT_META: Record<EventType, EventMeta> = {
  deposit: { label: 'ورود سپرده جدید', sign: 1, color: '#10b981' },
  reserve: { label: 'کسر سپرده قانونی (RR)', sign: -1, color: '#94a3b8' },
  release: { label: 'آزادسازی سپرده قانونی', sign: 1, color: '#14b8a6' },
  pmt: { label: 'وصول اقساط', sign: 1, color: '#6366f1' },
  loan: { label: 'پرداخت تسهیلات (تعهد وام)', sign: -1, color: '#f43f5e' },
  withdrawal: { label: 'برداشت اصل سپرده', sign: -1, color: '#f59e0b' },
  profit: { label: 'سود پرداختی به سپرده‌گذاران', sign: -1, color: '#a855f7' },
};

/** سهم این رویداد در خالص جریان نقد ماه (مقدار ذخیره‌شده همواره مثبت است) */
export function eventNcf(type: EventType, amount: number): number {
  return EVENT_META[type].sign * amount;
}

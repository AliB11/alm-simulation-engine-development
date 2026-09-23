import { createContext, useContext } from 'react';
import type { Currency } from '../types';

export interface DisplayState {
  currency: Currency;
  /** ضریب تبدیل تومان به واحد نمایش (۱ برای تومان، ۱۰ برای ریال) */
  factor: number;
  unit: string;
  dark: boolean;
}

export const DisplayContext = createContext<DisplayState>({
  currency: 'toman',
  factor: 1,
  unit: 'تومان',
  dark: false,
});

export const useDisplay = () => useContext(DisplayContext);

export type Series = (number | null)[];

/** Média móvel simples. Valor em i usa apenas dados até i (sem olhar o futuro). */
export function sma(values: number[], period: number): Series {
  const out: Series = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

/** RSI de Wilder. */
export function rsi(values: number[], period = 14): Series {
  const out: Series = new Array(values.length).fill(null);
  if (values.length <= period) return out;
  let gain = 0;
  let loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = values[i] - values[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  let avgG = gain / period;
  let avgL = loss / period;
  out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = period + 1; i < values.length; i++) {
    const d = values[i] - values[i - 1];
    avgG = (avgG * (period - 1) + Math.max(d, 0)) / period;
    avgL = (avgL * (period - 1) + Math.max(-d, 0)) / period;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

export type Cross = 'UP' | 'DOWN' | null;

/** Cruzamento ocorrido NO candle i (entre i-1 e i). */
export function crossAt(fast: Series, slow: Series, i: number): Cross {
  if (i < 1) return null;
  const f0 = fast[i - 1], s0 = slow[i - 1], f1 = fast[i], s1 = slow[i];
  if (f0 == null || s0 == null || f1 == null || s1 == null) return null;
  if (f0 <= s0 && f1 > s1) return 'UP';
  if (f0 >= s0 && f1 < s1) return 'DOWN';
  return null;
}

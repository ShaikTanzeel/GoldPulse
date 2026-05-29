/**
 * Technical Indicator Calculations for GoldPulse
 * Highly optimized, pure JS computations.
 */

// Simple Moving Average (SMA)
export function calculateSMA(prices, period) {
  if (prices.length < period) return Array(prices.length).fill(null);
  
  const sma = [];
  let sum = 0;
  
  for (let i = 0; i < prices.length; i++) {
    sum += prices[i];
    if (i >= period) {
      sum -= prices[i - period];
    }
    
    if (i >= period - 1) {
      sma.push(sum / period);
    } else {
      sma.push(null);
    }
  }
  
  return sma;
}

// Exponential Moving Average (EMA)
export function calculateEMA(prices, period) {
  if (prices.length < period) return Array(prices.length).fill(null);
  
  const ema = [];
  const k = 2 / (period + 1);
  
  // First EMA value is SMA
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += prices[i];
  }
  
  const initialSMA = sum / period;
  
  for (let i = 0; i < prices.length; i++) {
    if (i < period - 1) {
      ema.push(null);
    } else if (i === period - 1) {
      ema.push(initialSMA);
    } else {
      const currentEma = (prices[i] - ema[i - 1]) * k + ema[i - 1];
      ema.push(currentEma);
    }
  }
  
  return ema;
}

// Relative Strength Index (RSI)
export function calculateRSI(prices, period = 14) {
  if (prices.length <= period) return Array(prices.length).fill(null);
  
  const rsi = Array(prices.length).fill(null);
  let avgGain = 0;
  let avgLoss = 0;
  
  // Calculate first RSI using SMA of gains/losses
  for (let i = 1; i <= period; i++) {
    const change = prices[i] - prices[i - 1];
    if (change > 0) {
      avgGain += change;
    } else {
      avgLoss += Math.abs(change);
    }
  }
  
  avgGain /= period;
  avgLoss /= period;
  
  let rs = avgGain / (avgLoss || 1);
  rsi[period] = 100 - (100 / (1 + rs));
  
  // Smoothed RSI for remaining elements
  for (let i = period + 1; i < prices.length; i++) {
    const change = prices[i] - prices[i - 1];
    let gain = change > 0 ? change : 0;
    let loss = change < 0 ? Math.abs(change) : 0;
    
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    
    rs = avgGain / (avgLoss || 1);
    rsi[i] = 100 - (100 / (1 + rs));
  }
  
  return rsi;
}

// MACD (Moving Average Convergence Divergence)
export function calculateMACD(prices, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (prices.length < slowPeriod) {
    return {
      macd: Array(prices.length).fill(null),
      signal: Array(prices.length).fill(null),
      histogram: Array(prices.length).fill(null)
    };
  }
  
  const fastEma = calculateEMA(prices, fastPeriod);
  const slowEma = calculateEMA(prices, slowPeriod);
  
  const macdLine = [];
  for (let i = 0; i < prices.length; i++) {
    if (fastEma[i] === null || slowEma[i] === null) {
      macdLine.push(null);
    } else {
      macdLine.push(fastEma[i] - slowEma[i]);
    }
  }
  
  // Filter out nulls to compute Signal line on macdLine
  const validMacdStart = macdLine.findIndex(val => val !== null);
  const validMacdValues = macdLine.slice(validMacdStart);
  const validSignalValues = calculateEMA(validMacdValues, signalPeriod);
  
  const signalLine = Array(validMacdStart).fill(null).concat(validSignalValues);
  const histogram = [];
  
  for (let i = 0; i < prices.length; i++) {
    if (macdLine[i] === null || signalLine[i] === null) {
      histogram.push(null);
    } else {
      histogram.push(macdLine[i] - signalLine[i]);
    }
  }
  
  return {
    macd: macdLine,
    signal: signalLine,
    histogram: histogram
  };
}

// Average True Range (ATR)
export function calculateATR(highs, lows, closes, period = 14) {
  if (highs.length < period) return Array(highs.length).fill(null);
  
  const tr = [highs[0] - lows[0]]; // first True Range
  for (let i = 1; i < highs.length; i++) {
    const tr1 = highs[i] - lows[i];
    const tr2 = Math.abs(highs[i] - closes[i - 1]);
    const tr3 = Math.abs(lows[i] - closes[i - 1]);
    tr.push(Math.max(tr1, tr2, tr3));
  }
  
  const atr = Array(highs.length).fill(null);
  
  // First ATR is simple average of first 'period' TR values
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += tr[i];
  }
  atr[period - 1] = sum / period;
  
  // Wilders smoothing for remaining
  for (let i = period; i < highs.length; i++) {
    atr[i] = (atr[i - 1] * (period - 1) + tr[i]) / period;
  }
  
  return atr;
}

// Pivot-based Support & Resistance Level Detection
export function detectSupportResistance(highs, lows, closes, lookback = 30) {
  const levels = [];
  if (highs.length < lookback * 2) return [];
  
  // Look for fractal highs/lows (pivot points)
  for (let i = lookback; i < highs.length - lookback; i++) {
    let isPivotHigh = true;
    let isPivotLow = true;
    
    for (let j = 1; j <= lookback; j++) {
      if (highs[i] < highs[i - j] || highs[i] < highs[i + j]) {
        isPivotHigh = false;
      }
      if (lows[i] > lows[i - j] || lows[i] > lows[i + j]) {
        isPivotLow = false;
      }
    }
    
    if (isPivotHigh) {
      levels.push({ price: parseFloat(highs[i].toFixed(2)), type: 'resistance' });
    }
    if (isPivotLow) {
      levels.push({ price: parseFloat(lows[i].toFixed(2)), type: 'support' });
    }
  }
  
  // Group levels that are very close to each other to avoid noise
  const threshold = 1.5; // $1.50 range for gold levels grouping
  const consolidated = [];
  
  levels.sort((a, b) => a.price - b.price);
  
  let currentGroup = [];
  for (let i = 0; i < levels.length; i++) {
    if (currentGroup.length === 0) {
      currentGroup.push(levels[i]);
    } else {
      if (levels[i].price - currentGroup[currentGroup.length - 1].price <= threshold) {
        currentGroup.push(levels[i]);
      } else {
        // Average the group
        const avgPrice = currentGroup.reduce((sum, item) => sum + item.price, 0) / currentGroup.length;
        const currentPrice = closes[closes.length - 1];
        consolidated.push({
          price: parseFloat(avgPrice.toFixed(2)),
          strength: currentGroup.length,
          type: avgPrice < currentPrice ? 'support' : 'resistance'
        });
        currentGroup = [levels[i]];
      }
    }
  }
  
  if (currentGroup.length > 0) {
    const avgPrice = currentGroup.reduce((sum, item) => sum + item.price, 0) / currentGroup.length;
    const currentPrice = closes[closes.length - 1];
    consolidated.push({
      price: parseFloat(avgPrice.toFixed(2)),
      strength: currentGroup.length,
      type: avgPrice < currentPrice ? 'support' : 'resistance'
    });
  }
  
  return consolidated.sort((a, b) => b.strength - a.strength).slice(0, 6); // Top 6 key levels
}

// RSI Divergence Detection
export function detectDivergence(prices, rsi, lookback = 30) {
  if (prices.length < lookback * 2) return null;
  
  // Find local swing lows and swing highs in price & RSI
  const len = prices.length;
  
  // Check bullish divergence (lower low in price, higher low in RSI)
  const isLowerLowPrice = prices[len - 1] < prices[len - lookback];
  const isHigherLowRsi = rsi[len - 1] > rsi[len - lookback] && rsi[len - 1] < 35;
  
  if (isLowerLowPrice && isHigherLowRsi) {
    return 'BULLISH_DIVERGENCE';
  }
  
  // Check bearish divergence (higher high in price, lower high in RSI)
  const isHigherHighPrice = prices[len - 1] > prices[len - lookback];
  const isLowerHighRsi = rsi[len - 1] < rsi[len - lookback] && rsi[len - 1] > 65;
  
  if (isHigherHighPrice && isLowerHighRsi) {
    return 'BEARISH_DIVERGENCE';
  }
  
  return null;
}

/**
 * Price Action Analysis Engine for GoldPulse
 * Pure JS — no external dependencies. Runs in < 5ms on all 4 timeframes.
 * 
 * Covers:
 * 1. Candlestick Pattern Detection (pin bars, engulfing, doji, inside bars)
 * 2. Market Structure Mapping (swing H/L, trend classification, BOS/CHoCH)
 * 3. Multi-Timeframe Support/Resistance Map with touch count & proximity
 */

// ═══════════════════════════════════════════════════════════════════
// 1. CANDLESTICK PATTERN DETECTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Detects candlestick patterns on the last N candles.
 * @param {Array} ohlcv - Array of { open, high, low, close, time } objects
 * @param {number} count - How many recent candles to check (default 5)
 * @returns {Array} Array of { index, time, pattern, bias, description }
 */
export function detectCandlestickPatterns(ohlcv, count = 5) {
  if (!ohlcv || ohlcv.length < 2) return [];

  const patterns = [];
  const startIdx = Math.max(1, ohlcv.length - count);

  for (let i = startIdx; i < ohlcv.length; i++) {
    const curr = ohlcv[i];
    const prev = ohlcv[i - 1];

    const body = Math.abs(curr.close - curr.open);
    const range = curr.high - curr.low;
    const upperWick = curr.high - Math.max(curr.open, curr.close);
    const lowerWick = Math.min(curr.open, curr.close) - curr.low;
    const isBullish = curr.close > curr.open;

    const prevBody = Math.abs(prev.close - prev.open);
    const prevRange = prev.high - prev.low;

    // Avoid division by zero
    if (range < 0.01) continue;

    // === PIN BAR / HAMMER / SHOOTING STAR ===
    // Long wick >= 2x body, opposing wick is small
    if (lowerWick >= body * 2 && upperWick < body * 0.5 && body > range * 0.05) {
      patterns.push({
        index: i,
        time: curr.time,
        pattern: 'PIN_BAR_BULLISH',
        bias: 'BULLISH',
        description: `Bullish Pin Bar — long lower wick shows buyer rejection (wick ${lowerWick.toFixed(2)} vs body ${body.toFixed(2)})`
      });
    } else if (upperWick >= body * 2 && lowerWick < body * 0.5 && body > range * 0.05) {
      patterns.push({
        index: i,
        time: curr.time,
        pattern: 'PIN_BAR_BEARISH',
        bias: 'BEARISH',
        description: `Bearish Pin Bar (Shooting Star) — long upper wick shows seller rejection (wick ${upperWick.toFixed(2)} vs body ${body.toFixed(2)})`
      });
    }

    // === ENGULFING PATTERNS ===
    // Current body completely covers previous body
    if (body > prevBody * 1.2 && prevBody > 0.01) {
      const currTop = Math.max(curr.open, curr.close);
      const currBottom = Math.min(curr.open, curr.close);
      const prevTop = Math.max(prev.open, prev.close);
      const prevBottom = Math.min(prev.open, prev.close);

      if (isBullish && prev.close < prev.open && currBottom <= prevBottom && currTop >= prevTop) {
        patterns.push({
          index: i,
          time: curr.time,
          pattern: 'ENGULFING_BULLISH',
          bias: 'BULLISH',
          description: `Bullish Engulfing — buyers overtook sellers completely (body ${body.toFixed(2)} engulfs prev ${prevBody.toFixed(2)})`
        });
      } else if (!isBullish && prev.close > prev.open && currTop >= prevTop && currBottom <= prevBottom) {
        patterns.push({
          index: i,
          time: curr.time,
          pattern: 'ENGULFING_BEARISH',
          bias: 'BEARISH',
          description: `Bearish Engulfing — sellers overtook buyers completely (body ${body.toFixed(2)} engulfs prev ${prevBody.toFixed(2)})`
        });
      }
    }

    // === DOJI ===
    // Body is very small relative to total range (< 10% of range)
    if (body < range * 0.1 && range > 0.5) {
      patterns.push({
        index: i,
        time: curr.time,
        pattern: 'DOJI',
        bias: 'NEUTRAL',
        description: `Doji — indecision (body ${body.toFixed(2)} is ${((body / range) * 100).toFixed(0)}% of range ${range.toFixed(2)})`
      });
    }

    // === INSIDE BAR ===
    // Current candle entirely within previous candle's range
    if (curr.high < prev.high && curr.low > prev.low) {
      patterns.push({
        index: i,
        time: curr.time,
        pattern: 'INSIDE_BAR',
        bias: 'NEUTRAL',
        description: `Inside Bar — compression/coiling (H:${curr.high.toFixed(2)} < prev H:${prev.high.toFixed(2)}, L:${curr.low.toFixed(2)} > prev L:${prev.low.toFixed(2)})`
      });
    }
  }

  return patterns;
}


// ═══════════════════════════════════════════════════════════════════
// 2. MARKET STRUCTURE MAPPING
// ═══════════════════════════════════════════════════════════════════

/**
 * Finds swing highs and lows using a fractal-like approach.
 * A swing high is a bar whose high is higher than the N bars before and after it.
 * @param {Array} ohlcv - OHLCV array
 * @param {number} lookback - Number of bars on each side to compare (default 3)
 * @returns {{ swingHighs: Array, swingLows: Array }}
 */
export function findSwingPoints(ohlcv, lookback = 3) {
  const swingHighs = [];
  const swingLows = [];

  if (!ohlcv || ohlcv.length < lookback * 2 + 1) return { swingHighs, swingLows };

  for (let i = lookback; i < ohlcv.length - lookback; i++) {
    let isSwingHigh = true;
    let isSwingLow = true;

    for (let j = 1; j <= lookback; j++) {
      if (ohlcv[i].high <= ohlcv[i - j].high || ohlcv[i].high <= ohlcv[i + j].high) {
        isSwingHigh = false;
      }
      if (ohlcv[i].low >= ohlcv[i - j].low || ohlcv[i].low >= ohlcv[i + j].low) {
        isSwingLow = false;
      }
    }

    if (isSwingHigh) {
      swingHighs.push({ index: i, price: ohlcv[i].high, time: ohlcv[i].time });
    }
    if (isSwingLow) {
      swingLows.push({ index: i, price: ohlcv[i].low, time: ohlcv[i].time });
    }
  }

  return { swingHighs, swingLows };
}

/**
 * Maps the market structure: trend direction, BOS, CHoCH.
 * @param {Array} ohlcv - OHLCV array
 * @param {number} lookback - Swing point detection lookback (default 3)
 * @returns {object} { trend, swingHighs, swingLows, lastBOS, lastCHoCH, description }
 */
export function mapMarketStructure(ohlcv, lookback = 3) {
  const { swingHighs, swingLows } = findSwingPoints(ohlcv, lookback);

  const result = {
    trend: 'RANGING',
    swingHighs,
    swingLows,
    lastBOS: null,
    lastCHoCH: null,
    description: ''
  };

  if (swingHighs.length < 2 || swingLows.length < 2) {
    result.description = 'Insufficient swing points to determine structure';
    return result;
  }

  // Get the last few swing points
  const lastSH = swingHighs[swingHighs.length - 1];
  const prevSH = swingHighs[swingHighs.length - 2];
  const lastSL = swingLows[swingLows.length - 1];
  const prevSL = swingLows[swingLows.length - 2];

  // Determine trend from swing point sequence
  const higherHigh = lastSH.price > prevSH.price;
  const higherLow = lastSL.price > prevSL.price;
  const lowerHigh = lastSH.price < prevSH.price;
  const lowerLow = lastSL.price < prevSL.price;

  if (higherHigh && higherLow) {
    result.trend = 'UPTREND';
    result.description = `Uptrend — Higher Highs ($${lastSH.price.toFixed(2)} > $${prevSH.price.toFixed(2)}) + Higher Lows ($${lastSL.price.toFixed(2)} > $${prevSL.price.toFixed(2)})`;
  } else if (lowerHigh && lowerLow) {
    result.trend = 'DOWNTREND';
    result.description = `Downtrend — Lower Highs ($${lastSH.price.toFixed(2)} < $${prevSH.price.toFixed(2)}) + Lower Lows ($${lastSL.price.toFixed(2)} < $${prevSL.price.toFixed(2)})`;
  } else if (higherHigh && lowerLow) {
    result.trend = 'EXPANDING';
    result.description = 'Expanding range — Higher Highs but Lower Lows (volatile/uncertain)';
  } else {
    result.trend = 'RANGING';
    result.description = `Ranging — no clear HH/HL or LH/LL sequence (between $${lastSL.price.toFixed(2)} - $${lastSH.price.toFixed(2)})`;
  }

  // Detect Break of Structure (BOS) — price broke the last swing high/low in trend direction
  const currentPrice = ohlcv[ohlcv.length - 1].close;

  if (result.trend === 'UPTREND' && currentPrice > lastSH.price) {
    result.lastBOS = { type: 'BULLISH_BOS', level: lastSH.price, description: `Bullish Break of Structure — price ($${currentPrice.toFixed(2)}) broke above last swing high ($${lastSH.price.toFixed(2)})` };
  } else if (result.trend === 'DOWNTREND' && currentPrice < lastSL.price) {
    result.lastBOS = { type: 'BEARISH_BOS', level: lastSL.price, description: `Bearish Break of Structure — price ($${currentPrice.toFixed(2)}) broke below last swing low ($${lastSL.price.toFixed(2)})` };
  }

  // Detect Change of Character (CHoCH) — price broke structure against the trend
  if (result.trend === 'UPTREND' && currentPrice < lastSL.price) {
    result.lastCHoCH = { type: 'BEARISH_CHOCH', level: lastSL.price, description: `⚠️ Change of Character — uptrend broke down! Price ($${currentPrice.toFixed(2)}) fell below last Higher Low ($${lastSL.price.toFixed(2)})` };
  } else if (result.trend === 'DOWNTREND' && currentPrice > lastSH.price) {
    result.lastCHoCH = { type: 'BULLISH_CHOCH', level: lastSH.price, description: `⚠️ Change of Character — downtrend reversed! Price ($${currentPrice.toFixed(2)}) rose above last Lower High ($${lastSH.price.toFixed(2)})` };
  }

  return result;
}


// ═══════════════════════════════════════════════════════════════════
// 3. MULTI-TIMEFRAME SUPPORT/RESISTANCE MAP
// ═══════════════════════════════════════════════════════════════════

/**
 * Detects S/R levels from swing points with touch-count strength.
 * @param {Array} ohlcv - OHLCV array
 * @param {number} lookback - Swing point lookback
 * @param {number} tolerance - Price tolerance for grouping nearby levels (in $)
 * @returns {Array} Sorted array of { price, type, touches }
 */
function detectLevels(ohlcv, lookback = 3, tolerance = 2.0) {
  const { swingHighs, swingLows } = findSwingPoints(ohlcv, lookback);
  const rawLevels = [];

  swingHighs.forEach(sh => rawLevels.push({ price: sh.price, type: 'resistance', time: sh.time }));
  swingLows.forEach(sl => rawLevels.push({ price: sl.price, type: 'support', time: sl.time }));

  if (rawLevels.length === 0) return [];

  // Sort by price
  rawLevels.sort((a, b) => a.price - b.price);

  // Consolidate levels within tolerance
  const consolidated = [];
  let group = [rawLevels[0]];

  for (let i = 1; i < rawLevels.length; i++) {
    if (rawLevels[i].price - group[group.length - 1].price <= tolerance) {
      group.push(rawLevels[i]);
    } else {
      // Finalize group
      const avgPrice = group.reduce((sum, l) => sum + l.price, 0) / group.length;
      const latestTime = Math.max(...group.map(l => l.time));
      // Type is determined by majority
      const resistCount = group.filter(l => l.type === 'resistance').length;
      const suppCount = group.filter(l => l.type === 'support').length;

      consolidated.push({
        price: parseFloat(avgPrice.toFixed(2)),
        type: resistCount >= suppCount ? 'resistance' : 'support',
        touches: group.length,
        lastTouchTime: latestTime
      });
      group = [rawLevels[i]];
    }
  }

  // Don't forget last group
  if (group.length > 0) {
    const avgPrice = group.reduce((sum, l) => sum + l.price, 0) / group.length;
    const latestTime = Math.max(...group.map(l => l.time));
    const resistCount = group.filter(l => l.type === 'resistance').length;
    const suppCount = group.filter(l => l.type === 'support').length;

    consolidated.push({
      price: parseFloat(avgPrice.toFixed(2)),
      type: resistCount >= suppCount ? 'resistance' : 'support',
      touches: group.length,
      lastTouchTime: latestTime
    });
  }

  return consolidated;
}

/**
 * Builds a unified S/R map across all timeframes with proximity analysis.
 * @param {object} mtfData - { d1: [...], h1: [...], m30: [...], m5: [...] }
 * @param {number} currentPrice - Current gold price
 * @param {number} currentATR - Current ATR value for proximity calculation
 * @returns {object} { levels: Array, nearestResistance, nearestSupport, dangerZone }
 */
export function buildMultiTimeframeSRMap(mtfData, currentPrice, currentATR) {
  const allLevels = [];
  
  // Timeframe weight — higher timeframe levels are more significant
  const tfConfig = {
    d1:  { lookback: 3, tolerance: 5.0,  weight: 4, label: 'D1' },
    h1:  { lookback: 3, tolerance: 3.0,  weight: 3, label: 'H1' },
    m30: { lookback: 3, tolerance: 2.0,  weight: 2, label: 'M30' },
    m5:  { lookback: 3, tolerance: 1.0,  weight: 1, label: 'M5' }
  };

  for (const [tfKey, config] of Object.entries(tfConfig)) {
    const data = mtfData[tfKey];
    if (!data || data.length < 10) continue;

    const levels = detectLevels(data, config.lookback, config.tolerance);
    levels.forEach(level => {
      allLevels.push({
        ...level,
        timeframe: config.label,
        weight: config.weight,
        // Weighted strength = touches × timeframe weight
        strength: level.touches * config.weight
      });
    });
  }

  // Calculate distance and proximity for each level
  const atr = currentATR || 10; // fallback ATR

  const enrichedLevels = allLevels.map(level => {
    const distance = level.price - currentPrice;
    const distanceAbs = Math.abs(distance);
    const distancePercent = (distanceAbs / currentPrice) * 100;
    const distanceATR = distanceAbs / atr;
    
    let dangerLevel = 'SAFE';
    if (distanceATR <= 0.3) dangerLevel = 'CRITICAL';
    else if (distanceATR <= 0.5) dangerLevel = 'WARNING';
    else if (distanceATR <= 1.0) dangerLevel = 'WATCH';

    return {
      ...level,
      type: distance > 0 ? 'resistance' : 'support',
      distance: parseFloat(distance.toFixed(2)),
      distanceAbs: parseFloat(distanceAbs.toFixed(2)),
      distancePercent: parseFloat(distancePercent.toFixed(3)),
      distanceATR: parseFloat(distanceATR.toFixed(2)),
      dangerLevel
    };
  });

  // Sort by absolute distance (closest first)
  enrichedLevels.sort((a, b) => a.distanceAbs - b.distanceAbs);

  // Find nearest resistance and support
  const nearestResistance = enrichedLevels.find(l => l.type === 'resistance' && l.distance > 0) || null;
  const nearestSupport = enrichedLevels.find(l => l.type === 'support' && l.distance < 0) || null;

  // Determine if we're in a danger zone
  const criticalLevels = enrichedLevels.filter(l => l.dangerLevel === 'CRITICAL');
  const dangerZone = {
    isInDangerZone: criticalLevels.length > 0,
    criticalLevels,
    message: criticalLevels.length > 0
      ? `⚠️ Price is critically close to ${criticalLevels.map(l => `${l.type.toUpperCase()} at $${l.price} [${l.timeframe}]`).join(', ')}`
      : 'Price is clear of major S/R levels'
  };

  return {
    levels: enrichedLevels.slice(0, 12), // Top 12 most relevant levels
    nearestResistance,
    nearestSupport,
    dangerZone
  };
}


// ═══════════════════════════════════════════════════════════════════
// 4. COMPREHENSIVE PRICE ACTION REPORT BUILDER
// ═══════════════════════════════════════════════════════════════════

/**
 * Runs complete price action analysis on multi-timeframe data.
 * Returns a structured report for the AI prompt.
 * @param {object} mtfData - { d1, h1, m30, m5 } OHLCV arrays
 * @param {number} currentPrice - Current price
 * @param {number} currentATR - Current ATR
 * @returns {object} Full price action context
 */
export function analyzePriceAction(mtfData, currentPrice, currentATR) {
  const report = {
    timeframes: {},
    srMap: null,
    summary: ''
  };

  // Analyze each timeframe independently
  const tfLabels = { d1: 'Daily', h1: '1-Hour', m30: '30-Min', m5: '5-Min' };

  for (const [key, label] of Object.entries(tfLabels)) {
    const data = mtfData[key];
    if (!data || data.length < 10) {
      report.timeframes[key] = { label, error: 'Insufficient data' };
      continue;
    }

    const structure = mapMarketStructure(data, key === 'd1' ? 5 : 3);
    const patterns = detectCandlestickPatterns(data, 5);

    report.timeframes[key] = {
      label,
      trend: structure.trend,
      structureDescription: structure.description,
      lastBOS: structure.lastBOS,
      lastCHoCH: structure.lastCHoCH,
      swingHighCount: structure.swingHighs.length,
      swingLowCount: structure.swingLows.length,
      lastSwingHigh: structure.swingHighs[structure.swingHighs.length - 1] || null,
      lastSwingLow: structure.swingLows[structure.swingLows.length - 1] || null,
      candlestickPatterns: patterns,
      lastCandle: data[data.length - 1]
    };
  }

  // Build unified S/R map
  report.srMap = buildMultiTimeframeSRMap(mtfData, currentPrice, currentATR);

  // Generate human-readable summary for AI prompt
  report.summary = buildPriceActionSummary(report, currentPrice);

  return report;
}

/**
 * Generates a structured text summary suitable for AI prompt injection.
 */
function buildPriceActionSummary(report, currentPrice) {
  const lines = [];

  lines.push('═══ MULTI-TIMEFRAME PRICE ACTION CONTEXT ═══');
  lines.push('');

  // Per-timeframe summaries
  for (const [key, tf] of Object.entries(report.timeframes)) {
    if (tf.error) continue;

    lines.push(`### ${tf.label.toUpperCase()} TIMEFRAME`);
    lines.push(`Market Structure: ${tf.trend}`);
    lines.push(`Detail: ${tf.structureDescription}`);

    if (tf.lastBOS) lines.push(`Break of Structure: ${tf.lastBOS.description}`);
    if (tf.lastCHoCH) lines.push(`Change of Character: ${tf.lastCHoCH.description}`);

    if (tf.candlestickPatterns.length > 0) {
      lines.push(`Candlestick Patterns Detected:`);
      tf.candlestickPatterns.forEach(p => {
        lines.push(`  • ${p.pattern} [${p.bias}]: ${p.description}`);
      });
    } else {
      lines.push(`Candlestick Patterns: None detected in last 5 candles`);
    }

    lines.push('');
  }

  // S/R Map
  const srMap = report.srMap;
  if (srMap && srMap.levels.length > 0) {
    lines.push('### SUPPORT/RESISTANCE MAP (All Timeframes Combined)');
    lines.push(`Current Price: $${currentPrice.toFixed(2)}`);
    lines.push('');

    srMap.levels.slice(0, 8).forEach(l => {
      const dir = l.distance > 0 ? '↑' : '↓';
      const dangerTag = l.dangerLevel === 'CRITICAL' ? ' ⚠️ CRITICAL' : l.dangerLevel === 'WARNING' ? ' ⚠️' : '';
      lines.push(`${l.type.toUpperCase()} $${l.price.toFixed(2)} [${l.timeframe}] — ${l.touches} touches — ${dir} $${l.distanceAbs.toFixed(2)} away (${l.distanceATR.toFixed(1)} ATR)${dangerTag}`);
    });

    lines.push('');

    if (srMap.dangerZone.isInDangerZone) {
      lines.push(`DANGER ZONE: ${srMap.dangerZone.message}`);
    }
  }

  return lines.join('\n');
}

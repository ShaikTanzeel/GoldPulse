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
// 4. LIQUIDITY SWEEP DETECTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Detects liquidity sweeps: M5 candle wicks below an H1 swing low
 * and closes back above it. This is the PRIMARY trade trigger.
 *
 * How it works:
 * 1. Find swing lows on H1 (the "targets" where stops accumulate)
 * 2. Scan the last N M5 candles to see if any wicked below those levels
 * 3. Check if the M5 candle closed back above the swing low (= sweep confirmed)
 * 4. Also check for "delayed sweeps" — closed below but next candle recovered
 *
 * @param {Array} entryTF - M5 OHLCV array (entry timeframe)
 * @param {Array} structureTF - H1 OHLCV array (structure timeframe)
 * @param {number} currentATR - Current ATR for depth measurement
 * @param {number} scanBars - How many M5 candles to scan (default 5)
 * @returns {object} Sweep detection result
 */
export function detectLiquiditySweep(entryTF, structureTF, currentATR, scanBars = 5) {
  const result = {
    detected: false,
    type: 'SWEEP',
    level: null,         // The H1 swing low that was swept
    sweepCandle: null,   // The M5 candle that performed the sweep
    sweepDepth: 0,       // How far below the level the wick went ($)
    sweepDepthATR: 0,    // Sweep depth in ATR units
    closedAbove: false,  // Did the sweep candle close above the level?
    recoveryClose: false,// Did the NEXT candle close back above? (delayed sweep)
    confidence: 0,       // 0-100 confidence score
    description: ''
  };

  if (!entryTF || entryTF.length < 10 || !structureTF || structureTF.length < 10) {
    return result;
  }

  // Step 1: Find H1 swing lows (the liquidity targets)
  const h1Swings = findSwingPoints(structureTF, 3);
  if (h1Swings.swingLows.length === 0) return result;

  // Get the most recent swing lows (last 5 — most relevant for current trading)
  const recentSwingLows = h1Swings.swingLows.slice(-5);
  const atr = currentATR || 10;

  // Step 2: Scan last N M5 candles for sweep behavior
  const startIdx = Math.max(0, entryTF.length - scanBars);
  let bestSweep = null;
  let bestConfidence = 0;

  for (let i = startIdx; i < entryTF.length; i++) {
    const candle = entryTF[i];
    const nextCandle = i < entryTF.length - 1 ? entryTF[i + 1] : null;

    for (const swingLow of recentSwingLows) {
      // Did this candle wick below the swing low?
      if (candle.low < swingLow.price) {
        const sweepDepth = swingLow.price - candle.low;
        const sweepDepthATR = sweepDepth / atr;
        const closedAbove = candle.close > swingLow.price;

        // Check for delayed recovery (closed below but next candle recovered)
        const recoveryClose = !closedAbove && nextCandle && nextCandle.close > swingLow.price;

        // Calculate confidence based on quality of the sweep
        let confidence = 0;

        if (closedAbove) {
          // Perfect sweep — wick below, close above
          confidence = 70;

          // Bonus: small sweep depth (just grabbed stops, didn't break)
          if (sweepDepthATR < 0.3) confidence += 15;
          else if (sweepDepthATR < 0.5) confidence += 10;

          // Bonus: strong close (closed in upper half of candle = buyers won)
          const candleRange = candle.high - candle.low;
          const closePosition = (candle.close - candle.low) / (candleRange || 1);
          if (closePosition > 0.7) confidence += 10;
          if (closePosition > 0.85) confidence += 5;

        } else if (recoveryClose) {
          // Delayed sweep — took 2 candles to recover
          confidence = 45;
          if (sweepDepthATR < 0.3) confidence += 10;
        }

        // Sweep too deep (> 1 ATR below level) — likely a real breakdown, not a sweep
        if (sweepDepthATR > 1.0) {
          confidence = Math.min(confidence, 20);
        }

        if (confidence > bestConfidence) {
          bestConfidence = confidence;
          bestSweep = {
            level: swingLow,
            sweepCandle: candle,
            sweepCandleIndex: i,
            sweepDepth,
            sweepDepthATR,
            closedAbove,
            recoveryClose,
            confidence,
            nextCandle
          };
        }
      }
    }
  }

  // Step 3: Populate result if a sweep was found
  if (bestSweep && bestSweep.confidence >= 40) {
    result.detected = true;
    result.level = bestSweep.level;
    result.sweepCandle = bestSweep.sweepCandle;
    result.sweepDepth = parseFloat(bestSweep.sweepDepth.toFixed(2));
    result.sweepDepthATR = parseFloat(bestSweep.sweepDepthATR.toFixed(2));
    result.closedAbove = bestSweep.closedAbove;
    result.recoveryClose = bestSweep.recoveryClose;
    result.confidence = bestSweep.confidence;

    const sweepType = bestSweep.closedAbove ? 'Clean Sweep' : 'Delayed Recovery Sweep';
    result.description = `${sweepType} — M5 wick swept $${result.sweepDepth} below H1 swing low at $${bestSweep.level.price.toFixed(2)} (${result.sweepDepthATR} ATR depth). Confidence: ${result.confidence}%`;
  }

  return result;
}


// ═══════════════════════════════════════════════════════════════════
// 5. FAIR VALUE GAP (FVG) DETECTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Detects Fair Value Gaps (imbalances) in price data.
 * A bullish FVG: candle[i-2].high < candle[i].low → gap between wicks.
 * A bearish FVG: candle[i-2].low > candle[i].high → gap above.
 *
 * @param {Array} ohlcv - OHLCV array for a single timeframe
 * @param {number} currentPrice - Current price for proximity check
 * @param {number} currentATR - ATR for relevance filtering
 * @returns {object} { gaps: Array, bullishNearPrice: Array, bearishNearPrice: Array }
 */
export function detectFairValueGaps(ohlcv, currentPrice, currentATR) {
  const gaps = [];

  if (!ohlcv || ohlcv.length < 3) {
    return { gaps, bullishNearPrice: [], bearishNearPrice: [] };
  }

  const atr = currentATR || 10;

  for (let i = 2; i < ohlcv.length; i++) {
    const candleBefore = ohlcv[i - 2];  // Candle 1
    const candleMiddle = ohlcv[i - 1];  // Candle 2 (the impulse candle)
    const candleAfter = ohlcv[i];       // Candle 3

    // Bullish FVG: Candle 1's high is lower than Candle 3's low
    // → there's a gap below current price where no trading happened
    if (candleBefore.high < candleAfter.low) {
      const gapTop = candleAfter.low;
      const gapBottom = candleBefore.high;
      const gapSize = gapTop - gapBottom;

      // Only count meaningful gaps (> 10% of ATR)
      if (gapSize > atr * 0.1) {
        const midpoint = (gapTop + gapBottom) / 2;
        const distanceFromPrice = currentPrice - midpoint;
        const distanceATR = Math.abs(distanceFromPrice) / atr;

        // Check if price has filled the gap
        let filled = false;
        for (let j = i + 1; j < ohlcv.length; j++) {
          if (ohlcv[j].low <= gapBottom) {
            filled = true;
            break;
          }
        }

        gaps.push({
          type: 'BULLISH_FVG',
          top: parseFloat(gapTop.toFixed(2)),
          bottom: parseFloat(gapBottom.toFixed(2)),
          midpoint: parseFloat(midpoint.toFixed(2)),
          size: parseFloat(gapSize.toFixed(2)),
          sizeATR: parseFloat((gapSize / atr).toFixed(2)),
          filled,
          distanceFromPrice: parseFloat(distanceFromPrice.toFixed(2)),
          distanceATR: parseFloat(distanceATR.toFixed(2)),
          time: candleMiddle.time,
          impulseCandle: candleMiddle
        });
      }
    }

    // Bearish FVG: Candle 1's low is higher than Candle 3's high
    // → gap above current price where no trading happened
    if (candleBefore.low > candleAfter.high) {
      const gapTop = candleBefore.low;
      const gapBottom = candleAfter.high;
      const gapSize = gapTop - gapBottom;

      if (gapSize > atr * 0.1) {
        const midpoint = (gapTop + gapBottom) / 2;
        const distanceFromPrice = midpoint - currentPrice;
        const distanceATR = Math.abs(distanceFromPrice) / atr;

        let filled = false;
        for (let j = i + 1; j < ohlcv.length; j++) {
          if (ohlcv[j].high >= gapTop) {
            filled = true;
            break;
          }
        }

        gaps.push({
          type: 'BEARISH_FVG',
          top: parseFloat(gapTop.toFixed(2)),
          bottom: parseFloat(gapBottom.toFixed(2)),
          midpoint: parseFloat(midpoint.toFixed(2)),
          size: parseFloat(gapSize.toFixed(2)),
          sizeATR: parseFloat((gapSize / atr).toFixed(2)),
          filled,
          distanceFromPrice: parseFloat(distanceFromPrice.toFixed(2)),
          distanceATR: parseFloat(distanceATR.toFixed(2)),
          time: candleMiddle.time,
          impulseCandle: candleMiddle
        });
      }
    }
  }

  // Filter for unfilled gaps near current price (within 2 ATR)
  const bullishNearPrice = gaps
    .filter(g => g.type === 'BULLISH_FVG' && !g.filled && g.distanceATR < 2.0 && g.distanceFromPrice > 0)
    .sort((a, b) => a.distanceATR - b.distanceATR);

  const bearishNearPrice = gaps
    .filter(g => g.type === 'BEARISH_FVG' && !g.filled && g.distanceATR < 2.0 && g.distanceFromPrice > 0)
    .sort((a, b) => a.distanceATR - b.distanceATR);

  return { gaps, bullishNearPrice, bearishNearPrice };
}

/**
 * Runs FVG detection across multiple timeframes and merges results.
 * @param {object} mtfData - { m5, m15, m30 } OHLCV arrays
 * @param {number} currentPrice
 * @param {number} currentATR
 * @returns {object} Merged FVG map
 */
export function detectMultiTimeframeFVGs(mtfData, currentPrice, currentATR) {
  const fvgMap = {
    m5: { gaps: [], bullishNearPrice: [], bearishNearPrice: [] },
    m15: { gaps: [], bullishNearPrice: [], bearishNearPrice: [] },
    m30: { gaps: [], bullishNearPrice: [], bearishNearPrice: [] },
    allBullishNearPrice: [],
    allBearishNearPrice: []
  };

  const tfWeights = { m5: 1, m15: 2, m30: 3 };

  for (const [tfKey, weight] of Object.entries(tfWeights)) {
    const data = mtfData[tfKey];
    if (!data || data.length < 10) continue;

    const result = detectFairValueGaps(data, currentPrice, currentATR);
    fvgMap[tfKey] = result;

    // Tag with timeframe and weight for merged list
    result.bullishNearPrice.forEach(g => {
      fvgMap.allBullishNearPrice.push({ ...g, timeframe: tfKey.toUpperCase(), weight });
    });
    result.bearishNearPrice.forEach(g => {
      fvgMap.allBearishNearPrice.push({ ...g, timeframe: tfKey.toUpperCase(), weight });
    });
  }

  // Sort by distance (closest unfilled FVGs first)
  fvgMap.allBullishNearPrice.sort((a, b) => a.distanceATR - b.distanceATR);
  fvgMap.allBearishNearPrice.sort((a, b) => a.distanceATR - b.distanceATR);

  return fvgMap;
}


// ═══════════════════════════════════════════════════════════════════
// 6. VOLUME SPIKE DETECTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Detects volume spikes relative to the 20-candle rolling average.
 * A spike (>= 2x average) at a sweep zone = institutional buying.
 *
 * @param {Array} ohlcv - OHLCV array (must include .volume field)
 * @param {number} atIndex - Index of the specific candle to check (-1 = last candle)
 * @param {number} avgPeriod - Period for average volume (default 20)
 * @returns {object} { spike, ratio, avgVolume, candleVolume }
 */
export function detectVolumeSpike(ohlcv, atIndex = -1, avgPeriod = 20) {
  const result = {
    spike: false,
    ratio: 0,
    avgVolume: 0,
    candleVolume: 0,
    level: 'NORMAL' // NORMAL, ELEVATED, SPIKE, EXTREME
  };

  if (!ohlcv || ohlcv.length < avgPeriod + 1) return result;

  const idx = atIndex < 0 ? ohlcv.length + atIndex : atIndex;
  if (idx < avgPeriod || idx >= ohlcv.length) return result;

  // Calculate 20-candle average volume (excluding the target candle)
  let sum = 0;
  for (let i = idx - avgPeriod; i < idx; i++) {
    sum += (ohlcv[i].volume || 0);
  }
  const avgVolume = sum / avgPeriod;

  if (avgVolume <= 0) return result;

  const candleVolume = ohlcv[idx].volume || 0;
  const ratio = candleVolume / avgVolume;

  result.avgVolume = Math.round(avgVolume);
  result.candleVolume = candleVolume;
  result.ratio = parseFloat(ratio.toFixed(2));

  if (ratio >= 3.0) {
    result.spike = true;
    result.level = 'EXTREME';
  } else if (ratio >= 2.0) {
    result.spike = true;
    result.level = 'SPIKE';
  } else if (ratio >= 1.5) {
    result.spike = false;
    result.level = 'ELEVATED';
  } else {
    result.level = 'NORMAL';
  }

  return result;
}


// ═══════════════════════════════════════════════════════════════════
// 7. RE-ACCUMULATION DETECTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Detects re-accumulation: clusters of tight-range / inside bar candles
 * near a support zone. Shows price building energy before the next move.
 *
 * @param {Array} ohlcv - OHLCV array (entry timeframe, e.g., M5)
 * @param {number} currentATR - ATR for range comparison
 * @param {Array} supportLevels - Array of { price } support levels to check proximity
 * @param {number} lookback - How many candles to scan (default 30)
 * @returns {object} Re-accumulation detection result
 */
export function detectReAccumulation(ohlcv, currentATR, supportLevels = [], lookback = 30) {
  const result = {
    detected: false,
    type: 'REACCUM',
    barCount: 0,
    rangeHigh: 0,
    rangeLow: 0,
    rangeSize: 0,
    rangeSizeATR: 0,
    nearestSupport: null,
    confidence: 0,
    description: ''
  };

  if (!ohlcv || ohlcv.length < 10) return result;

  const atr = currentATR || 10;
  const startIdx = Math.max(0, ohlcv.length - lookback);

  // Scan backwards from recent candles to find consecutive tight-range bars
  let tightBars = 0;
  let clusterHigh = -Infinity;
  let clusterLow = Infinity;

  // Check the most recent candles backwards
  for (let i = ohlcv.length - 1; i >= startIdx; i--) {
    const candle = ohlcv[i];
    const range = candle.high - candle.low;

    // "Tight range" = candle range is less than 40% of ATR
    if (range < atr * 0.4) {
      tightBars++;
      clusterHigh = Math.max(clusterHigh, candle.high);
      clusterLow = Math.min(clusterLow, candle.low);
    } else {
      // Once we hit a normal-range candle, stop counting
      break;
    }
  }

  if (tightBars < 5) return result;

  const rangeSize = clusterHigh - clusterLow;
  const rangeSizeATR = rangeSize / atr;

  // Check if this cluster is near a support level
  let nearestSupport = null;
  let minDist = Infinity;

  for (const level of supportLevels) {
    const dist = Math.abs(clusterLow - level.price);
    const distATR = dist / atr;
    if (distATR < 1.0 && dist < minDist) {
      minDist = dist;
      nearestSupport = { ...level, distanceATR: parseFloat(distATR.toFixed(2)) };
    }
  }

  let confidence = 0;

  // More tight bars = more compression = higher confidence
  if (tightBars >= 10) confidence = 70;
  else if (tightBars >= 7) confidence = 55;
  else confidence = 40;

  // Cluster near support boosts confidence
  if (nearestSupport && nearestSupport.distanceATR < 0.5) {
    confidence += 20;
  } else if (nearestSupport) {
    confidence += 10;
  }

  // Very tight range relative to ATR = strong compression
  if (rangeSizeATR < 0.3) confidence += 10;

  result.detected = true;
  result.barCount = tightBars;
  result.rangeHigh = parseFloat(clusterHigh.toFixed(2));
  result.rangeLow = parseFloat(clusterLow.toFixed(2));
  result.rangeSize = parseFloat(rangeSize.toFixed(2));
  result.rangeSizeATR = parseFloat(rangeSizeATR.toFixed(2));
  result.nearestSupport = nearestSupport;
  result.confidence = Math.min(confidence, 100);
  result.description = `Re-accumulation: ${tightBars} tight-range bars (range $${rangeSize.toFixed(2)} = ${rangeSizeATR.toFixed(1)} ATR)${nearestSupport ? ` near support at $${nearestSupport.price.toFixed(2)}` : ''}`;

  return result;
}


// ═══════════════════════════════════════════════════════════════════
// 8. BREAKOUT RETEST DETECTION
// ═══════════════════════════════════════════════════════════════════

/**
 * Detects breakout-retest setups: H1 breaks above resistance, then M5 pulls
 * back to the broken level and shows rejection (pin bar, engulfing, EMA support).
 *
 * @param {Array} entryTF - M5 OHLCV array
 * @param {Array} structureTF - H1 OHLCV array
 * @param {number} currentATR - ATR for proximity
 * @returns {object} Breakout retest detection result
 */
export function detectBreakoutRetest(entryTF, structureTF, currentATR) {
  const result = {
    detected: false,
    type: 'RETEST',
    brokenLevel: null,     // The resistance that was broken
    breakoutCandle: null,  // The H1 candle that broke it
    retestCandle: null,    // The M5 candle that retested
    confirmation: null,    // What confirmed the retest (pattern name)
    confidence: 0,
    description: ''
  };

  if (!entryTF || entryTF.length < 20 || !structureTF || structureTF.length < 20) {
    return result;
  }

  const atr = currentATR || 10;

  // Step 1: Find H1 swing highs (potential resistance levels that could be broken)
  const h1Swings = findSwingPoints(structureTF, 3);
  if (h1Swings.swingHighs.length < 2) return result;

  // Step 2: Check if the most recent H1 candles broke above a swing high
  const recentH1 = structureTF.slice(-5); // Last 5 H1 candles
  const prevSwingHighs = h1Swings.swingHighs.slice(-5);

  let brokenLevel = null;
  let breakoutCandle = null;

  for (const sh of prevSwingHighs) {
    for (const candle of recentH1) {
      // H1 candle closed above the swing high = breakout
      if (candle.close > sh.price && candle.open <= sh.price) {
        // Is this a strong breakout? (close well above the level)
        const breakoutStrength = (candle.close - sh.price) / atr;
        if (breakoutStrength > 0.1) {
          brokenLevel = sh;
          breakoutCandle = candle;
        }
      }
    }
  }

  if (!brokenLevel || !breakoutCandle) return result;

  // Step 3: Check if M5 has pulled back to the broken level (now support)
  const recentM5 = entryTF.slice(-10); // Last 10 M5 candles
  let retestCandle = null;
  let retestIdx = -1;

  for (let i = 0; i < recentM5.length; i++) {
    const candle = recentM5[i];
    const distToLevel = Math.abs(candle.low - brokenLevel.price);
    const distATR = distToLevel / atr;

    // Price touched or came very close to the broken level
    if (distATR < 0.3 && candle.low <= brokenLevel.price + atr * 0.2) {
      retestCandle = candle;
      retestIdx = entryTF.length - recentM5.length + i;
    }
  }

  if (!retestCandle) return result;

  // Step 4: Check for confirmation pattern at the retest
  let confirmation = null;
  let confidence = 40; // Base confidence for a valid retest

  // Check candle patterns at/after the retest
  const retestArea = entryTF.slice(Math.max(0, retestIdx - 1), Math.min(entryTF.length, retestIdx + 3));
  const patterns = detectCandlestickPatterns(retestArea, retestArea.length);

  const bullishPatterns = patterns.filter(p => p.bias === 'BULLISH');
  if (bullishPatterns.length > 0) {
    confirmation = bullishPatterns[0].pattern;
    confidence += 25;

    if (confirmation === 'ENGULFING_BULLISH') confidence += 10;
    else if (confirmation === 'PIN_BAR_BULLISH') confidence += 10;
  }

  // Check if price bounced after the retest (close back above breakout level)
  const lastCandle = entryTF[entryTF.length - 1];
  if (lastCandle.close > brokenLevel.price) {
    confidence += 15;
  }

  if (confidence < 40) return result;

  result.detected = true;
  result.brokenLevel = brokenLevel;
  result.breakoutCandle = breakoutCandle;
  result.retestCandle = retestCandle;
  result.confirmation = confirmation;
  result.confidence = Math.min(confidence, 100);
  result.description = `Breakout Retest — H1 broke above $${brokenLevel.price.toFixed(2)}, M5 retested and ${confirmation ? `confirmed with ${confirmation}` : 'showed rejection'}. Confidence: ${result.confidence}%`;

  return result;
}


// ═══════════════════════════════════════════════════════════════════
// 9. COMPREHENSIVE PRICE ACTION REPORT BUILDER
// ═══════════════════════════════════════════════════════════════════

/**
 * Runs complete price action analysis on multi-timeframe data.
 * Returns a structured report for the AI prompt.
 * @param {object} mtfData - { d1, h1, m30, m15, m5, m1 } OHLCV arrays
 * @param {number} currentPrice - Current price
 * @param {number} currentATR - Current ATR
 * @returns {object} Full price action context
 */
export function analyzePriceAction(mtfData, currentPrice, currentATR) {
  const report = {
    timeframes: {},
    srMap: null,
    liquiditySweep: null,
    fvgMap: null,
    reAccumulation: null,
    breakoutRetest: null,
    volumeSpike: null,
    summary: ''
  };

  // Analyze each timeframe independently
  const tfLabels = { d1: 'Daily', h1: '1-Hour', m30: '30-Min', m15: '15-Min', m5: '5-Min', m1: '1-Min' };

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

  // Extract support levels for reaccumulation check
  const supportLevels = report.srMap ? report.srMap.levels.filter(l => l.type === 'support') : [];

  // Run new liquidity-sweep strategy structural detections
  report.liquiditySweep = detectLiquiditySweep(mtfData.m5, mtfData.h1, currentATR);
  report.fvgMap = detectMultiTimeframeFVGs(mtfData, currentPrice, currentATR);
  report.reAccumulation = detectReAccumulation(mtfData.m5, currentATR, supportLevels);
  report.breakoutRetest = detectBreakoutRetest(mtfData.m5, mtfData.h1, currentATR);
  report.volumeSpike = detectVolumeSpike(mtfData.m5, -1);

  // If a sweep is active, check volume spike specifically on the sweep candle
  if (report.liquiditySweep && report.liquiditySweep.detected && report.liquiditySweep.sweepCandle) {
    const m5Data = mtfData.m5 || [];
    const sweepTime = report.liquiditySweep.sweepCandle.time;
    const sweepIdx = m5Data.findIndex(c => c.time === sweepTime);
    if (sweepIdx !== -1) {
      report.liquiditySweep.volumeSpike = detectVolumeSpike(m5Data, sweepIdx);
    }
  }

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

  // 1. Structural Setups & Triggers
  lines.push('### STRUCTURAL SETUP DETECTIONS');
  
  if (report.liquiditySweep && report.liquiditySweep.detected) {
    lines.push(`🟢 LIQUIDITY SWEEP DETECTED:`);
    lines.push(`  • Detail: ${report.liquiditySweep.description}`);
    if (report.liquiditySweep.volumeSpike) {
      lines.push(`  • Volume Confirmation: ${report.liquiditySweep.volumeSpike.level} (Ratio: ${report.liquiditySweep.volumeSpike.ratio}x avg volume)`);
    }
  } else {
    lines.push(`⚪ Liquidity Sweep: No active sweep below H1 swing lows on last 5 M5 candles`);
  }

  if (report.breakoutRetest && report.breakoutRetest.detected) {
    lines.push(`🟢 BREAKOUT-RETEST DETECTED:`);
    lines.push(`  • Detail: ${report.breakoutRetest.description}`);
  } else {
    lines.push(`⚪ Breakout-Retest: No active setup detected`);
  }

  if (report.reAccumulation && report.reAccumulation.detected) {
    lines.push(`🟢 RE-ACCUMULATION DETECTED:`);
    lines.push(`  • Detail: ${report.reAccumulation.description}`);
  } else {
    lines.push(`⚪ Re-accumulation: No tight-range coiling detected near support`);
  }
  lines.push('');

  // 2. Fair Value Gaps
  lines.push('### UNFILLED FAIR VALUE GAPS (FVG)');
  
  if (report.fvgMap && report.fvgMap.allBullishNearPrice.length > 0) {
    lines.push(`🟢 Bullish FVGs (Hidden Demand/Support) near price (within 2 ATR):`);
    report.fvgMap.allBullishNearPrice.slice(0, 4).forEach(g => {
      lines.push(`  • [${g.timeframe}] $${g.bottom.toFixed(2)} - $${g.top.toFixed(2)} — Size: $${g.size.toFixed(2)} (${g.sizeATR.toFixed(1)} ATR) — Dist: $${g.distanceFromPrice.toFixed(2)} below (${g.distanceATR.toFixed(1)} ATR)`);
    });
  } else {
    lines.push(`⚪ Bullish FVGs: No unfilled gaps near current price`);
  }

  if (report.fvgMap && report.fvgMap.allBearishNearPrice.length > 0) {
    lines.push(`🔴 Bearish FVGs (Hidden Supply/Resistance) near price (within 2 ATR):`);
    report.fvgMap.allBearishNearPrice.slice(0, 4).forEach(g => {
      lines.push(`  • [${g.timeframe}] $${g.bottom.toFixed(2)} - $${g.top.toFixed(2)} — Size: $${g.size.toFixed(2)} (${g.sizeATR.toFixed(1)} ATR) — Dist: $${g.distanceFromPrice.toFixed(2)} above (${g.distanceATR.toFixed(1)} ATR)`);
    });
  } else {
    lines.push(`⚪ Bearish FVGs: No unfilled gaps near current price`);
  }
  lines.push('');

  // 3. Volume Profile
  lines.push('### VOLUME PROFILE (M5 Timeframe)');
  if (report.volumeSpike) {
    lines.push(`  • Current M5 Candle Volume: ${report.volumeSpike.candleVolume} (avg ${report.volumeSpike.avgVolume}, Ratio: ${report.volumeSpike.ratio}x, Level: ${report.volumeSpike.level})`);
  }
  lines.push('');

  // 4. Per-timeframe summaries
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

  // 5. Support/Resistance Map
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

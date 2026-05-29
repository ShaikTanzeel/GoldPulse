import { 
  calculateEMA, 
  calculateRSI, 
  calculateMACD, 
  calculateATR, 
  detectSupportResistance, 
  detectDivergence 
} from './indicators.js';
import { analyzePriceAction } from './priceAction.js';

/**
 * Confluence-Based Sweep/Buy-the-Dip Signal Engine for GoldPulse
 * Pure price-action driven system with tiered scoring confluences.
 */
export function generateSignals(ohlcv, mtfData = null) {
  if (!ohlcv || ohlcv.length < 200) {
    return {
      signal: 'WAIT',
      score: 0,
      setupType: 'NONE',
      reasons: ['Insufficient historical data (minimum 200 candles required)'],
      metrics: {},
      priceAction: null
    };
  }

  const closes = ohlcv.map(c => c.close);
  const highs = ohlcv.map(c => c.high);
  const lows = ohlcv.map(c => c.low);
  
  const len = closes.length;
  const currentPrice = closes[len - 1];

  // Calculate indicators for visual confluences & filters
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  
  const rsi = calculateRSI(closes, 14);
  const macdData = calculateMACD(closes, 12, 26, 9);
  const atr = calculateATR(highs, lows, closes, 14);
  
  const keyLevels = detectSupportResistance(highs, lows, closes, 20);
  const divergence = detectDivergence(closes, rsi, 20);

  const currEma21 = ema21[len - 1];
  const currEma50 = ema50[len - 1];
  const currEma200 = ema200[len - 1];
  
  const currRsi = rsi[len - 1];
  const currHist = macdData.histogram[len - 1];
  const prevHist = macdData.histogram[len - 2] || 0;
  const currAtr = atr[len - 1];

  const reasons = [];
  
  // ═══════════════════════════════════════════════════════════════
  // STEP 1: DETECT MULTI-TIMEFRAME PRICE ACTION
  // ═══════════════════════════════════════════════════════════════
  let priceActionReport = null;
  if (mtfData) {
    priceActionReport = analyzePriceAction(mtfData, currentPrice, currAtr);
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 2: TIER 1 — STRUCTURAL SETUPS (The Trade Triggers)
  // ═══════════════════════════════════════════════════════════════
  let tier1Score = 0;
  let setupType = 'NONE';
  let setupDetail = '';

  const setups = [];
  if (priceActionReport) {
    // 1. Liquidity Sweep (+3.0) — M5 wick below H1 swing low, closed back above
    if (priceActionReport.liquiditySweep && priceActionReport.liquiditySweep.detected) {
      setups.push({
        type: 'SWEEP',
        score: 3.0,
        detail: priceActionReport.liquiditySweep.description
      });
    }
    // 2. FVG Fill at Support (+2.0) — price filled bullish imbalance near support
    if (priceActionReport.fvgMap && priceActionReport.fvgMap.allBullishNearPrice.length > 0) {
      const closestFVG = priceActionReport.fvgMap.allBullishNearPrice[0];
      setups.push({
        type: 'FVG_FILL',
        score: 2.0,
        detail: `Bullish FVG filled at $${closestFVG.bottom.toFixed(2)}-$${closestFVG.top.toFixed(2)} [${closestFVG.timeframe}]`
      });
    }
    // 3. Breakout Retest (+2.0) — H1 broke resistance, M5 pullback + rejection
    if (priceActionReport.breakoutRetest && priceActionReport.breakoutRetest.detected) {
      setups.push({
        type: 'RETEST',
        score: 2.0,
        detail: priceActionReport.breakoutRetest.description
      });
    }
    // 4. Re-accumulation (+1.5) — tight range/inside bars building energy near support
    if (priceActionReport.reAccumulation && priceActionReport.reAccumulation.detected) {
      setups.push({
        type: 'REACCUM',
        score: 1.5,
        detail: priceActionReport.reAccumulation.description
      });
    }
  }

  // Set the base score to the highest active setup to prevent double-counting
  if (setups.length > 0) {
    setups.sort((a, b) => b.score - a.score);
    tier1Score = setups[0].score;
    setupType = setups[0].type;
    setupDetail = setups[0].detail;
    reasons.push(`Tier 1 Setup Triggered: ${setupType} (+${tier1Score.toFixed(1)}) — ${setupDetail}`);
  }

  // 🔴 HARD GATE: Without a valid structural setup scoring >= 1.5, we output WAIT. Period.
  if (tier1Score < 1.5) {
    return {
      signal: 'WAIT',
      score: 0,
      setupType: 'NONE',
      reasons: ['WAIT: No structural triggers active. Strategy requires a Liquidity Sweep, FVG Fill, Retest, or Re-accumulation to take trade.'],
      metrics: {
        price: currentPrice,
        ema21: currEma21,
        ema50: currEma50,
        ema200: currEma200,
        rsi: currRsi,
        macd: currHist,
        atr: currAtr,
        trend: currEma21 > currEma50 ? 'BULLISH' : 'BEARISH'
      },
      setup: null,
      levels: keyLevels,
      priceAction: priceActionReport
    };
  }

  // Start with the base score
  let score = tier1Score;

  // ═══════════════════════════════════════════════════════════════
  // STEP 3: TIER 2 — CONFIRMATIONS (Only active because Tier 1 setup exists)
  // ═══════════════════════════════════════════════════════════════
  
  // 1. Volume Spike Check (+1.5 for Spike, +0.75 for Elevated)
  let volumeRatio = 1.0;
  if (setupType === 'SWEEP' && priceActionReport.liquiditySweep && priceActionReport.liquiditySweep.volumeSpike) {
    volumeRatio = priceActionReport.liquiditySweep.volumeSpike.ratio;
  } else if (priceActionReport.volumeSpike) {
    volumeRatio = priceActionReport.volumeSpike.ratio;
  }

  if (volumeRatio >= 2.0) {
    score += 1.5;
    reasons.push(`Tier 2 Confirm: Institutional Volume Spike confirmed (${volumeRatio}x avg volume) (+1.5)`);
  } else if (volumeRatio >= 1.5) {
    score += 0.75;
    reasons.push(`Tier 2 Confirm: Elevated volume at setup (${volumeRatio}x avg volume) (+0.75)`);
  }

  // 2. Bullish Candlestick Pattern at structure (+1.0)
  const m5Patterns = priceActionReport.timeframes.m5 ? priceActionReport.timeframes.m5.candlestickPatterns : [];
  const hasBullishPattern = m5Patterns.some(p => p.bias === 'BULLISH');
  if (hasBullishPattern) {
    score += 1.0;
    const patName = m5Patterns.find(p => p.bias === 'BULLISH').pattern;
    reasons.push(`Tier 2 Confirm: Bullish ${patName} candle at setup zone (+1.0)`);
  }

  // 3. RSI Oversold at Structure (+1.0)
  if (currRsi < 35) {
    score += 1.0;
    reasons.push(`Tier 2 Confirm: Rubber band stretched, RSI oversold at structure (${currRsi.toFixed(1)} < 35) (+1.0)`);
  }

  // 4. Bullish FVG coincides with sweep zone (+1.0)
  if (setupType === 'SWEEP' && priceActionReport.liquiditySweep && priceActionReport.fvgMap) {
    const sweepLevelPrice = priceActionReport.liquiditySweep.level.price;
    const nearbyFVG = priceActionReport.fvgMap.allBullishNearPrice.find(g => Math.abs(g.midpoint - sweepLevelPrice) / currAtr < 0.5);
    if (nearbyFVG) {
      score += 1.0;
      reasons.push(`Tier 2 Confirm: Bullish FVG zone aligns with liquidity sweep level (+1.0)`);
    }
  }

  // 5. RSI Bullish Divergence (+1.0)
  if (divergence === 'BULLISH_DIVERGENCE') {
    score += 1.0;
    reasons.push('Tier 2 Confirm: Bullish RSI Divergence suggests smart money absorption (+1.0)');
  }

  // 6. MACD Histogram Turning Upward (+0.5)
  const macdTurning = currHist > prevHist && prevHist < 0;
  if (macdTurning) {
    score += 0.5;
    reasons.push('Tier 2 Confirm: MACD sellers losing power, histogram turning upward (+0.5)');
  }

  // 7. Dynamic EMA Dynamic Support (+0.5)
  if (currentPrice <= currEma21 && currentPrice >= currEma50 && currEma21 > currEma50) {
    score += 0.5;
    reasons.push('Tier 2 Confirm: Price bouncing off EMA 21/50 value pocket (+0.5)');
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 4: TIER 3 — FILTERS & PENALTIES (Block/reduce risk on bad trades)
  // ═══════════════════════════════════════════════════════════════
  const srMap = priceActionReport.srMap;

  // 1. Proximity to H1/D1 Resistance (-2.0)
  if (srMap && srMap.nearestResistance && srMap.nearestResistance.distanceATR <= 0.5) {
    score -= 2.0;
    reasons.push(`Tier 3 Filter: Buying directly into Resistance Zone at $${srMap.nearestResistance.price} (${srMap.nearestResistance.distanceATR.toFixed(1)} ATR away) (-2.0)`);
  }

  // 2. RSI Overbought Protection (-1.5)
  if (currRsi > 70) {
    score -= 1.5;
    reasons.push(`Tier 3 Filter: RSI is already Overbought (${currRsi.toFixed(1)} > 70) — do not chase here (-1.5)`);
  }

  // 3. Multi-TF Overhead Resistance Confluence (-1.0)
  if (srMap && srMap.dangerZone.criticalLevels.length >= 2) {
    const hasHighTF = srMap.dangerZone.criticalLevels.some(l => l.timeframe === 'D1' || l.timeframe === 'H1');
    if (hasHighTF) {
      score -= 1.0;
      reasons.push('Tier 3 Filter: Heavy overhead supply confluences detected on high timeframes (-1.0)');
    }
  }

  // 4. Daily Trend Filter (Cap total score at 2.0 if D1 structure is bearish)
  let capApplied = false;
  const d1Structure = priceActionReport.timeframes.d1;
  if (d1Structure && !d1Structure.error && d1Structure.trend === 'DOWNTREND') {
    capApplied = true;
  }

  if (capApplied && score > 2.0) {
    score = 2.0;
    reasons.push(`📊 Tier 3 Filter: D1 structure is BEARISH — final score capped at 2.0 to prevent counter-trend risk`);
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 5: VERDICT BADGE
  // ═══════════════════════════════════════════════════════════════
  let finalSignal = 'WAIT';
  if (score >= 4.0) {
    finalSignal = 'STRONG BUY';
  } else if (score >= 2.5) {
    finalSignal = 'BUY';
  }

  // ═══════════════════════════════════════════════════════════════
  // STEP 6: STRUCTURAL SL & TP CALCULATION
  // ═══════════════════════════════════════════════════════════════
  let suggestedSL = null;
  let suggestedTP = null;
  let riskRewardRatio = 0;

  if (finalSignal.includes('BUY')) {
    let slPrice = null;
    let tpPrice = null;

    // SL goes below the structural low buffer of the trap candle
    if (setupType === 'SWEEP' && priceActionReport.liquiditySweep && priceActionReport.liquiditySweep.sweepCandle) {
      const sweepLow = priceActionReport.liquiditySweep.sweepCandle.low;
      slPrice = sweepLow - (currAtr * 0.5); // 0.5 ATR buffer below sweep low
    } else if (setupType === 'RETEST' && priceActionReport.breakoutRetest && priceActionReport.breakoutRetest.retestCandle) {
      const retestLow = priceActionReport.breakoutRetest.retestCandle.low;
      slPrice = retestLow - (currAtr * 0.5);
    } else {
      // Fallback to nearest major support level
      if (srMap && srMap.nearestSupport) {
        slPrice = srMap.nearestSupport.price - (currAtr * 0.5);
      } else {
        slPrice = currentPrice - (currAtr * 1.5);
      }
    }

    // TP goes at the nearest structural H1 resistance level
    if (srMap && srMap.levels) {
      const h1Resistances = srMap.levels.filter(l => l.type === 'resistance' && l.timeframe === 'H1' && l.price > currentPrice);
      if (h1Resistances.length > 0) {
        // Use the closest H1 resistance
        tpPrice = h1Resistances[0].price;
      }
    }

    // Fallback TP if no H1 resistance is found or it's too close (less than 2 ATR)
    const minTpDistance = currAtr * 2.0;
    if (!tpPrice || (tpPrice - currentPrice) < minTpDistance) {
      tpPrice = currentPrice + (currAtr * 3.0); // Default 1:2 standard R:R
    }

    suggestedSL = parseFloat(slPrice.toFixed(2));
    suggestedTP = parseFloat(tpPrice.toFixed(2));
    
    const riskAmount = currentPrice - suggestedSL;
    const rewardAmount = suggestedTP - currentPrice;
    riskRewardRatio = riskAmount > 0 ? parseFloat((rewardAmount / riskAmount).toFixed(2)) : 0;
  }

  return {
    signal: finalSignal,
    score: score,
    setupType: setupType,
    reasons: reasons,
    metrics: {
      price: currentPrice,
      ema21: currEma21,
      ema50: currEma50,
      ema200: currEma200,
      rsi: currRsi,
      macd: currHist,
      atr: currAtr,
      trend: currEma21 > currEma50 ? 'BULLISH' : 'BEARISH'
    },
    setup: suggestedSL ? {
      entry: parseFloat(currentPrice.toFixed(2)),
      sl: suggestedSL,
      tp: suggestedTP,
      rr: riskRewardRatio
    } : null,
    levels: keyLevels,
    priceAction: priceActionReport
  };
}

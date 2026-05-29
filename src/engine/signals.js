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
 * Confluence-Based Signal Engine for GoldPulse (MQL5 Strategy)
 * Now enhanced with multi-timeframe price action awareness.
 */
export function generateSignals(ohlcv, mtfData = null) {
  if (!ohlcv || ohlcv.length < 200) {
    return {
      signal: 'WAIT',
      score: 0,
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

  // Calculate indicators
  const ema21 = calculateEMA(closes, 21);
  const ema50 = calculateEMA(closes, 50);
  const ema200 = calculateEMA(closes, 200);
  
  const rsi = calculateRSI(closes, 14);
  const macdData = calculateMACD(closes, 12, 26, 9);
  const atr = calculateATR(highs, lows, closes, 14);
  
  const keyLevels = detectSupportResistance(highs, lows, closes, 20);
  const divergence = detectDivergence(closes, rsi, 20);

  // Latest indicator readings
  const currEma21 = ema21[len - 1];
  const currEma50 = ema50[len - 1];
  const currEma200 = ema200[len - 1];
  
  const currRsi = rsi[len - 1];
  const currMacd = macdData.macd[len - 1];
  const currMacdSignal = macdData.signal[len - 1];
  const currHist = macdData.histogram[len - 1];
  const prevHist = macdData.histogram[len - 2] || 0;
  const currAtr = atr[len - 1];

  let score = 0;
  const reasons = [];

  // 1. Trend Factor (EMA alignment)
  let trendState = 'NEUTRAL';
  if (currEma21 > currEma50 && currEma50 > currEma200) {
    score += 2;
    trendState = 'BULLISH';
    reasons.push('EMA Alignment is Bullish (21 > 50 > 200)');
  } else if (currEma21 < currEma50 && currEma50 < currEma200) {
    score -= 2;
    trendState = 'BEARISH';
    reasons.push('EMA Alignment is Bearish (21 < 50 < 200)');
  } else {
    reasons.push('EMA Trend is Neutral / Consolidation');
  }

  // 2. Momentum Factor (RSI position)
  if (currRsi > 50) {
    score += 1;
    reasons.push(`RSI is Bullish (${currRsi.toFixed(1)} > 50)`);
    if (currRsi > 70) {
      reasons.push('RSI Overbought Alert (> 70) — Watch for pullback');
    }
  } else if (currRsi < 50) {
    score -= 1;
    reasons.push(`RSI is Bearish (${currRsi.toFixed(1)} < 50)`);
    if (currRsi < 30) {
      reasons.push('RSI Oversold Alert (< 30) — Watch for recovery');
    }
  }

  // 3. Trend Acceleration Factor (MACD)
  if (currHist > 0) {
    score += 1;
    reasons.push('MACD histogram is Positive');
    if (currHist > prevHist) {
      score += 0.5;
      reasons.push('MACD momentum is accelerating upwards');
    }
  } else if (currHist < 0) {
    score -= 1;
    reasons.push('MACD histogram is Negative');
    if (currHist < prevHist) {
      score -= 0.5;
      reasons.push('MACD momentum is accelerating downwards');
    }
  }

  // 4. Pullback / Value Zone Detection (Price vs EMA21 & EMA50)
  if (trendState === 'BULLISH') {
    // If price is pulling back into the EMA 21 - EMA 50 value pocket
    if (currentPrice <= currEma21 && currentPrice >= currEma50) {
      score += 1.5;
      reasons.push('Price is inside the Bullish EMA value pocket (EMA21 - EMA50 pullback)');
    }
  } else if (trendState === 'BEARISH') {
    if (currentPrice >= currEma21 && currentPrice <= currEma50) {
      score -= 1.5;
      reasons.push('Price is inside the Bearish EMA value pocket (EMA21 - EMA50 pullback)');
    }
  }

  // 5. RSI Divergence Boost
  if (divergence === 'BULLISH_DIVERGENCE') {
    score += 2;
    reasons.push('⚠️ BULLISH DIVERGENCE detected on RSI!');
  } else if (divergence === 'BEARISH_DIVERGENCE') {
    score -= 2;
    reasons.push('⚠️ BEARISH DIVERGENCE detected on RSI!');
  }

  // ═══════════════════════════════════════════════════════════════
  // 6. PRICE ACTION CONTEXT FILTERS (NEW)
  // ═══════════════════════════════════════════════════════════════
  let priceActionReport = null;

  if (mtfData) {
    priceActionReport = analyzePriceAction(mtfData, currentPrice, currAtr);
    const srMap = priceActionReport.srMap;

    // 6a. S/R Proximity Penalty — don't buy at resistance, don't sell at support
    if (srMap) {
      if (srMap.nearestResistance && srMap.nearestResistance.distanceATR <= 0.5 && score > 0) {
        const penalty = srMap.nearestResistance.distanceATR <= 0.3 ? 2.0 : 1.5;
        score -= penalty;
        reasons.push(`⚠️ S/R FILTER: Price within ${srMap.nearestResistance.distanceATR.toFixed(1)} ATR of ${srMap.nearestResistance.timeframe} RESISTANCE at $${srMap.nearestResistance.price.toFixed(2)} (${srMap.nearestResistance.touches} touches) — bullish score reduced by ${penalty}`);
      }

      if (srMap.nearestSupport && srMap.nearestSupport.distanceATR <= 0.5 && score < 0) {
        const penalty = srMap.nearestSupport.distanceATR <= 0.3 ? 2.0 : 1.5;
        score += penalty;
        reasons.push(`⚠️ S/R FILTER: Price within ${Math.abs(srMap.nearestSupport.distanceATR).toFixed(1)} ATR of ${srMap.nearestSupport.timeframe} SUPPORT at $${srMap.nearestSupport.price.toFixed(2)} (${srMap.nearestSupport.touches} touches) — bearish score reduced by ${penalty}`);
      }

      // Multi-TF confluence zone — even stronger penalty
      const criticals = srMap.dangerZone.criticalLevels;
      if (criticals.length >= 2) {
        const multiTF = criticals.some(l => l.timeframe === 'D1') || criticals.some(l => l.timeframe === 'H1');
        if (multiTF) {
          const extraPenalty = 1.0;
          if (score > 0) score -= extraPenalty;
          else if (score < 0) score += extraPenalty;
          reasons.push(`⚠️ MULTI-TF S/R CONFLUENCE: Price at critical zone across multiple timeframes — additional score adjustment of ${extraPenalty}`);
        }
      }
    }

    // 6b. Higher-Timeframe Trend Filter
    const d1Structure = priceActionReport.timeframes.d1;
    if (d1Structure && !d1Structure.error) {
      if (d1Structure.trend === 'DOWNTREND' && score > 2.0) {
        score = Math.min(score, 2.0);
        reasons.push(`📊 D1 TREND FILTER: Daily trend is BEARISH — bullish score capped at 2.0 (D1: ${d1Structure.structureDescription})`);
      } else if (d1Structure.trend === 'UPTREND' && score < -2.0) {
        score = Math.max(score, -2.0);
        reasons.push(`📊 D1 TREND FILTER: Daily trend is BULLISH — bearish score capped at -2.0 (D1: ${d1Structure.structureDescription})`);
      }
    }

    // 6c. CHoCH Warning — if structure is changing character, be cautious
    const currentTF = priceActionReport.timeframes.m30 || priceActionReport.timeframes.h1;
    if (currentTF && currentTF.lastCHoCH) {
      if (currentTF.lastCHoCH.type === 'BEARISH_CHOCH' && score > 0) {
        score -= 1.5;
        reasons.push(`⚠️ STRUCTURE WARNING: ${currentTF.label} shows Change of Character (bearish) — ${currentTF.lastCHoCH.description}`);
      } else if (currentTF.lastCHoCH.type === 'BULLISH_CHOCH' && score < 0) {
        score += 1.5;
        reasons.push(`⚠️ STRUCTURE WARNING: ${currentTF.label} shows Change of Character (bullish) — ${currentTF.lastCHoCH.description}`);
      }
    }
  }

  // Determine final action badge
  let finalSignal = 'WAIT';
  if (score >= 3.5) {
    finalSignal = 'STRONG BUY';
  } else if (score >= 1.5) {
    finalSignal = 'BUY';
  } else if (score <= -3.5) {
    finalSignal = 'STRONG SELL';
  } else if (score <= -1.5) {
    finalSignal = 'SELL';
  }

  // Dynamic Stop Loss and Take Profit levels based on ATR
  let suggestedSL = null;
  let suggestedTP = null;
  let riskRewardRatio = 0;

  if (currAtr) {
    const slMultiplier = 1.5;
    const tpMultiplier = 3.0; // Optimized R:R 1:2 standard target
    const atrDistance = currAtr * slMultiplier;
    
    if (finalSignal.includes('BUY')) {
      suggestedSL = parseFloat((currentPrice - atrDistance).toFixed(2));
      suggestedTP = parseFloat((currentPrice + (currAtr * tpMultiplier)).toFixed(2));
      riskRewardRatio = parseFloat((tpMultiplier / slMultiplier).toFixed(2));
    } else if (finalSignal.includes('SELL')) {
      suggestedSL = parseFloat((currentPrice + atrDistance).toFixed(2));
      suggestedTP = parseFloat((currentPrice - (currAtr * tpMultiplier)).toFixed(2));
      riskRewardRatio = parseFloat((tpMultiplier / slMultiplier).toFixed(2));
    }
  }

  return {
    signal: finalSignal,
    score: score,
    reasons: reasons,
    metrics: {
      price: currentPrice,
      ema21: currEma21,
      ema50: currEma50,
      ema200: currEma200,
      rsi: currRsi,
      macd: currMacd,
      macdSignal: currMacdSignal,
      histogram: currHist,
      atr: currAtr,
      divergence: divergence,
      trend: trendState
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

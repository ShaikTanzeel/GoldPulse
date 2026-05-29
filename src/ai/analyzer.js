import { store } from '../data/store.js';

/**
 * AI Analysis Interface for GoldPulse
 * 
 * Two AI engines:
 * 1. Groq Llama 3.3 70B — Text-based analysis with full price action context
 * 2. Gemini 2.5 Flash — Visual chart pattern analysis with multi-timeframe screenshots
 * 
 * New: AI Veto/Confidence system — AI can override indicator signals
 * when price action contradicts, with complete transparency.
 */

export const aiAnalyzer = {

  // ═══════════════════════════════════════════════════════════════
  // 1. GROQ LLAMA 3.3 — Technical + Price Action Analysis
  // ═══════════════════════════════════════════════════════════════

  async runIndicatorAnalysis(signalsData) {
    const keys = store.get('apiKeys');
    if (!keys || !keys.groq) {
      throw new Error('Groq API Key is missing. Please configure it in Settings.');
    }

    const { metrics, signal, score, reasons, setup, priceAction } = signalsData;
    const settings = store.get('settings');

    // Build the price action context block (NEW — the core upgrade)
    let priceActionContext = '';
    if (priceAction && priceAction.summary) {
      priceActionContext = `\n\n${priceAction.summary}`;
    }

    // Build S/R proximity alert
    let srAlert = '';
    if (priceAction && priceAction.srMap) {
      const sr = priceAction.srMap;
      if (sr.nearestResistance) {
        srAlert += `\nNearest Resistance: $${sr.nearestResistance.price.toFixed(2)} [${sr.nearestResistance.timeframe}] — ${sr.nearestResistance.touches} touches — ${sr.nearestResistance.distanceATR.toFixed(1)} ATR away${sr.nearestResistance.dangerLevel === 'CRITICAL' ? ' ⚠️ CRITICAL' : ''}`;
      }
      if (sr.nearestSupport) {
        srAlert += `\nNearest Support: $${sr.nearestSupport.price.toFixed(2)} [${sr.nearestSupport.timeframe}] — ${sr.nearestSupport.touches} touches — ${Math.abs(sr.nearestSupport.distanceATR).toFixed(1)} ATR away${sr.nearestSupport.dangerLevel === 'CRITICAL' ? ' ⚠️ CRITICAL' : ''}`;
      }
      if (sr.dangerZone.isInDangerZone) {
        srAlert += `\n${sr.dangerZone.message}`;
      }
    }

    const prompt = {
      model: "llama-3.3-70b-versatile",
      messages: [
        {
          role: "system",
          content: `You are an elite, institutional-grade Forex Trading Strategist specializing exclusively in XAUUSD (Gold Spot).

CRITICAL RULES:
1. You MUST analyze both the technical indicators AND the price action context provided.
2. If indicators show a signal but price action contradicts (e.g., BUY signal at resistance), you MUST flag this conflict.
3. Your response MUST be in two parts:
   - Part 1: ANALYSIS (detailed reasoning, what you see across timeframes)
   - Part 2: VERDICT (a structured decision block)

For Part 2, end your response with EXACTLY this format:
---VERDICT---
CONFIDENCE: [0-100]
ACTION: [STRONG BUY / BUY / WAIT / SELL / STRONG SELL]
OVERRIDE: [YES/NO] (YES if you disagree with the indicator signal)
OVERRIDE_REASON: [one line explanation if overriding, or "N/A"]
PRICE_ACTION_ALIGNMENT: [CONFIRMS / NEUTRAL / CONTRADICTS]
KEY_RISK: [one line about the biggest risk]
WATCH_FOR: [what would change your mind]

You operate on a strict, professional, non-emotional level, prioritizing capital preservation above all, particularly for small retail accounts ($50 size).`
        },
        {
          role: "user",
          content: `Analyze the following XAUUSD context:

═══ TECHNICAL INDICATORS ═══
- Current Spot Price: $${metrics.price || 'N/A'}
- Trend Status: ${metrics.trend} (EMA 21: ${metrics.ema21?.toFixed(2)}, EMA 50: ${metrics.ema50?.toFixed(2)}, EMA 200: ${metrics.ema200?.toFixed(2)})
- RSI (14): ${metrics.rsi?.toFixed(2)}
- MACD Line: ${metrics.macd?.toFixed(4)} | Signal Line: ${metrics.macdSignal?.toFixed(4)} | Histogram: ${metrics.histogram?.toFixed(4)}
- ATR (14) Volatility: ${metrics.atr?.toFixed(2)}
- Divergence: ${metrics.divergence || 'NONE'}
- Indicator Signal: ${signal} (Confluence Score: ${score.toFixed(1)})
- Indicator Reasons: ${reasons.join(' | ')}
${srAlert}
${priceActionContext}

═══ TRADE SETUP ═══
- Entry: $${setup?.entry || 'N/A'}
- Stop Loss: $${setup?.sl || 'N/A'}
- Take Profit: $${setup?.tp || 'N/A'}
- Risk:Reward: 1:${setup?.rr || 'N/A'}

═══ ACCOUNT ═══
- Balance: $${settings.balance}
- Risk per Trade: ${settings.riskPercent}%

Provide your complete analysis followed by the ---VERDICT--- block.`
        }
      ],
      temperature: 0.2,
      max_tokens: 1500
    };

    const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${keys.groq}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(prompt)
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Failed to communicate with Groq AI API');
    }

    const resData = await response.json();
    const rawResponse = resData.choices[0].message.content;

    return rawResponse;
  },

  // ═══════════════════════════════════════════════════════════════
  // 2. GEMINI 2.5 FLASH — Multi-Timeframe Visual Chart Analysis
  // ═══════════════════════════════════════════════════════════════

  async runVisualChartAnalysis(screenshots, currentSetupText) {
    const keys = store.get('apiKeys');
    if (!keys || !keys.gemini) {
      throw new Error('Gemini API Key is missing. Please configure it in Settings.');
    }

    // Build image parts for all available timeframe screenshots
    const tfLabels = { d1: 'DAILY', h1: '1-HOUR', m30: '30-MINUTE', m5: '5-MINUTE' };
    const imageParts = [];
    const availableTFs = [];

    for (const [key, label] of Object.entries(tfLabels)) {
      const img = screenshots[key];
      if (img) {
        const cleanBase64 = img.replace(/^data:image\/(png|jpeg);base64,/, "");
        imageParts.push({
          text: `\n--- ${label} CHART ---\nAnalyze this ${label} timeframe chart:`
        });
        imageParts.push({
          inlineData: {
            mimeType: "image/png",
            data: cleanBase64
          }
        });
        availableTFs.push(label);
      }
    }

    if (imageParts.length === 0) {
      throw new Error('No chart screenshots available for visual analysis');
    }

    const payload = {
      contents: [{
        parts: [
          {
            text: `You are an expert technical chart pattern analyst specializing in XAUUSD (Gold).
You are being shown ${availableTFs.length} chart screenshots across different timeframes: ${availableTFs.join(', ')}.

For EACH timeframe, analyze:
1. **Key Support/Resistance Zones**: Horizontal levels where price has clearly reacted (bounced, rejected, or consolidated)
2. **Chart Patterns**: Double Bottom/Tops, Head & Shoulders, Flags, Wedges, Triangles, Channels
3. **Candlestick Price Action**: Pin bars, engulfing candles, doji at key levels, rejection wicks
4. **Trend Structure**: Is price making Higher Highs/Higher Lows (uptrend) or Lower Highs/Lower Lows (downtrend)?

Then provide a CROSS-TIMEFRAME VERDICT:
- Does the DAILY chart structure support or conflict with the lower timeframe signals?
- Is price approaching a major level visible on the DAILY or HOURLY charts?
- Are lower timeframe patterns occurring at significant higher timeframe levels?

Current indicator setup for context:
${currentSetupText}

End your analysis with:
---VISUAL VERDICT---
PATTERN_CONFIDENCE: [0-100]
CONFIRMS_SIGNAL: [YES/NO/PARTIAL]
MAJOR_VISUAL_RISK: [one line describing the biggest visual threat]
RECOMMENDATION: [one line actionable recommendation]`
          },
          ...imageParts
        ]
      }],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 1500
      }
    };

    // Migrated to Gemini 2.5 Flash (2.0 Flash shuts down June 1, 2026)
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${keys.gemini}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Failed to communicate with Gemini Vision API');
    }

    const resData = await response.json();
    return resData.candidates[0].content.parts[0].text;
  },


  // ═══════════════════════════════════════════════════════════════
  // 3. AI VETO / CONFIDENCE PARSER
  // ═══════════════════════════════════════════════════════════════

  /**
   * Parses the structured verdict from AI responses.
   * Extracts confidence score, action, override reason, etc.
   */
  parseVerdict(rawText, verdictMarker = '---VERDICT---') {
    const result = {
      confidence: 50,
      action: 'WAIT',
      override: false,
      overrideReason: 'N/A',
      priceActionAlignment: 'NEUTRAL',
      keyRisk: '',
      watchFor: '',
      rawAnalysis: rawText
    };

    const idx = rawText.indexOf(verdictMarker);
    if (idx === -1) return result;

    const verdictBlock = rawText.substring(idx + verdictMarker.length);
    result.rawAnalysis = rawText.substring(0, idx).trim();

    // Parse each field
    const confMatch = verdictBlock.match(/CONFIDENCE:\s*(\d+)/i);
    if (confMatch) result.confidence = parseInt(confMatch[1]);

    const actionMatch = verdictBlock.match(/ACTION:\s*(STRONG BUY|BUY|WAIT|SELL|STRONG SELL)/i);
    if (actionMatch) result.action = actionMatch[1].toUpperCase();

    const overrideMatch = verdictBlock.match(/OVERRIDE:\s*(YES|NO)/i);
    if (overrideMatch) result.override = overrideMatch[1].toUpperCase() === 'YES';

    const overrideReasonMatch = verdictBlock.match(/OVERRIDE_REASON:\s*(.+)/i);
    if (overrideReasonMatch) result.overrideReason = overrideReasonMatch[1].trim();

    const paMatch = verdictBlock.match(/PRICE_ACTION_ALIGNMENT:\s*(CONFIRMS|NEUTRAL|CONTRADICTS)/i);
    if (paMatch) result.priceActionAlignment = paMatch[1].toUpperCase();

    const riskMatch = verdictBlock.match(/KEY_RISK:\s*(.+)/i);
    if (riskMatch) result.keyRisk = riskMatch[1].trim();

    const watchMatch = verdictBlock.match(/WATCH_FOR:\s*(.+)/i);
    if (watchMatch) result.watchFor = watchMatch[1].trim();

    return result;
  },

  /**
   * Parses the visual analysis verdict from Gemini.
   */
  parseVisualVerdict(rawText) {
    const result = {
      patternConfidence: 50,
      confirmsSignal: 'PARTIAL',
      majorVisualRisk: '',
      recommendation: '',
      rawAnalysis: rawText
    };

    const idx = rawText.indexOf('---VISUAL VERDICT---');
    if (idx === -1) return result;

    const verdictBlock = rawText.substring(idx + '---VISUAL VERDICT---'.length);
    result.rawAnalysis = rawText.substring(0, idx).trim();

    const confMatch = verdictBlock.match(/PATTERN_CONFIDENCE:\s*(\d+)/i);
    if (confMatch) result.patternConfidence = parseInt(confMatch[1]);

    const confirmMatch = verdictBlock.match(/CONFIRMS_SIGNAL:\s*(YES|NO|PARTIAL)/i);
    if (confirmMatch) result.confirmsSignal = confirmMatch[1].toUpperCase();

    const riskMatch = verdictBlock.match(/MAJOR_VISUAL_RISK:\s*(.+)/i);
    if (riskMatch) result.majorVisualRisk = riskMatch[1].trim();

    const recMatch = verdictBlock.match(/RECOMMENDATION:\s*(.+)/i);
    if (recMatch) result.recommendation = recMatch[1].trim();

    return result;
  }
};

export default aiAnalyzer;

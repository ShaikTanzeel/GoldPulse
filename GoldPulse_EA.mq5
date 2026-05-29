//+------------------------------------------------------------------+
//|                                                 GoldPulse_EA.mq5 |
//|        Enhanced with Price Action Filters & Multi-TF Context     |
//+------------------------------------------------------------------+
#property copyright "GoldPulse"
#property link      ""
#property version   "2.00"

#include <Trade\Trade.mqh>

input double InpLotSize = 0.01;
input int InpMagicNumber = 123456;
input int InpLookback = 30; // Divergence lookback

CTrade trade;

int ema21_handle;
int ema50_handle;
int ema200_handle;
int rsi_handle;
int macd_handle;
int atr_handle;

// Higher-timeframe handles for D1 trend filter
int d1_ema21_handle;
int d1_ema50_handle;

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
  {
   trade.SetExpertMagicNumber(InpMagicNumber);
   
   // Current timeframe indicators
   ema21_handle = iMA(_Symbol, _Period, 21, 0, MODE_EMA, PRICE_CLOSE);
   ema50_handle = iMA(_Symbol, _Period, 50, 0, MODE_EMA, PRICE_CLOSE);
   ema200_handle = iMA(_Symbol, _Period, 200, 0, MODE_EMA, PRICE_CLOSE);
   rsi_handle = iRSI(_Symbol, _Period, 14, PRICE_CLOSE);
   macd_handle = iMACD(_Symbol, _Period, 12, 26, 9, PRICE_CLOSE);
   atr_handle = iATR(_Symbol, _Period, 14);
   
   // Daily timeframe EMAs for higher-TF trend filter
   d1_ema21_handle = iMA(_Symbol, PERIOD_D1, 21, 0, MODE_EMA, PRICE_CLOSE);
   d1_ema50_handle = iMA(_Symbol, PERIOD_D1, 50, 0, MODE_EMA, PRICE_CLOSE);
   
   if(ema21_handle == INVALID_HANDLE || ema50_handle == INVALID_HANDLE || 
      ema200_handle == INVALID_HANDLE || rsi_handle == INVALID_HANDLE || 
      macd_handle == INVALID_HANDLE || atr_handle == INVALID_HANDLE ||
      d1_ema21_handle == INVALID_HANDLE || d1_ema50_handle == INVALID_HANDLE)
     {
      Print("Error creating indicator handles");
      return(INIT_FAILED);
     }
     
   return(INIT_SUCCEEDED);
  }

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
  {
   IndicatorRelease(ema21_handle);
   IndicatorRelease(ema50_handle);
   IndicatorRelease(ema200_handle);
   IndicatorRelease(rsi_handle);
   IndicatorRelease(macd_handle);
   IndicatorRelease(atr_handle);
   IndicatorRelease(d1_ema21_handle);
   IndicatorRelease(d1_ema50_handle);
  }

//+------------------------------------------------------------------+
//| Candlestick Pattern Detection                                    |
//+------------------------------------------------------------------+
enum CANDLE_PATTERN
{
   PATTERN_NONE = 0,
   PATTERN_PIN_BAR_BULL,
   PATTERN_PIN_BAR_BEAR,
   PATTERN_ENGULFING_BULL,
   PATTERN_ENGULFING_BEAR,
   PATTERN_DOJI,
   PATTERN_INSIDE_BAR
};

CANDLE_PATTERN DetectCandlePattern(int shift)
{
   double open1  = iOpen(_Symbol, _Period, shift);
   double high1  = iHigh(_Symbol, _Period, shift);
   double low1   = iLow(_Symbol, _Period, shift);
   double close1 = iClose(_Symbol, _Period, shift);
   
   double open2  = iOpen(_Symbol, _Period, shift + 1);
   double high2  = iHigh(_Symbol, _Period, shift + 1);
   double low2   = iLow(_Symbol, _Period, shift + 1);
   double close2 = iClose(_Symbol, _Period, shift + 1);
   
   double body1 = MathAbs(close1 - open1);
   double range1 = high1 - low1;
   double upperWick1 = high1 - MathMax(open1, close1);
   double lowerWick1 = MathMin(open1, close1) - low1;
   
   double body2 = MathAbs(close2 - open2);
   
   if(range1 < 0.01) return PATTERN_NONE;
   
   // Pin Bar Bullish (Hammer) — long lower wick, small body
   if(lowerWick1 >= body1 * 2 && upperWick1 < body1 * 0.5 && body1 > range1 * 0.05)
      return PATTERN_PIN_BAR_BULL;
   
   // Pin Bar Bearish (Shooting Star) — long upper wick, small body
   if(upperWick1 >= body1 * 2 && lowerWick1 < body1 * 0.5 && body1 > range1 * 0.05)
      return PATTERN_PIN_BAR_BEAR;
   
   // Bullish Engulfing
   if(body1 > body2 * 1.2 && body2 > 0.01 &&
      close1 > open1 && close2 < open2 &&
      MathMin(open1, close1) <= MathMin(open2, close2) &&
      MathMax(open1, close1) >= MathMax(open2, close2))
      return PATTERN_ENGULFING_BULL;
   
   // Bearish Engulfing
   if(body1 > body2 * 1.2 && body2 > 0.01 &&
      close1 < open1 && close2 > open2 &&
      MathMax(open1, close1) >= MathMax(open2, close2) &&
      MathMin(open1, close1) <= MathMin(open2, close2))
      return PATTERN_ENGULFING_BEAR;
   
   // Doji — body < 10% of range
   if(body1 < range1 * 0.1 && range1 > 0.5)
      return PATTERN_DOJI;
   
   // Inside Bar — current candle within previous range
   if(high1 < high2 && low1 > low2)
      return PATTERN_INSIDE_BAR;
   
   return PATTERN_NONE;
}

//+------------------------------------------------------------------+
//| Multi-TF Support/Resistance Proximity Check                      |
//| Checks if price is near a swing high/low on D1 or H1             |
//+------------------------------------------------------------------+
bool IsNearResistance(double price, double atr, int swingLookback = 20)
{
   // Check D1 swing highs and lows above price
   for(int i = 1; i <= swingLookback; i++)
   {
      double d1High = iHigh(_Symbol, PERIOD_D1, i);
      if(d1High > price && d1High - price <= atr * 0.5)
         return true;
         
      double d1Low = iLow(_Symbol, PERIOD_D1, i);
      if(d1Low > price && d1Low - price <= atr * 0.5)
         return true;
   }
   
   // Check H1 swing highs and lows above price
   for(int i = 2; i <= swingLookback * 3; i++)
   {
      double h1High = iHigh(_Symbol, PERIOD_H1, i);
      double prevH = iHigh(_Symbol, PERIOD_H1, i-1);
      double nextH = iHigh(_Symbol, PERIOD_H1, i+1);
      if(h1High > prevH && h1High > nextH) // Swing high
      {
         if(h1High > price && h1High - price <= atr * 0.5)
            return true;
      }
      
      double h1Low = iLow(_Symbol, PERIOD_H1, i);
      double prevL = iLow(_Symbol, PERIOD_H1, i-1);
      double nextL = iLow(_Symbol, PERIOD_H1, i+1);
      if(h1Low < prevL && h1Low < nextL) // Swing low
      {
         if(h1Low > price && h1Low - price <= atr * 0.5)
            return true;
      }
   }
   
   return false;
}

bool IsNearSupport(double price, double atr, int swingLookback = 20)
{
   // Check D1 swing highs and lows below price
   for(int i = 1; i <= swingLookback; i++)
   {
      double d1High = iHigh(_Symbol, PERIOD_D1, i);
      if(d1High < price && price - d1High <= atr * 0.5)
         return true;
         
      double d1Low = iLow(_Symbol, PERIOD_D1, i);
      if(d1Low < price && price - d1Low <= atr * 0.5)
         return true;
   }
   
   // Check H1 swing highs and lows below price
   for(int i = 2; i <= swingLookback * 3; i++)
   {
      double h1High = iHigh(_Symbol, PERIOD_H1, i);
      double prevH = iHigh(_Symbol, PERIOD_H1, i-1);
      double nextH = iHigh(_Symbol, PERIOD_H1, i+1);
      if(h1High > prevH && h1High > nextH) // Swing high
      {
         if(h1High < price && price - h1High <= atr * 0.5)
            return true;
      }
      
      double h1Low = iLow(_Symbol, PERIOD_H1, i);
      double prevL = iLow(_Symbol, PERIOD_H1, i-1);
      double nextL = iLow(_Symbol, PERIOD_H1, i+1);
      if(h1Low < prevL && h1Low < nextL) // Swing low
      {
         if(h1Low < price && price - h1Low <= atr * 0.5)
            return true;
      }
   }
   
   return false;
}

//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick()
  {
   // Execute on bar close only
   static datetime last_bar_time;
   datetime current_bar_time = (datetime)SeriesInfoInteger(_Symbol, _Period, SERIES_LASTBAR_DATE);
   if(last_bar_time == current_bar_time) return;
   
   // Data arrays
   double ema21[1], ema50[1], ema200[1];
   double atr[1];
   double macd_main[2], macd_signal[2];
   
   int count = InpLookback + 1;
   double rsi[];
   double close[];
   ArrayResize(rsi, count);
   ArrayResize(close, count);
   
   // Copy indicator data (Shift 1 means completed bar)
   if(CopyBuffer(ema21_handle, 0, 1, 1, ema21) <= 0) return;
   if(CopyBuffer(ema50_handle, 0, 1, 1, ema50) <= 0) return;
   if(CopyBuffer(ema200_handle, 0, 1, 1, ema200) <= 0) return;
   if(CopyBuffer(atr_handle, 0, 1, 1, atr) <= 0) return;
   if(CopyBuffer(macd_handle, 0, 1, 2, macd_main) <= 0) return;
   if(CopyBuffer(macd_handle, 1, 1, 2, macd_signal) <= 0) return;
   if(CopyBuffer(rsi_handle, 0, 1, count, rsi) <= 0) return;
   if(CopyClose(_Symbol, _Period, 1, count, close) <= 0) return;
   
   // Daily EMAs for higher-timeframe trend filter
   double d1Ema21[1], d1Ema50[1];
   if(CopyBuffer(d1_ema21_handle, 0, 0, 1, d1Ema21) <= 0) return;
   if(CopyBuffer(d1_ema50_handle, 0, 0, 1, d1Ema50) <= 0) return;
   
   // Set references
   double currEma21 = ema21[0];
   double currEma50 = ema50[0];
   double currEma200 = ema200[0];
   double currAtr = atr[0];
   
   double currHist = macd_main[1] - macd_signal[1];
   double prevHist = macd_main[0] - macd_signal[0];
   
   double currRsi = rsi[count - 1];
   double prevRsi = rsi[0];
   
   double currentPrice = close[count - 1];
   double pastPrice = close[0];
   
   double score = 0;
   
   // ═══════════════════════════════════════════════════════════
   // INDICATOR-BASED SCORING (same as before)
   // ═══════════════════════════════════════════════════════════
   
   // 1. Trend Factor
   string trendState = "NEUTRAL";
   if (currEma21 > currEma50 && currEma50 > currEma200) {
      score += 2.0;
      trendState = "BULLISH";
   } else if (currEma21 < currEma50 && currEma50 < currEma200) {
      score -= 2.0;
      trendState = "BEARISH";
   }
   
   // 2. Momentum Factor
   if (currRsi > 50.0) {
      score += 1.0;
   } else if (currRsi < 50.0) {
      score -= 1.0;
   }
   
   // 3. Trend Acceleration Factor
   if (currHist > 0) {
      score += 1.0;
      if (currHist > prevHist) score += 0.5;
   } else if (currHist < 0) {
      score -= 1.0;
      if (currHist < prevHist) score -= 0.5;
   }
   
   // 4. Pullback / Value Zone Detection
   if (trendState == "BULLISH") {
      if (currentPrice <= currEma21 && currentPrice >= currEma50) {
         score += 1.5;
      }
   } else if (trendState == "BEARISH") {
      if (currentPrice >= currEma21 && currentPrice <= currEma50) {
         score -= 1.5;
      }
   }
   
   // 5. Divergence Boost
   bool isLowerLowPrice = currentPrice < pastPrice;
   bool isHigherLowRsi = currRsi > prevRsi && currRsi < 35.0;
   if (isLowerLowPrice && isHigherLowRsi) {
      score += 2.0;
   }
   
   bool isHigherHighPrice = currentPrice > pastPrice;
   bool isLowerHighRsi = currRsi < prevRsi && currRsi > 65.0;
   if (isHigherHighPrice && isLowerHighRsi) {
      score -= 2.0;
   }
   
   // ═══════════════════════════════════════════════════════════
   // PRICE ACTION FILTERS (NEW)
   // ═══════════════════════════════════════════════════════════
   
   // 6a. S/R Proximity Gate — don't buy near resistance, don't sell near support
   if (score > 0 && IsNearResistance(currentPrice, currAtr)) {
      double penalty = 2.0;
      score -= penalty;
      Print("PA FILTER: Bullish score reduced by ", penalty, " — price near D1/H1 resistance");
   }
   
   if (score < 0 && IsNearSupport(currentPrice, currAtr)) {
      double penalty = 2.0;
      score += penalty;
      Print("PA FILTER: Bearish score reduced by ", penalty, " — price near D1/H1 support");
   }
   
   // 6b. Daily Trend Filter — don't go against D1 trend
   bool d1Bullish = d1Ema21[0] > d1Ema50[0];
   bool d1Bearish = d1Ema21[0] < d1Ema50[0];
   
   if (d1Bearish && score > 2.0) {
      score = MathMin(score, 2.0);
      Print("PA FILTER: D1 bearish — bullish score capped at 2.0");
   } else if (d1Bullish && score < -2.0) {
      score = MathMax(score, -2.0);
      Print("PA FILTER: D1 bullish — bearish score capped at -2.0");
   }
   
   // 6c. Candlestick Confirmation — boost score if candle confirms direction
   CANDLE_PATTERN pattern = DetectCandlePattern(1); // Check completed bar
   
   if (pattern == PATTERN_PIN_BAR_BULL && score > 0) {
      score += 0.5;
      Print("PA BOOST: Bullish pin bar confirms buy setup");
   } else if (pattern == PATTERN_PIN_BAR_BEAR && score < 0) {
      score -= 0.5;
      Print("PA BOOST: Bearish pin bar confirms sell setup");
   } else if (pattern == PATTERN_ENGULFING_BULL && score > 0) {
      score += 0.5;
      Print("PA BOOST: Bullish engulfing confirms buy setup");
   } else if (pattern == PATTERN_ENGULFING_BEAR && score < 0) {
      score -= 0.5;
      Print("PA BOOST: Bearish engulfing confirms sell setup");
   }
   
   // Warn if doji at key level
   if (pattern == PATTERN_DOJI) {
      Print("PA WARNING: Doji detected — indecision candle, be cautious");
   }
   
   // ═══════════════════════════════════════════════════════════
   // FINAL SIGNAL & EXECUTION
   // ═══════════════════════════════════════════════════════════
   
   string finalSignal = "WAIT";
   if (score >= 3.5) {
      finalSignal = "STRONG BUY";
   } else if (score >= 1.5) {
      finalSignal = "BUY";
   } else if (score <= -3.5) {
      finalSignal = "STRONG SELL";
   } else if (score <= -1.5) {
      finalSignal = "SELL";
   }
   
   Print("GoldPulse v2 | Score: ", score, " | Signal: ", finalSignal, 
         " | Trend: ", trendState, " | D1: ", d1Bullish ? "Bull" : (d1Bearish ? "Bear" : "Neutral"),
         " | Pattern: ", EnumToString(pattern));
   
   // Execution Logic
   if (PositionsTotal() > 0) return;
   
   if (finalSignal == "BUY" || finalSignal == "STRONG BUY") {
      double sl = currentPrice - (currAtr * 1.5);
      double tp = currentPrice + (currAtr * 3.0);
      
      sl = NormalizeDouble(sl, _Digits);
      tp = NormalizeDouble(tp, _Digits);
      
      double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      trade.Buy(InpLotSize, _Symbol, ask, sl, tp, "GoldPulse v2 Buy");
      last_bar_time = current_bar_time;
   } 
   else if (finalSignal == "SELL" || finalSignal == "STRONG SELL") {
      double sl = currentPrice + (currAtr * 1.5);
      double tp = currentPrice - (currAtr * 3.0);
      
      sl = NormalizeDouble(sl, _Digits);
      tp = NormalizeDouble(tp, _Digits);
      
      double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
      trade.Sell(InpLotSize, _Symbol, bid, sl, tp, "GoldPulse v2 Sell");
      last_bar_time = current_bar_time;
   }
  }
//+------------------------------------------------------------------+

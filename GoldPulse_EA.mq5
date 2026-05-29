//+------------------------------------------------------------------+
//|                                                 GoldPulse_EA.mq5 |
//|        Liquidity Sweep / Buy-the-Dip Long-Only Trading Robot      |
//+------------------------------------------------------------------+
#property copyright "GoldPulse"
#property link      ""
#property version   "3.00"

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

// Higher-timeframe handles for Daily (D1) filter
int d1_ema21_handle;
int d1_ema50_handle;

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
  {
   trade.SetMagicNumber(InpMagicNumber);
   
   // Current timeframe indicators (M5)
   ema21_handle = iMA(_Symbol, _Period, 21, 0, MODE_EMA, PRICE_CLOSE);
   ema50_handle = iMA(_Symbol, _Period, 50, 0, MODE_EMA, PRICE_CLOSE);
   ema200_handle = iMA(_Symbol, _Period, 200, 0, MODE_EMA, PRICE_CLOSE);
   rsi_handle = iRSI(_Symbol, _Period, 14, PRICE_CLOSE);
   macd_handle = iMACD(_Symbol, _Period, 12, 26, 9, PRICE_CLOSE);
   atr_handle = iATR(_Symbol, _Period, 14);
   
   // Daily timeframe EMAs for structural trend filter
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
//+------------------------------------------------------------------+
bool IsNearResistance(double price, double atr, int swingLookback = 20)
{
   for(int i = 1; i <= swingLookback; i++)
   {
      double d1High = iHigh(_Symbol, PERIOD_D1, i);
      if(d1High > price && d1High - price <= atr * 0.5)
         return true;
   }
   
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
   }
   return false;
}

//+------------------------------------------------------------------+
//| STRATEGY SETUP: Liquidity Sweep Detection (Entry: M5, Struct: H1) |
//+------------------------------------------------------------------+
bool DetectLiquiditySweep(double &sweepLevel, double &sweepLowPrice)
{
   if(_Period >= PERIOD_H1) return false;

   // 1. Scan H1 bars (completed index 2 to 40) to find structural swing lows
   double swingLows[10];
   int swingCount = 0;
   ArrayInitialize(swingLows, 0);

   for(int i = 2; i < 40 && swingCount < 10; i++)
   {
      double low  = iLow(_Symbol, PERIOD_H1, i);
      double prev = iLow(_Symbol, PERIOD_H1, i-1);
      double next = iLow(_Symbol, PERIOD_H1, i+1);
      double prev2 = iLow(_Symbol, PERIOD_H1, i-2);
      double next2 = iLow(_Symbol, PERIOD_H1, i+2);

      if(low < prev && low < next && low < prev2 && low < next2) // Strong swing low
      {
         swingLows[swingCount] = low;
         swingCount++;
      }
   }

   if(swingCount == 0) return false;

   // 2. Scan the last 5 completed M5 candles (shift 1 to 5) for sweep/trap activity
   double atr[1];
   if(CopyBuffer(atr_handle, 0, 1, 1, atr) <= 0) return false;
   double currAtr = atr[0];

   for(int i = 1; i <= 5; i++)
   {
      double m5Low   = iLow(_Symbol, _Period, i);
      double m5Close = iClose(_Symbol, _Period, i);

      for(int j = 0; j < swingCount; j++)
      {
         double level = swingLows[j];
         // Wick dipped below structural low
         if(m5Low < level)
         {
            double sweepDepth = level - m5Low;
            
            // Wick swept, but close returned back inside/above structural support
            bool closedAbove = m5Close > level;
            bool nextRecovered = false;
            
            // Check delayed recovery (next candle closed back above)
            if(!closedAbove && i > 1)
            {
               double prevClose = iClose(_Symbol, _Period, i-1);
               if(prevClose > level) nextRecovered = true;
            }

            // Exclude extreme breakdowns (sweeps deeper than 1.2 ATR are breakouts/legit drops)
            if((closedAbove || nextRecovered) && sweepDepth < currAtr * 1.2 && sweepDepth > 0)
            {
               sweepLevel = level;
               sweepLowPrice = m5Low;
               return true;
            }
         }
      }
   }
   return false;
}

//+------------------------------------------------------------------+
//| STRATEGY SETUP: Bullish Fair Value Gap (FVG) Detection            |
//+------------------------------------------------------------------+
bool DetectBullishFVG(double &fvgBottom, double &fvgTop)
{
   // Bullish FVG: Low of bar i > High of bar i+2
   for(int i = 1; i <= 10; i++)
   {
      double high2 = iHigh(_Symbol, _Period, i+2);
      double low0  = iLow(_Symbol, _Period, i);
      
      if(low0 > high2)
      {
         fvgBottom = high2;
         fvgTop = low0;
         
         // Verify price is approaching or currently inside the imbalance gap
         double bid = SymbolInfoDouble(_Symbol, SYMBOL_BID);
         if(bid <= fvgTop && bid >= fvgBottom - 1.5)
         {
            return true;
         }
      }
   }
   return false;
}

//+------------------------------------------------------------------+
//| STRATEGY SETUP: Breakout-Retest Detection                       |
//+------------------------------------------------------------------+
bool DetectBreakoutRetest(double &retestLevel)
{
   if(_Period >= PERIOD_H1) return false;

   // 1. Scan H1 bars for swing highs
   double swingHighs[5];
   int shCount = 0;
   ArrayInitialize(swingHighs, 0);

   for(int i = 2; i < 30 && shCount < 5; i++)
   {
      double high = iHigh(_Symbol, PERIOD_H1, i);
      double prev = iHigh(_Symbol, PERIOD_H1, i-1);
      double next = iHigh(_Symbol, PERIOD_H1, i+1);

      if(high > prev && high > next)
      {
         swingHighs[shCount] = high;
         shCount++;
      }
   }

   if(shCount == 0) return false;

   // 2. Check if a recent H1 candle broke above one of them
   double brokenHigh = 0;
   for(int i = 1; i <= 5; i++)
   {
      double h1Close = iClose(_Symbol, PERIOD_H1, i);
      double h1Open  = iOpen(_Symbol, PERIOD_H1, i);
      for(int j = 0; j < shCount; j++)
      {
         if(h1Close > swingHighs[j] && h1Open <= swingHighs[j])
         {
            brokenHigh = swingHighs[j];
            break;
         }
      }
      if(brokenHigh > 0) break;
   }

   if(brokenHigh == 0) return false;

   // 3. Check if any recent M5 candles touched the broken level
   for(int i = 1; i <= 10; i++)
   {
      double m5Low  = iLow(_Symbol, _Period, i);
      double m5High = iHigh(_Symbol, _Period, i);

      if(m5Low <= brokenHigh + 0.5 && m5High >= brokenHigh - 0.5)
      {
         retestLevel = brokenHigh;
         return true;
      }
   }
   return false;
}

//+------------------------------------------------------------------+
//| CONFIRMATION: Volume Spike Verification                          |
//+------------------------------------------------------------------+
bool CheckVolumeSpike(int shift, double &ratio)
{
   long volume[21];
   if(CopyTickVolume(_Symbol, _Period, shift, 21, volume) <= 0) return false;

   long targetVolume = volume[20];
   long sum = 0;
   for(int i = 0; i < 20; i++)
   {
      sum += volume[i];
   }
   
   double avg = (double)sum / 20.0;
   if(avg <= 0) return false;

   ratio = (double)targetVolume / avg;
   return (ratio >= 1.5);
}

//+------------------------------------------------------------------+
//| Expert tick function                                             |
//+------------------------------------------------------------------+
void OnTick()
  {
   // On Bar Close logic
   static datetime last_bar_time;
   datetime current_bar_time = (datetime)SeriesInfoInteger(_Symbol, _Period, SERIES_LASTBAR_DATE);
   if(last_bar_time == current_bar_time) return;
   
   // Copy indicator data
   double atr[1];
   double macd_main[2], macd_signal[2];
   double rsi[1];
   
   if(CopyBuffer(atr_handle, 0, 1, 1, atr) <= 0) return;
   if(CopyBuffer(macd_handle, 0, 1, 2, macd_main) <= 0) return;
   if(CopyBuffer(macd_handle, 1, 1, 2, macd_signal) <= 0) return;
   if(CopyBuffer(rsi_handle, 0, 1, 1, rsi) <= 0) return;
   
   double currAtr = atr[0];
   double currHist = macd_main[1] - macd_signal[1];
   double prevHist = macd_main[0] - macd_signal[0];
   double currRsi = rsi[0];
   
   double currentPrice = iClose(_Symbol, _Period, 1);
   
   double score = 0;
   string setupType = "NONE";
   double sweepLevel = 0, sweepLow = 0;
   double fvgBottom = 0, fvgTop = 0;
   double retestLevel = 0;
   
   // ═══════════════════════════════════════════════════════════
   // STEP 1: TIER 1 STRUCTURAL SETUP TRIGGERS
   // ═══════════════════════════════════════════════════════════
   
   if(DetectLiquiditySweep(sweepLevel, sweepLow))
   {
      score = 3.0;
      setupType = "SWEEP";
   }
   else if(DetectBullishFVG(fvgBottom, fvgTop))
   {
      score = 2.0;
      setupType = "FVG_FILL";
   }
   else if(DetectBreakoutRetest(retestLevel))
   {
      score = 2.0;
      setupType = "RETEST";
   }
   
   // 🔴 HARD GATE: Without structural triggers, we stand aside.
   if(score < 1.5)
   {
      return;
   }
   
   // ═══════════════════════════════════════════════════════════
   // STEP 2: TIER 2 CONFIRMATIONS
   // ═══════════════════════════════════════════════════════════
   
   // 1. Volume spike confirmation
   double volRatio = 1.0;
   if(CheckVolumeSpike(1, volRatio))
   {
      if(volRatio >= 2.0) score += 1.5;
      else score += 0.75;
   }
   
   // 2. Bullish Candlestick Pattern at structure
   CANDLE_PATTERN pattern = DetectCandlePattern(1);
   if(pattern == PATTERN_PIN_BAR_BULL || pattern == PATTERN_ENGULFING_BULL)
   {
      score += 1.0;
   }
   
   // 3. RSI Oversold
   if(currRsi < 35.0)
   {
      score += 1.0;
   }
   
   // 4. MACD Shift
   if(currHist > prevHist && prevHist < 0)
   {
      score += 0.5;
   }
   
   // ═══════════════════════════════════════════════════════════
   // STEP 3: TIER 3 FILTERS & PENALTIES
   // ═══════════════════════════════════════════════════════════
   
   // 1. Proximity to major resistance
   if(IsNearResistance(currentPrice, currAtr))
   {
      score -= 2.0;
   }
   
   // 2. Overbought RSI Protection
   if(currRsi > 70.0)
   {
      score -= 1.5;
   }
   
   // 3. Daily trend filter
   double d1Ema21[1], d1Ema50[1];
   if(CopyBuffer(d1_ema21_handle, 0, 0, 1, d1Ema21) > 0 && CopyBuffer(d1_ema50_handle, 0, 0, 1, d1Ema50) > 0)
   {
      bool d1Bearish = d1Ema21[0] < d1Ema50[0];
      if(d1Bearish && score > 2.0)
      {
         score = 2.0; // Cap score to prevent counter daily trend risk
      }
   }
   
   // ═══════════════════════════════════════════════════════════
   // VERDICT & EXECUTION (LONG-ONLY BUY ENGINE)
   // ═══════════════════════════════════════════════════════════
   
   string finalSignal = "WAIT";
   if(score >= 4.0) finalSignal = "STRONG BUY";
   else if(score >= 2.5) finalSignal = "BUY";
   
   Print("GoldPulse EA | Score: ", score, " | Verdict: ", finalSignal, " | Setup: ", setupType);
   
   // Check active positions (only one active position allowed at once)
   if(PositionsTotal() > 0) return;
   
   if(finalSignal == "BUY" || finalSignal == "STRONG BUY")
   {
      double sl = 0;
      double tp = 0;
      
      // Calculate structural stop loss
      if(setupType == "SWEEP")
      {
         sl = sweepLow - (currAtr * 0.5); // stop goes 0.5 ATR below sweep wick
      }
      else if(setupType == "RETEST")
      {
         sl = retestLevel - (currAtr * 0.5);
      }
      else
      {
         sl = currentPrice - (currAtr * 1.5);
      }
      
      // Calculate structural H1 resistance target
      double nearestH1Res = 0;
      for(int i = 2; i < 60; i++)
      {
         double high = iHigh(_Symbol, PERIOD_H1, i);
         double prevH = iHigh(_Symbol, PERIOD_H1, i-1);
         double nextH = iHigh(_Symbol, PERIOD_H1, i+1);
         if(high > prevH && high > nextH && high > currentPrice)
         {
            nearestH1Res = high;
            break;
         }
      }
      
      if(nearestH1Res > 0 && (nearestH1Res - currentPrice) > (currAtr * 2.0))
      {
         tp = nearestH1Res;
      }
      else
      {
         tp = currentPrice + (currAtr * 3.0); // standard 1:2 R:R fallback
      }
      
      sl = NormalizeDouble(sl, _Digits);
      tp = NormalizeDouble(tp, _Digits);
      
      double ask = SymbolInfoDouble(_Symbol, SYMBOL_ASK);
      trade.Buy(InpLotSize, _Symbol, ask, sl, tp, "GoldPulse Sweep Buy");
      last_bar_time = current_bar_time;
   }
  }
//+------------------------------------------------------------------+

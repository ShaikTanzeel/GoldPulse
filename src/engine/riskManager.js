/**
 * Capital Protection & Risk Management for GoldPulse
 * Custom calibrated for XM Global Ultra Low Standard Accounts ($50 context).
 */

// XM Global Ultra Low Standard Specifications for XAUUSD (Gold Spot)
export const XM_SPECS = {
  contractSize: 100, // 1 Standard Lot = 100 oz of gold
  minLot: 0.01,
  maxLot: 100,
  stepLot: 0.01,
  pipValuePer01Lot: 0.01, // 0.01 lots = $0.01 per 1-pip ($0.10 price movement) change
  tickSize: 0.01, // Gold is quoted to 2 decimals
  typicalSpread: 0.15 // ~15 pips typical ultra-low spread ($0.15 gold movement)
};

/**
 * Calculates correct position lot size ensuring strictly controlled risk amount
 * @param {number} balance - Account balance ($50 standard)
 * @param {number} riskPercent - Risk percentage (e.g. 2%)
 * @param {number} entry - Trade entry price
 * @param {number} sl - Stop loss price
 * @returns {object} - Lot size, dollar risk, and validation state
 */
export function calculatePositionSize(balance, riskPercent, entry, sl) {
  if (!entry || !sl || entry === sl) {
    return { lotSize: 0.01, riskAmount: 0, isValid: false, message: 'Invalid entry or stop loss' };
  }

  // Calculate the max dollar amount to risk
  const maxRiskDollar = balance * (riskPercent / 100);
  
  // Calculate price difference (Gold points/pips)
  // On gold: $1.00 move = 10 pips ($0.10 price tick = 1 pip)
  const priceDifference = Math.abs(entry - sl);
  const pipsDifference = priceDifference * 10;

  if (pipsDifference === 0) {
    return { lotSize: 0.01, riskAmount: 0, isValid: false, message: 'Invalid stop loss distance' };
  }

  // Risk per 0.01 lot = pipsDifference * XM_SPECS.pipValuePer01Lot
  const riskPer001Lot = pipsDifference * XM_SPECS.pipValuePer01Lot;
  
  // Calculated lot size
  let calculatedLot = (maxRiskDollar / riskPer001Lot) * 0.01;
  
  // Enforce broker limits
  calculatedLot = Math.max(XM_SPECS.minLot, calculatedLot);
  calculatedLot = Math.min(XM_SPECS.maxLot, calculatedLot);
  
  // Round to lot step (2 decimal places)
  calculatedLot = parseFloat(calculatedLot.toFixed(2));
  
  // Re-calculate actual dollar risk for the rounded lot size
  const actualRiskDollar = (calculatedLot / 0.01) * pipsDifference * XM_SPECS.pipValuePer01Lot;
  
  // Strict check: if actual risk exceeds 1.5x of target risk, flag it for user safety (highly important for $50 account)
  const isTooRisky = actualRiskDollar > maxRiskDollar * 1.5;
  const message = isTooRisky 
    ? `⚠️ WARNING: Stop loss is too wide for your $50 account. Minimum lot size (0.01) risks $${actualRiskDollar.toFixed(2)} (${((actualRiskDollar/balance)*100).toFixed(1)}%). Consider tightening SL.`
    : `Risk managed: risks $${actualRiskDollar.toFixed(2)} (${((actualRiskDollar/balance)*100).toFixed(1)}% of account).`;

  return {
    lotSize: calculatedLot,
    riskAmount: parseFloat(actualRiskDollar.toFixed(2)),
    pips: parseFloat(pipsDifference.toFixed(1)),
    isValid: !isTooRisky,
    message
  };
}

/**
 * Calculates standard Risk-Reward metrics for planned setups
 */
export function calculateRiskReward(entry, sl, tp, lotSize) {
  if (!entry || !sl || !tp) return null;
  
  const riskPrice = Math.abs(entry - sl);
  const rewardPrice = Math.abs(tp - entry);
  
  const rrRatio = riskPrice > 0 ? parseFloat((rewardPrice / riskPrice).toFixed(2)) : 0;
  
  // Convert price movement to pips
  const riskPips = riskPrice * 10;
  const rewardPips = rewardPrice * 10;
  
  // Calculate dollar metrics using standard XM specifications
  const dollarRisk = (lotSize / 0.01) * riskPips * XM_SPECS.pipValuePer01Lot;
  const dollarReward = (lotSize / 0.01) * rewardPips * XM_SPECS.pipValuePer01Lot;
  
  return {
    rrRatio,
    riskPips: parseFloat(riskPips.toFixed(1)),
    rewardPips: parseFloat(rewardPips.toFixed(1)),
    dollarRisk: parseFloat(dollarRisk.toFixed(2)),
    dollarReward: parseFloat(dollarReward.toFixed(2))
  };
}

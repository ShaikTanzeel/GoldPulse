import { createChart, CandlestickSeries, HistogramSeries, LineSeries } from 'lightweight-charts';

/**
 * Charting Module for GoldPulse
 * Renders rich TradingView Lightweight Candlestick and Indicator Charts.
 * Compatible with Lightweight Charts v5 API.
 */

export class GoldPulseChart {
  constructor(containerId) {
    this.container = document.getElementById(containerId);
    this.chart = null;
    this.candlestickSeries = null;
    this.volumeSeries = null;
    this.ema21Series = null;
    this.ema50Series = null;
    this.ema200Series = null;
    this.srSeriesList = []; // Track active S/R lines to clear/update

    this.initChart();
  }

  initChart() {
    if (!this.container) return;
    this.container.innerHTML = ''; // Clear container

    const chartOptions = {
      layout: {
        background: { type: 'solid', color: '#0b0c10' },
        textColor: '#a0aec0',
        fontSize: 12,
        fontFamily: "'JetBrains Mono', monospace",
      },
      grid: {
        vertLines: { color: 'rgba(212, 175, 55, 0.04)' },
        horzLines: { color: 'rgba(212, 175, 55, 0.04)' },
      },
      crosshair: {
        mode: 1, // Magnet mode
        vertLine: {
          color: '#d4af37',
          width: 1,
          style: 3, // Dotted
          labelBackgroundColor: '#aa7c11',
        },
        horzLine: {
          color: '#d4af37',
          width: 1,
          style: 3, // Dotted
          labelBackgroundColor: '#aa7c11',
        },
      },
      rightPriceScale: {
        borderColor: 'rgba(212, 175, 55, 0.15)',
        visible: true,
        autoScale: true,
      },
      timeScale: {
        borderColor: 'rgba(212, 175, 55, 0.15)',
        timeVisible: true,
        secondsVisible: false,
      },
      handleScale: {
        axisPressedMouseMove: true,
      },
      watermark: {
        visible: true,
        fontSize: 24,
        fontWeight: 'bold',
        color: 'rgba(212, 175, 55, 0.05)',
        text: 'GoldPulse XAUUSD',
      }
    };

    this.chart = createChart(this.container, chartOptions);

    // 1. Candlestick Series (v5 API: addSeries with named type)
    this.candlestickSeries = this.chart.addSeries(CandlestickSeries, {
      upColor: '#00e676',
      downColor: '#ff1744',
      borderVisible: false,
      wickUpColor: '#00e676',
      wickDownColor: '#ff1744',
    });

    // 2. Volume Series (overlaid at bottom 20%)
    this.volumeSeries = this.chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: {
        type: 'volume',
      },
      priceScaleId: '', // Overlay over chart
    });
    this.chart.priceScale('').applyOptions({
      scaleMargins: {
        top: 0.8, // Volume occupies bottom 20%
        bottom: 0,
      },
    });

    // 3. EMA indicator overlay lines
    this.ema21Series = this.chart.addSeries(LineSeries, {
      color: '#f3d060',   // Light Gold
      lineWidth: 1.5,
      title: 'EMA 21',
    });

    this.ema50Series = this.chart.addSeries(LineSeries, {
      color: '#aa7c11',   // Bronze
      lineWidth: 1.5,
      title: 'EMA 50',
    });

    this.ema200Series = this.chart.addSeries(LineSeries, {
      color: '#8a2be2',   // Deep Purple — institutional anchor
      lineWidth: 2,
      title: 'EMA 200',
    });

    // Auto-resize on container resize
    const resizeObserver = new ResizeObserver(entries => {
      if (entries.length === 0 || !entries[0]) return;
      const { width, height } = entries[0].contentRect;
      this.chart.resize(width, height);
    });
    resizeObserver.observe(this.container);
  }

  // Update candlesticks, volume, and EMA lines
  updateData(ohlcv, indicators) {
    if (!ohlcv || ohlcv.length === 0) return;

    this.ohlcvTimes = ohlcv.map(candle => candle.time);

    const formattedCandles = ohlcv.map(candle => ({
      time: candle.time,
      open: candle.open,
      high: candle.high,
      low: candle.low,
      close: candle.close,
    }));

    const formattedVolume = ohlcv.map(candle => ({
      time: candle.time,
      value: candle.volume,
      color: candle.close >= candle.open
        ? 'rgba(0, 230, 118, 0.2)'
        : 'rgba(255, 23, 68, 0.2)'
    }));

    this.candlestickSeries.setData(formattedCandles);
    this.volumeSeries.setData(formattedVolume);

    if (indicators) {
      const { ema21, ema50, ema200 } = indicators;
      if (ema21)  this.ema21Series.setData(ema21);
      if (ema50)  this.ema50Series.setData(ema50);
      if (ema200) this.ema200Series.setData(ema200);
    }
  }

  // Plot Support / Resistance horizontal lines
  drawSupportResistanceLevels(levels) {
    // Clear previous levels
    this.srSeriesList.forEach(line => {
      try { this.chart.removeSeries(line); } catch (e) { /* ignore */ }
    });
    this.srSeriesList = [];

    if (!levels || levels.length === 0) return;

    levels.forEach(level => {
      const lineSeries = this.chart.addSeries(LineSeries, {
        color: level.type === 'support'
          ? 'rgba(0, 230, 118, 0.35)'
          : 'rgba(255, 23, 68, 0.35)',
        lineWidth: 1,
        lineStyle: 2, // Dashed
        title: `${level.type.toUpperCase()} (S:${level.strength})`
      });

      // Span the line across the visible chart range using stored timestamps
      if (this.ohlcvTimes && this.ohlcvTimes.length > 0) {
        const firstTime = this.ohlcvTimes[0];
        const lastTime = this.ohlcvTimes[this.ohlcvTimes.length - 1];

        lineSeries.setData([
          { time: firstTime, value: level.price },
          { time: lastTime,  value: level.price }
        ]);
        this.srSeriesList.push(lineSeries);
      }
    });
  }

  // Add Buy/Sell markers on the candlestick chart
  setMarkers(markers) {
    if (this.candlestickSeries) {
      this.candlestickSeries.setMarkers(markers);
    }
  }

  // Capture chart canvas as PNG Base64 for visual AI review
  // Uses Lightweight Charts built-in takeScreenshot for proper layer compositing
  async captureScreenshot() {
    try {
      if (this.chart && typeof this.chart.takeScreenshot === 'function') {
        // Preferred: Lightweight Charts v5 built-in screenshot
        const canvas = this.chart.takeScreenshot();
        return canvas ? canvas.toDataURL('image/png') : null;
      }
      // Fallback: try to find the main rendering canvas (not the overlay/crosshair canvas)
      const canvases = this.container.querySelectorAll('canvas');
      if (canvases.length === 0) return null;
      // The main chart canvas is typically the largest one
      let mainCanvas = canvases[0];
      let maxArea = 0;
      canvases.forEach(c => {
        const area = c.width * c.height;
        if (area > maxArea) {
          maxArea = area;
          mainCanvas = c;
        }
      });
      return mainCanvas.toDataURL('image/png');
    } catch (err) {
      console.error('Screenshot capture failed:', err);
      return null;
    }
  }

  /**
   * Captures screenshots for multiple timeframes by rendering temporary off-screen charts.
   * Used for AI multi-timeframe visual analysis (D1, H1, M30, M5).
   * @param {object} mtfData - { d1: [...], h1: [...], m30: [...], m5: [...] } OHLCV arrays
   * @returns {object} { d1: base64, h1: base64, m30: base64, m5: base64 }
   */
  async captureMultiTimeframeScreenshots(mtfData) {
    const results = {};
    const tfLabels = { d1: 'Daily', h1: '1-Hour', m30: '30-Min', m5: '5-Min' };

    // Create a temporary off-screen container
    const tempContainer = document.createElement('div');
    tempContainer.style.cssText = 'position:absolute; left:-9999px; top:-9999px; width:800px; height:450px; visibility:hidden;';
    document.body.appendChild(tempContainer);

    for (const [tfKey, label] of Object.entries(tfLabels)) {
      const data = mtfData[tfKey];
      if (!data || data.length === 0) {
        results[tfKey] = null;
        continue;
      }

      try {
        // Create a temporary chart
        const tempChart = createChart(tempContainer, {
          width: 800,
          height: 450,
          layout: {
            background: { type: 'solid', color: '#0b0c10' },
            textColor: '#a0aec0',
            fontSize: 11,
            fontFamily: "'JetBrains Mono', monospace",
          },
          grid: {
            vertLines: { color: 'rgba(212, 175, 55, 0.04)' },
            horzLines: { color: 'rgba(212, 175, 55, 0.04)' },
          },
          rightPriceScale: { borderColor: 'rgba(212, 175, 55, 0.15)', visible: true },
          timeScale: { borderColor: 'rgba(212, 175, 55, 0.15)', timeVisible: true },
          watermark: {
            visible: true,
            fontSize: 20,
            fontWeight: 'bold',
            color: 'rgba(212, 175, 55, 0.08)',
            text: `XAUUSD ${label}`,
          }
        });

        // Add candlestick series
        const candleSeries = tempChart.addSeries(CandlestickSeries, {
          upColor: '#00e676',
          downColor: '#ff1744',
          borderVisible: false,
          wickUpColor: '#00e676',
          wickDownColor: '#ff1744',
        });

        candleSeries.setData(data.map(c => ({
          time: c.time,
          open: c.open,
          high: c.high,
          low: c.low,
          close: c.close
        })));

        // Fit content to view
        tempChart.timeScale().fitContent();

        // Allow rendering to complete
        await new Promise(resolve => setTimeout(resolve, 100));

        // Capture
        if (typeof tempChart.takeScreenshot === 'function') {
          const canvas = tempChart.takeScreenshot();
          results[tfKey] = canvas ? canvas.toDataURL('image/png') : null;
        } else {
          const canvas = tempContainer.querySelector('canvas');
          results[tfKey] = canvas ? canvas.toDataURL('image/png') : null;
        }

        // Clean up
        tempChart.remove();
        tempContainer.innerHTML = '';
      } catch (err) {
        console.error(`Failed to capture ${label} screenshot:`, err);
        results[tfKey] = null;
      }
    }

    // Remove temporary container
    document.body.removeChild(tempContainer);

    return results;
  }
}

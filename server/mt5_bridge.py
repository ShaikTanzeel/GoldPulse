import asyncio
import json
import logging
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
import MetaTrader5 as mt5

# Logging setup
logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("MT5Bridge")

app = FastAPI(title="GoldPulse MT5 Bridge", description="Local server bridging MetaTrader 5 terminal data to GoldPulse dashboard")

# Allow CORS for development proxying
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Active WebSocket subscribers list
websocket_clients = set()

# Resolved gold symbol (detected at startup from broker)
GOLD_SYMBOL = "XAUUSD"  # default fallback, will be overridden at startup

# Map timeframe in minutes to MT5 constants
TIMEFRAME_MAP = {
    1: mt5.TIMEFRAME_M1,
    5: mt5.TIMEFRAME_M5,
    15: mt5.TIMEFRAME_M15,
    30: mt5.TIMEFRAME_M30,
    60: mt5.TIMEFRAME_H1,
    240: mt5.TIMEFRAME_H4,
    1440: mt5.TIMEFRAME_D1,
}

# Multi-timeframe config for price action analysis
MTF_CONFIG = {
    "d1":  {"tf": mt5.TIMEFRAME_D1,  "count": 60,  "label": "Daily"},
    "h1":  {"tf": mt5.TIMEFRAME_H1,  "count": 100, "label": "1-Hour"},
    "m30": {"tf": mt5.TIMEFRAME_M30, "count": 120, "label": "30-Min"},
    "m5":  {"tf": mt5.TIMEFRAME_M5,  "count": 100, "label": "5-Min"},
}

def find_gold_symbol() -> str:
    """
    Scan MT5 symbols to find the correct gold/XAUUSD symbol for this broker.
    XM Global uses 'GOLD.i#' instead of 'XAUUSD'.
    Priority: exact XAUUSD > contains XAUUSD > GOLD.i# > any GOLD symbol
    """
    symbols = mt5.symbols_get()
    if not symbols:
        return "XAUUSD"
    
    # Priority 1: exact XAUUSD
    for s in symbols:
        if s.name == "XAUUSD":
            return s.name
    
    # Priority 2: contains XAUUSD (e.g. XAUUSDm, XAUUSD.r)
    for s in symbols:
        if "XAUUSD" in s.name.upper():
            return s.name
    
    # Priority 3: GOLD.i# style (XM Global)
    for s in symbols:
        if s.name.upper().startswith("GOLD.") or s.name == "GOLD":
            return s.name
    
    # Priority 4: any symbol with GOLD in name that is a forex-like instrument
    for s in symbols:
        nm = s.name.upper()
        if nm.startswith("GOLD") and len(s.name) < 12:  # avoid stocks like 'GoldenOcean'
            return s.name
    
    return "XAUUSD"  # fallback

@app.on_event("startup")
def startup_event():
    global GOLD_SYMBOL
    logger.info("Initializing connection to MetaTrader 5 Terminal...")
    if not mt5.initialize():
        logger.error(f"MT5 terminal initialization failed! Error code: {mt5.last_error()}")
        print("\n" + "="*80)
        print("\u26a0\ufe0f  META TRADER 5 INITIALIZATION FAILED!")
        print("Please ensure:")
        print("1. MetaTrader 5 terminal is installed and currently running on this PC.")
        print("2. You have logged into your XM Global brokerage account on the terminal.")
        print("="*80 + "\n")
    else:
        logger.info("Connected to MT5 terminal successfully!")
        acc_info = mt5.account_info()
        if acc_info:
            logger.info(f"Connected Broker: {acc_info.company} | Account: {acc_info.login} | Balance: {acc_info.balance} {acc_info.currency}")
        
        # Auto-detect the correct gold symbol for this broker
        GOLD_SYMBOL = find_gold_symbol()
        logger.info(f"Gold symbol resolved to: {GOLD_SYMBOL}")
        
        # Select the symbol so MT5 enables its data feed
        if not mt5.symbol_select(GOLD_SYMBOL, True):
            logger.warning(f"Could not select symbol {GOLD_SYMBOL} in Market Watch. Tick data may be unavailable.")
        else:
            logger.info(f"Symbol {GOLD_SYMBOL} selected and active in Market Watch.")

@app.on_event("shutdown")
def shutdown_event():
    logger.info("Shutting down MT5 Bridge...")
    mt5.shutdown()

@app.get("/api/status")
def get_status():
    # MT5 stays initialized from startup — just check terminal_info
    term_info = mt5.terminal_info()
    acc_info = mt5.account_info()
    connected = term_info is not None and acc_info is not None
    return {
        "status": "connected" if connected else "disconnected",
        "broker": acc_info.company if acc_info else None,
        "account": acc_info.login if acc_info else None,
        "balance": acc_info.balance if acc_info else 0.0,
        "currency": acc_info.currency if acc_info else "USD",
        "gold_symbol": GOLD_SYMBOL
    }

@app.get("/api/history")
def get_history(
    timeframe: int = Query(15, description="Timeframe in minutes (1, 5, 15, 30, 60, 240, 1440)"),
    count: int = Query(300, description="Number of historical candles to retrieve")
):
    """
    Retrieve historical OHLCV data from MT5 for gold (GOLD.i# on XM Global).
    """
    if mt5.terminal_info() is None:
        return {"error": "MT5 terminal not connected. Is MetaTrader 5 running?"}

    mt5_tf = TIMEFRAME_MAP.get(timeframe, mt5.TIMEFRAME_M15)
    
    # Ensure symbol is selected in Market Watch
    mt5.symbol_select(GOLD_SYMBOL, True)
    
    rates = mt5.copy_rates_from_pos(GOLD_SYMBOL, mt5_tf, 0, count)

    if rates is None or len(rates) == 0:
        return {"error": f"Failed to retrieve rates for {GOLD_SYMBOL}. MT5 error: {mt5.last_error()}. Ensure the symbol is visible in Market Watch."}

    # Format into frontend chart representation
    formatted_rates = [
        {
            "time": int(rate['time']),
            "open": float(rate['open']),
            "high": float(rate['high']),
            "low": float(rate['low']),
            "close": float(rate['close']),
            "volume": int(rate['tick_volume'])
        }
        for rate in rates
    ]
        
    return formatted_rates

@app.get("/api/multi-timeframe")
def get_multi_timeframe():
    """
    Retrieve OHLCV data for D1, H1, M30, M5 in a single consolidated response.
    Used by the frontend price action engine and AI multi-timeframe analysis.
    """
    if mt5.terminal_info() is None:
        return {"error": "MT5 terminal not connected. Is MetaTrader 5 running?"}

    mt5.symbol_select(GOLD_SYMBOL, True)
    result = {}

    for key, config in MTF_CONFIG.items():
        rates = mt5.copy_rates_from_pos(GOLD_SYMBOL, config["tf"], 0, config["count"])
        if rates is not None and len(rates) > 0:
            result[key] = [
                {
                    "time": int(rate['time']),
                    "open": float(rate['open']),
                    "high": float(rate['high']),
                    "low": float(rate['low']),
                    "close": float(rate['close']),
                    "volume": int(rate['tick_volume'])
                }
                for rate in rates
            ]
        else:
            logger.warning(f"No data for {config['label']} ({key}). MT5 error: {mt5.last_error()}")
            result[key] = []

    return result

@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await websocket.accept()
    websocket_clients.add(websocket)
    logger.info(f"New client connected to live tick WebSocket. Total clients: {len(websocket_clients)}")
    
    try:
        while True:
            # Keep socket alive (waiting for any client messages or pings)
            await websocket.receive_text()
    except WebSocketDisconnect:
        websocket_clients.remove(websocket)
        logger.info(f"Client disconnected. Total clients: {len(websocket_clients)}")

# Background task to poll prices from MT5 and stream to WebSockets
async def poll_mt5_prices():
    """
    Background loop that fetches live quotes from MetaTrader 5 and broadcasts
    to active frontend WebSockets. Uses the globally resolved GOLD_SYMBOL.
    """
    logger.info(f"Starting live market poll background worker for symbol: {GOLD_SYMBOL}")
    
    while True:
        try:
            if len(websocket_clients) > 0 and mt5.terminal_info() is not None:
                tick = mt5.symbol_info_tick(GOLD_SYMBOL)
                
                if tick:
                    price = (tick.bid + tick.ask) / 2
                    spread = abs(tick.ask - tick.bid)
                    
                    payload = {
                        "type": "tick",
                        "symbol": GOLD_SYMBOL,
                        "price": round(float(price), 2),
                        "bid": round(float(tick.bid), 2),
                        "ask": round(float(tick.ask), 2),
                        "spread": round(float(spread), 2),
                        "time": int(tick.time)
                    }
                    
                    # Broadcast to all connected WebSocket clients
                    dead_sockets = []
                    for client in list(websocket_clients):
                        try:
                            await client.send_text(json.dumps(payload))
                        except Exception:
                            dead_sockets.append(client)
                    
                    # Clean up dead connections
                    for dead in dead_sockets:
                        websocket_clients.discard(dead)
                else:
                    logger.warning(f"No tick data for {GOLD_SYMBOL}. MT5 error: {mt5.last_error()}")
        except Exception as e:
            logger.error(f"Polling error: {e}")
        
        # Poll every 200ms — smooth UI without hammering MT5
        await asyncio.sleep(0.2)

# Run background polling loop alongside FastAPI
@app.on_event("startup")
async def start_polling():
    asyncio.create_task(poll_mt5_prices())

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("mt5_bridge:app", host="0.0.0.0", port=8765, reload=True)

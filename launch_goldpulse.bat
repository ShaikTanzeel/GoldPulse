@echo off
title GoldPulse Algorithmic Command Center Launcher
color 0A

echo =======================================================================
echo          G O L D P U L S E   |   A L G O R I T H M I C   L A U N C H E R
echo =======================================================================
echo.
echo [1/3] Starting MT5 Python Bridge Server...
echo --------------------------------------------------
:: Start the MT5 Bridge in a minimized or separate window to keep logs clean
start "GoldPulse - MT5 Python Bridge" /min cmd /c "cd /d "%~dp0server" && .venv\Scripts\activate && python mt5_bridge.py"
echo [SUCCESS] Python server launched in background.
echo (FastAPI will automatically attempt to initialize and open MetaTrader 5)
echo.

echo [2/3] Starting Frontend Development Server...
echo --------------------------------------------------
:: Start the Vite server in the current window to show hot-reload and build status
echo Frontend server is starting on http://localhost:3000...
echo.
echo [SUCCESS] Vite server initializing. Keep this window open!
echo --------------------------------------------------
echo.

:: Open browser automatically after a tiny delay
timeout /t 2 >nul
start http://localhost:3000

:: Run Vite
npm run dev

pause

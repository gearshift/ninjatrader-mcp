# Read-only NinjaTrader bridge handoff

The Node server and local configuration are prepared. The remaining NinjaTrader-side copy and compile are intentionally human-owned because this terminal is running live strategies.

## Safety boundary already verified

- `npm audit`: 0 vulnerabilities.
- MCP surface verifier: 23 tools, zero order-write tools.
- TypeScript registration returns false for every write capability regardless of `NT_TRADING_*`.
- The C# AddOn advertises zero write capabilities and rejects `place_order`, `place_oco`, `change_order`, `cancel_order`, `cancel_all`, and `flatten` before any account API call.
- `deployment-registry.json` is observational metadata only and is gitignored.

## Prepared local files

- Server checkout: `C:\Users\jon\ninjatrader-mcp`
- AddOn source: `C:\Users\jon\ninjatrader-mcp\ninja-addon\addons\mcp-bridge.cs`
- AddOn SHA-256: `dc81fd14a117072e268d5ffbbedae3aec22712d40024014bfa8859a70530fcfd`
- Bridge config already written: `C:\Users\jon\Documents\NinjaTrader 8\bridge.config.json`
- Local registry already written: `C:\Users\jon\ninjatrader-mcp\deployment-registry.json`

## Human-owned NinjaTrader steps

Perform these while the currently running strategies are flat and synchronized:

1. Copy only `ninja-addon\addons\mcp-bridge.cs` into:
   `C:\Users\jon\Documents\NinjaTrader 8\bin\Custom\AddOns\`
2. Open **New → NinjaScript Editor**.
3. Press **F5** to compile.
4. Confirm the compile grid has zero errors.
5. Open **New → NinjaScript Output**, Tab 1.
6. From `C:\Users\jon\ninjatrader-mcp`, start exactly one server:
   `node scripts\mcp-entry.mjs`
7. Confirm Output Tab 1 shows:
   - connection to `ws://127.0.0.1:9472`
   - `sent hello (..., 0 caps)`
   - `hello_ack`
8. Re-check the Control Center Strategies grid:
   - both operational strategies remain enabled
   - `Sync=True`
   - strategy position equals account position
   - legacy demo rows remain disabled

The renderer is optional and is not needed for accounts, positions, orders, executions, connection health, or the deployment registry. Do not copy it unless chart drawing is desired later.

## Post-compile verification

Run:

```powershell
cd C:\Users\jon\ninjatrader-mcp
npm run verify:read-only-surface
```

Then query `get_positions` and `get_deployment_registry`. A connection mismatch or missing registry account is advisory only; it never changes NinjaTrader state.

## Rollback

If NinjaTrader reports a compile error or either operational strategy changes state unexpectedly:

1. Do not disable, re-enable, cancel, or flatten anything reflexively.
2. Stop the Node bridge server.
3. Remove only the newly copied `McpBridge` AddOn source.
4. Compile again.
5. Verify the operational strategy and account state before any further action.

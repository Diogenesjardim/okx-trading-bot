import type { StrategyConfig } from '../types';
import { NumberField, Segmented, Toggle } from './ui';

export function validateStrategy(c: StrategyConfig): string[] {
  const e: string[] = [];
  const ok = (v: number, min: number, max: number) => Number.isFinite(v) && v >= min && v <= max;
  if (!ok(c.stopLossPct, 0.1, 50)) e.push('Stop Loss deve estar entre 0,1% e 50%.');
  if (!ok(c.takeProfitPct, 0.1, 200)) e.push('Take Profit deve estar entre 0,1% e 200%.');
  if (!ok(c.positionSizePct, 1, 100)) e.push('Tamanho da posição deve estar entre 1% e 100% do saldo.');
  if (!ok(c.feePct, 0, 1)) e.push('Taxa deve estar entre 0% e 1%.');
  if (!ok(c.slippagePct, 0, 2)) e.push('Slippage deve estar entre 0% e 2%.');
  return e;
}

export function StrategyFields({ value, onChange, disabled, hideRsi }: {
  value: StrategyConfig; onChange: (v: StrategyConfig) => void; disabled?: boolean; hideRsi?: boolean;
}) {
  const set = <K extends keyof StrategyConfig>(k: K, v: StrategyConfig[K]) => onChange({ ...value, [k]: v });
  const lossOnMargin = value.stopLossPct * value.leverage;
  return (
    <div className="space-y-3">
      <Toggle
        label="Somente LONG (mercado à vista)"
        hint="Como na OKX Brasil: só compra, sem alavancagem. Sinal de venda apenas encerra a compra."
        checked={!!value.longOnly}
        onChange={(v) => onChange({ ...value, longOnly: v, leverage: v ? 1 : value.leverage })}
        disabled={disabled}
      />
      <div>
        <span className="text-xs text-zinc-400">Alavancagem fictícia{value.longOnly ? ' (à vista = 1X)' : ''}</span>
        <div className="mt-1">
          <Segmented
            disabled={disabled || !!value.longOnly}
            options={[{ id: 1, label: '1X' }, { id: 2, label: '2X' }, { id: 3, label: '3X' }]}
            value={value.leverage}
            onChange={(v) => set('leverage', v as 1 | 2 | 3)}
          />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-3">
        <NumberField label="Stop Loss" suffix="%" value={value.stopLossPct} onChange={(v) => set('stopLossPct', v)} disabled={disabled}
          hint={Number.isFinite(lossOnMargin) ? `≈ ${lossOnMargin.toFixed(1)}% da margem` : undefined} />
        <NumberField label="Take Profit" suffix="%" value={value.takeProfitPct} onChange={(v) => set('takeProfitPct', v)} disabled={disabled}
          hint={Number.isFinite(value.takeProfitPct * value.leverage) ? `≈ ${(value.takeProfitPct * value.leverage).toFixed(1)}% da margem` : undefined} />
        <NumberField label="Tamanho da posição" suffix="% saldo" step={5} value={value.positionSizePct} onChange={(v) => set('positionSizePct', v)} disabled={disabled} />
        <NumberField label="Taxa por execução" suffix="%" step={0.01} value={value.feePct} onChange={(v) => set('feePct', v)} disabled={disabled} hint="OKX taker ≈ 0,05%" />
        <NumberField label="Slippage" suffix="%" step={0.01} value={value.slippagePct} onChange={(v) => set('slippagePct', v)} disabled={disabled} />
      </div>
      {!hideRsi && <Toggle label="Filtro RSI" hint="Não compra com RSI ≥ 70 nem vende com RSI ≤ 30" checked={value.rsiFilter} onChange={(v) => set('rsiFilter', v)} disabled={disabled} />}
      {!hideRsi && (
        <Toggle
          label={`Filtro de tendência (SMA${value.trendPeriod ?? 200})`}
          hint="LONG só com preço acima da média longa; SHORT só abaixo. Reduz operações contra a tendência."
          checked={!!value.trendFilter}
          onChange={(v) => onChange({ ...value, trendFilter: v, trendPeriod: value.trendPeriod ?? 200 })}
          disabled={disabled}
        />
      )}
      {!hideRsi && value.trendFilter && (
        <div>
          <span className="text-xs text-zinc-400">Período da média longa</span>
          <div className="mt-1">
            <Segmented disabled={disabled} options={[{ id: 50, label: 'SMA50' }, { id: 100, label: 'SMA100' }, { id: 200, label: 'SMA200' }]} value={value.trendPeriod ?? 200} onChange={(v) => onChange({ ...value, trendPeriod: v })} />
          </div>
        </div>
      )}
      <Toggle label="Sair no cruzamento oposto" hint="Encerra a posição quando as médias cruzam no sentido contrário" checked={value.exitOnOppositeCross} onChange={(v) => set('exitOnOppositeCross', v)} disabled={disabled} />
    </div>
  );
}

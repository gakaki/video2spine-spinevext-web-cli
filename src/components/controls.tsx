/**
 * 复用的表单片段。集中在这里，避免各个面板重复写同样的标签/滑块结构。
 */

import type { ReactNode } from "react";

import { Label } from "@/components/ui/label";
import { Slider } from "@/components/ui/slider";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

export interface SliderFieldProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  /** 数值后缀，例如 ` 帧/秒`。 */
  suffix?: string;
  /** 数值显示的小数位。 */
  digits?: number;
  hint?: string;
  disabled?: boolean;
  onChange: (value: number) => void;
}

export function SliderField({
  label,
  value,
  min,
  max,
  step,
  suffix = "",
  digits = 0,
  hint,
  disabled,
  onChange,
}: SliderFieldProps) {
  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between gap-3">
        <Label className="tag-label">{label}</Label>
        <span className="numeral text-xs text-foreground">
          {value.toFixed(digits)}
          {suffix}
        </span>
      </div>
      <Slider
        value={value}
        min={min}
        max={max}
        step={step}
        disabled={disabled}
        onValueChange={(next) => {
          const resolved = Array.isArray(next) ? next[0] : next;
          if (typeof resolved === "number") onChange(resolved);
        }}
      />
      {hint ? <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export interface ToggleFieldProps {
  label: string;
  checked: boolean;
  hint?: string;
  disabled?: boolean;
  onChange: (checked: boolean) => void;
}

export function ToggleField({ label, checked, hint, disabled, onChange }: ToggleFieldProps) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div className="space-y-1">
        <Label className="tag-label">{label}</Label>
        {hint ? <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p> : null}
      </div>
      <Switch
        checked={checked}
        disabled={disabled}
        onCheckedChange={(next) => onChange(Boolean(next))}
      />
    </div>
  );
}

export interface SegmentedOption<T extends string | number> {
  value: T;
  label: string;
}

export interface SegmentedProps<T extends string | number> {
  label: string;
  value: T;
  options: ReadonlyArray<SegmentedOption<T>>;
  hint?: string;
  disabled?: boolean;
  onChange: (value: T) => void;
}

export function Segmented<T extends string | number>({
  label,
  value,
  options,
  hint,
  disabled,
  onChange,
}: SegmentedProps<T>) {
  return (
    <div className="space-y-2">
      <Label className="tag-label">{label}</Label>
      <div className="flex gap-1 rounded-md border border-border bg-muted/40 p-1">
        {options.map((option) => {
          const active = option.value === value;
          return (
            <button
              key={String(option.value)}
              type="button"
              disabled={disabled}
              onClick={() => onChange(option.value)}
              className={cn(
                "numeral flex-1 rounded-sm px-2 py-1 text-[11px] transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-secondary hover:text-foreground",
                disabled && "cursor-not-allowed opacity-50",
              )}
            >
              {option.label}
            </button>
          );
        })}
      </div>
      {hint ? <p className="text-[11px] leading-relaxed text-muted-foreground">{hint}</p> : null}
    </div>
  );
}

export interface ReadoutProps {
  label: string;
  value: ReactNode;
}

export function Readout({ label, value }: ReadoutProps) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-dashed border-border/70 pb-1.5 last:border-none">
      <span className="tag-label">{label}</span>
      <span className="numeral text-xs text-foreground">{value}</span>
    </div>
  );
}

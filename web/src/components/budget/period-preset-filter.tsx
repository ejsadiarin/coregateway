
import { useState, useCallback } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { X } from 'lucide-react';

export type PresetKey = '7d' | '30d' | '90d' | 'this-week' | 'this-month' | 'this-year' | 'custom' | null;

export interface PeriodPresetFilterValue {
  startDate: string;
  endDate: string;
  preset: PresetKey;
}

interface PeriodPresetFilterProps {
  value: PeriodPresetFilterValue;
  onChange: (value: PeriodPresetFilterValue) => void;
  className?: string;
}

function formatDate(d: Date): string {
  return d.toISOString().split('T')[0];
}

function computePresetDates(preset: PresetKey): { startDate: string; endDate: string } {
  const today = new Date();
  const endDate = formatDate(today);

  switch (preset) {
    case '7d': {
      const start = new Date(today);
      start.setDate(start.getDate() - 6);
      return { startDate: formatDate(start), endDate };
    }
    case '30d': {
      const start = new Date(today);
      start.setDate(start.getDate() - 29);
      return { startDate: formatDate(start), endDate };
    }
    case '90d': {
      const start = new Date(today);
      start.setDate(start.getDate() - 89);
      return { startDate: formatDate(start), endDate };
    }
    case 'this-week': {
      const start = new Date(today);
      start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
      return { startDate: formatDate(start), endDate };
    }
    case 'this-month': {
      const start = new Date(today.getFullYear(), today.getMonth(), 1);
      return { startDate: formatDate(start), endDate };
    }
    case 'this-year': {
      const start = new Date(today.getFullYear(), 0, 1);
      return { startDate: formatDate(start), endDate };
    }
    default:
      return { startDate: '', endDate: '' };
  }
}

const presets: { key: PresetKey; label: string }[] = [
  { key: '7d', label: '7D' },
  { key: '30d', label: '30D' },
  { key: '90d', label: '90D' },
  { key: 'this-week', label: 'This Week' },
  { key: 'this-month', label: 'This Month' },
  { key: 'this-year', label: 'This Year' },
];

export function PeriodPresetFilter({ value, onChange, className }: PeriodPresetFilterProps) {
  const [showCustom, setShowCustom] = useState(value.preset === 'custom');

  const handlePresetClick = useCallback((preset: PresetKey) => {
    const { startDate, endDate } = computePresetDates(preset);
    setShowCustom(false);
    onChange({ startDate, endDate, preset });
  }, [onChange]);

  const handleCustomToggle = useCallback(() => {
    setShowCustom(true);
    onChange({ startDate: value.startDate, endDate: value.endDate, preset: 'custom' });
  }, [onChange, value.startDate, value.endDate]);

  const handleClear = useCallback(() => {
    setShowCustom(false);
    onChange({ startDate: '', endDate: '', preset: null });
  }, [onChange]);

  const handleCustomDateChange = useCallback((field: 'startDate' | 'endDate', dateValue: string) => {
    onChange({
      ...value,
      [field]: dateValue,
      preset: 'custom'
    });
  }, [onChange, value]);

  const isActive = value.preset !== null;

  return (
    <div className={`flex flex-wrap items-center gap-2 ${className || ''}`}>
      <span className="text-sm text-muted-foreground shrink-0">Period:</span>
      {presets.map((p) => (
        <Button
          key={p.key}
          variant={value.preset === p.key ? 'default' : 'outline'}
          size="sm"
          className="h-7 px-2.5 text-xs"
          onClick={() => handlePresetClick(p.key)}
        >
          {p.label}
        </Button>
      ))}
      <Button
        variant={value.preset === 'custom' ? 'default' : 'outline'}
        size="sm"
        className="h-7 px-2.5 text-xs"
        onClick={handleCustomToggle}
      >
        Custom
      </Button>

      {showCustom && (
        <div className="flex items-center gap-1.5">
          <Input
            type="date"
            value={value.startDate}
            onChange={(e) => handleCustomDateChange('startDate', e.target.value)}
            className="w-36 h-7 text-xs"
          />
          <span className="text-xs text-muted-foreground">to</span>
          <Input
            type="date"
            value={value.endDate}
            onChange={(e) => handleCustomDateChange('endDate', e.target.value)}
            className="w-36 h-7 text-xs"
          />
        </div>
      )}

      {isActive && (
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-1.5"
          onClick={handleClear}
        >
          <X className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

import { formatDate, formatDateTime } from '../lib/format';

const iconProps = {
  width: 15,
  height: 15,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
  focusable: false,
} as const;

function CalendarIcon() {
  return (
    <svg {...iconProps}>
      <rect x="3" y="4.5" width="18" height="16.5" rx="2.5" />
      <path d="M3 9.5h18M8 2.5v4M16 2.5v4" />
    </svg>
  );
}

function ClockIcon() {
  return (
    <svg {...iconProps}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7.5V12l3 2" />
    </svg>
  );
}

interface DateChipProps {
  iso: string;
  /** Calendar for "when something was added"; clock for precise note timestamps. */
  icon?: 'calendar' | 'clock';
  withTime?: boolean;
  prefix?: string;
}

export function DateChip({ iso, icon = 'calendar', withTime = false, prefix }: DateChipProps) {
  return (
    <span className={`chip chip--${icon}`}>
      {icon === 'clock' ? <ClockIcon /> : <CalendarIcon />}
      <span>
        {prefix && `${prefix} `}
        <time dateTime={iso} title={formatDateTime(iso)}>
          {withTime ? formatDateTime(iso) : formatDate(iso)}
        </time>
      </span>
    </span>
  );
}

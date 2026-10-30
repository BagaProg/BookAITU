import { useId } from 'react'
import { ChevronDown } from 'lucide-react'
import { cx } from './ui.jsx'

// Native <select> with the custom look from the design (icon on the left, chevron on the right).
export function SelectField({ label, value, onChange, options, icon: Icon, className }) {
  const id = useId()
  return (
    <div className={cx('flex min-w-0 flex-col gap-2', className)}>
      <label htmlFor={id} className="text-xs font-semibold text-copy">
        {label}
      </label>
      <div className="relative flex h-12 items-center rounded-lg border border-line bg-white focus-within:border-accent">
        {Icon && <Icon className="pointer-events-none absolute left-3 size-[17px] text-ink" aria-hidden="true" />}
        <select
          id={id}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className={cx(
            'h-full w-full cursor-pointer appearance-none rounded-lg bg-transparent pr-9 text-sm text-copy outline-none',
            Icon ? 'pl-[37px]' : 'pl-3',
          )}
        >
          {options.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </select>
        <ChevronDown className="pointer-events-none absolute right-3 size-[15px] text-muted" aria-hidden="true" />
      </div>
    </div>
  )
}

// Segmented toggle (Block, Floor, Availability, Room type).
// With allowDeselect a second click on the active option clears the choice (value becomes null).
export function Segmented({ label, options, value, onChange, className, allowDeselect = false }) {
  return (
    <div className={cx('flex min-w-0 flex-col gap-2', className)}>
      <span className="text-xs font-semibold text-copy">{label}</span>
      <div
        role="group"
        aria-label={label}
        className="segmented-controls flex h-12 gap-[3px] rounded-lg border border-line bg-canvas p-1"
      >
        {options.map((option) => {
          const active = option === value
          return (
            <button
              key={option}
              type="button"
              aria-pressed={active}
              onClick={() => onChange(active && allowDeselect ? null : option)}
              className={cx(
                'min-w-0 flex-1 rounded-md px-1 text-[13px] transition-colors',
                active ? 'bg-ink font-semibold text-white' : 'text-muted hover:text-ink',
              )}
            >
              {option}
            </button>
          )
        })}
      </div>
    </div>
  )
}

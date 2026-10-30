import { Link } from 'react-router-dom'

export const cx = (...classes) => classes.filter(Boolean).join(' ')

/* ---------- Layout helpers ---------- */

// Side padding follows the Figma 120px gutters on large laptops
// and shrinks on smaller ones so the content never feels cramped.
export function Container({ className, children }) {
  return (
    <div className={cx('mx-auto w-full max-w-[1440px] px-8 lg:px-12 xl:px-[120px]', className)}>
      {children}
    </div>
  )
}

// Main column + 400px side panel; stacks below the lg breakpoint.
export function TwoColumn({ left, right }) {
  return (
    <div className="flex flex-col gap-6 lg:flex-row lg:items-start">
      <div className="min-w-0 flex-1">{left}</div>
      <div className="w-full shrink-0 lg:w-[400px]">{right}</div>
    </div>
  )
}

/* ---------- Panels & notices ---------- */

export function Panel({ title, children, className }) {
  return (
    <section
      className={cx(
        'flex flex-col gap-5 rounded-xl border border-line bg-white p-5 shadow-[0_4px_18px_rgba(20,45,80,0.03)]',
        className,
      )}
    >
      {title && <h2 className="text-[18px] font-semibold text-ink">{title}</h2>}
      {children}
    </section>
  )
}

const noticeTones = {
  info: { box: 'bg-tint', title: 'text-accent' },
  neutral: { box: 'bg-[#f3f4f6]', title: 'text-accent' },
  warning: { box: 'bg-[#fff7e8]', title: 'text-[#94600a]' },
}

export function Notice({ title, tone = 'info', children }) {
  const t = noticeTones[tone]
  return (
    <div className={cx('flex flex-col gap-1.5 rounded-lg p-3.5', t.box)}>
      <p className={cx('text-[13px] font-semibold leading-[1.4]', t.title)}>{title}</p>
      <p className="text-xs leading-normal text-muted">{children}</p>
    </div>
  )
}

export function DemoNotice() {
  return (
    <Notice title="Demo only · Not live data">
      Static demonstration. Room details are hypothetical; no real booking is created or cancelled.
    </Notice>
  )
}

export function PriorityNotice() {
  return (
    <Notice title="Scheduled classes always take priority">
      Bookings must not overlap scheduled classes or other reservations. Confirm access with the
      university before using a room.
    </Notice>
  )
}

/* ---------- Status badge (panel header variant) ---------- */

const badgeTones = {
  success: 'bg-[#ecfdf3] text-[#087443]',
  neutral: 'bg-[#f3f4f6] text-muted',
  warning: 'bg-[#fff7e8] text-[#94600a]',
}

export function StatusBadge({ tone = 'neutral', children }) {
  return (
    <span
      className={cx(
        'inline-flex w-fit rounded-lg px-2.5 py-1.5 text-xs font-semibold',
        badgeTones[tone],
      )}
    >
      {children}
    </span>
  )
}

/* ---------- Buttons ---------- */

const variants = {
  primary: 'bg-ink text-white hover:bg-[#0f2340]',
  secondary: 'border border-line bg-white text-ink hover:bg-canvas',
  danger: 'border border-[#d8bfc3] bg-white text-[#9a3542] hover:bg-[#fdf6f7]',
  disabled: 'cursor-not-allowed bg-[#f3f4f6] text-[#8a98ac]',
  disabledCard: 'cursor-not-allowed bg-[#f3f4f6] text-[#98a2b3]',
}

const sizes = {
  lg: 'h-12 px-3 text-sm',
  sm: 'h-10 px-3 text-[13px]',
}

export function Button({ to, variant = 'primary', size = 'lg', className, children, ...props }) {
  const cls = cx(
    'inline-flex items-center justify-center gap-2.5 rounded-lg font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
    variants[variant],
    sizes[size],
    className,
  )

  if (variant.startsWith('disabled')) {
    return (
      <button type="button" disabled className={cls} {...props}>
        {children}
      </button>
    )
  }
  if (to) {
    return (
      <Link to={to} className={cls} {...props}>
        {children}
      </Link>
    )
  }
  return (
    <button type="button" className={cls} {...props}>
      {children}
    </button>
  )
}

/* ---------- Label / value pairs ---------- */

export function Detail({ label, children }) {
  return (
    <div className="flex min-w-0 flex-col gap-[5px]">
      <p className="text-xs text-muted">{label}</p>
      <p className="text-sm leading-[1.45] text-copy">{children}</p>
    </div>
  )
}

export function ScheduleDetails({ next = 'Unavailable', updated = 'Not synced' }) {
  return (
    <div className="flex flex-col gap-4">
      <Detail label="Next scheduled class">{next}</Detail>
      <Detail label="Last updated">{updated}</Detail>
    </div>
  )
}

export function Guidance({ children }) {
  return <p className="text-xs leading-normal text-muted">{children}</p>
}

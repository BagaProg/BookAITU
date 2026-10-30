import { useContext, useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { UserRound, LayoutDashboard, LogOut } from 'lucide-react'
import { Container, cx } from './ui.jsx'
import { AccountContext } from './AccountContext'

function ProfileMenu() {
  const account = useContext(AccountContext)
  const [open, setOpen] = useState(false)
  const container = useRef(null)
  const trigger = useRef(null)

  useEffect(() => {
    if (!open) return
    const outside = event => {
      if (!container.current?.contains(event.target)) setOpen(false)
    }
    const escape = event => {
      if (event.key === 'Escape') { setOpen(false); trigger.current?.focus() }
    }
    document.addEventListener('pointerdown', outside)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('pointerdown', outside)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  return <div ref={container} className="relative" onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false)
  }}>
    <button ref={trigger} type="button" aria-label="Профиль" aria-expanded={open}
      aria-controls="profile-actions" onClick={() => setOpen(value => !value)}
      className="flex size-9 items-center justify-center rounded-lg border border-line text-ink hover:bg-canvas focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent">
      <UserRound className="size-[18px]" aria-hidden="true" />
    </button>
    {open && <div id="profile-actions" className="absolute right-0 top-full z-50 mt-3 flex w-56 flex-col gap-1 rounded-xl border border-line bg-white p-2 shadow-lg">
      {account?.user.role === 'admin' && <Link to="/admin" onClick={() => setOpen(false)}
        className="flex items-center gap-3 rounded-lg px-3 py-3 text-sm text-ink hover:bg-tint focus-visible:outline-2 focus-visible:outline-accent">
        <LayoutDashboard className="size-4" aria-hidden="true" />Админ-панель
      </Link>}
      <button type="button" onClick={account?.logout} disabled={!account || account.busy}
        className="flex items-center gap-3 rounded-lg px-3 py-3 text-left text-sm text-red-700 hover:bg-red-50 disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent">
        <LogOut className="size-4" aria-hidden="true" />{account?.busy ? 'Выходим…' : 'Выйти из аккаунта'}
      </button>
    </div>}
  </div>
}

const navItems = [
  { key: 'find', label: 'Find a Room', to: '/find' },
  { key: 'bookings', label: 'My Bookings', to: '/bookings' },
]

export function Nav({ active }) {
  return (
    <header className="border-b border-line bg-white">
      <Container className="flex min-h-[88px] flex-wrap items-center justify-between gap-x-4 gap-y-2 py-2">
        <Link to="/find" className="flex shrink-0 items-center gap-0" aria-label="BookAITU — Find a Room">
          <img src="/aitu-calendar-icon.png" alt="" width="1347" height="1167" className="size-14 shrink-0 object-contain" />
          <span className="flex flex-col gap-[3px]">
            <span className="text-[21px] font-bold leading-none text-ink">BookAITU</span>
            <span className="text-[11px] leading-none text-muted">Smart Campus Room Finder</span>
          </span>
        </Link>

        <nav className="flex min-h-12 items-center gap-4 sm:gap-6 xl:gap-9" aria-label="Main navigation">
          {navItems.map((item) => {
            const isActive = item.key === active
            return (
              <Link
                key={item.key}
                to={item.to}
                aria-current={isActive ? 'page' : undefined}
                className={cx(
                  'flex min-h-12 items-center border-b-2 text-sm',
                  isActive
                    ? 'border-ink font-semibold text-ink'
                    : 'border-transparent text-muted hover:text-ink',
                )}
              >
                {item.label}
              </Link>
            )
          })}
          <ProfileMenu />
        </nav>
      </Container>
    </header>
  )
}

export function Footer() {
  return (
    <footer className="border-t border-line bg-white">
      <Container className="flex items-center justify-between py-6 text-xs">
        <p className="text-muted">© 2026 BookAITU · Astana IT University</p>
        <div className="flex gap-6">
          <span className="text-muted">Room guidelines</span>
          <span className="font-medium text-ink">Need help?</span>
        </div>
      </Container>
    </footer>
  )
}

export default function Layout({ active = 'find', children }) {
  const account = useContext(AccountContext)
  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      <Nav active={active} />
      {account?.error && <Container className="pt-4"><p role="alert" className="auth-error">{account.error}</p></Container>}
      <main className="flex-1">{children}</main>
      <Footer />
    </div>
  )
}

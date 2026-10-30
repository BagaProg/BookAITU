import { Link } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import Layout from './Layout.jsx'
import { Container, PriorityNotice } from './ui.jsx'

// Common frame of every inner page: back link, title, demo notice, content, optional priority notice.
export default function PageShell({
  active = 'find',
  backTo = '/find',
  backLabel = 'Find a Room',
  title,
  description,
  priority = false,
  children,
}) {
  return (
    <Layout active={active}>
      <Container className="flex flex-col gap-6 pb-10 pt-9">
        <Link
          to={backTo}
          className="inline-flex w-fit items-center gap-2 text-[13px] font-medium text-accent hover:underline"
        >
          <ArrowLeft className="size-4" aria-hidden="true" />
          {backLabel}
        </Link>

        <header className="flex flex-col gap-2">
          <h1 className="text-[32px] font-bold leading-[1.18] text-ink">{title}</h1>
          <p className="text-sm leading-normal text-muted">{description}</p>
        </header>

        {children}
        {priority && <PriorityNotice />}
      </Container>
    </Layout>
  )
}

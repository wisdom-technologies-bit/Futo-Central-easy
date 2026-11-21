'use client'
import { useMemo, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import rehypeRaw from 'rehype-raw'
import rehypeSanitize from 'rehype-sanitize'
import rehypeHighlight from 'rehype-highlight'
import { ArrowUpRight, CalendarDays, ChevronRight, Copy, Search, Share2 } from 'lucide-react'
import { categories, type Article } from './data'
import { SiteFooter, SiteHeader } from './site-chrome'
import { eventCategories, futoEvents, formatEventDate, getEventsByCategory, getPastEvents, getUpcomingEvents, searchEvents, type FutoEvent } from './events-data'
import { absoluteUrl, publisherJsonLd } from '@/lib/seo'
import { NewsViewTracker } from '@/components/notifications/news-view-tracker'
import { NewsNotificationPrompt } from '@/components/notifications/news-notification-prompt'
import { OneSignalProvider } from '@/components/notifications/onesignal-provider'
import { SourceNote } from './source-note'
import { categorySlug } from '@/lib/slugify'

const nav = [['Home', '/'], ['News', '/news'], ['Academics', '/news/academics'], ['Campus Life', '/news/student-life'], ['Events', '/events'], ['Sports', '/news/sports'], ['Opportunities', '/news/opportunities']]
export function PageShell({ children, active = 'News' }: { children: React.ReactNode; active?: string }) { return <div className="futo-site"><SiteHeader active={active} />{children}<SiteFooter /></div> }
function Meta({ a }: { a: Article }) { return <div className="article-meta"><span>{a.date}</span><span className="meta-dot" /><span>{a.readTime}</span><span className="meta-dot" /><span>{a.author}</span></div> }
export function ArticleCard({ a }: { a: Article }) { return <article className="article-card"><a className="image-wrap" href={`/news/${a.slug}`}><img src={a.image} alt={a.alt} loading="lazy" /><span className="image-arrow"><ArrowUpRight size={17} /></span></a><div className="card-copy"><span className="category-badge">{a.category}</span><h3><a href={`/news/${a.slug}`}>{a.title}</a></h3><p>{a.excerpt}</p><Meta a={a} /></div></article> }
function Intro({ eyebrow, title, description }: { eyebrow: string; title: string; description: string }) { return <section className="news-intro container"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1><p>{description}</p></section> }
export function CategoryPage({ category, articles }: { category: string; articles: Article[] }) { const list = [...articles].sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt)); return <PageShell><main><Intro eyebrow="FUTO CENTRAL" title={category} description={`The latest ${category.toLowerCase()} developments, stories and updates from the FUTO community.`} /><section className="container news-archive"><nav className="category-nav" aria-label="Categories">{[...categories.filter(c => c !== 'All'), 'Education News'].map(c => <a className={c === category ? 'selected' : ''} href={`/news/${categorySlug(c)}`} key={c}>{c}</a>)}</nav>{list.length ? <div className="latest-grid">{list.map(a => <ArticleCard a={a} key={a.id} />)}</div> : <Empty title="No stories in this category yet" text="New stories will appear here as they are published." />}</section></main></PageShell> }
function Empty({ title, text, search = false }: { title: string; text: string; search?: boolean }) { return <div className="empty-state"><Search size={22} /><h2>{title}</h2><p>{text}</p><a className="dark-link" href={search ? '/news' : '/news'}>{search ? 'Browse All News' : 'Browse All News'} <ArrowUpRight size={16} /></a></div> }
function MarkdownTable(props: React.ComponentProps<'table'>) {
  return (
    <div className="table-scroll">
      <table {...props} />
    </div>
  )
}

export function ArticlePage({ article, related, mostRead = [] }: { article?: Article; related: Article[]; mostRead?: Article[] }) {
  const a = article
  const relatedStories = a ? related.filter((item) => item.id !== a.id).slice(0, 3) : []
  const moreFromCategory = a ? related.filter((item) => item.id !== a.id).slice(0, 4) : []
  const mostReadStories = mostRead.filter((item) => item.id !== a?.id).slice(0, 5)
  if (!a) return <PageShell><main><Empty title="Story Not Found" text="The story you're looking for may have been removed, moved, or the link may be incorrect." /></main></PageShell>
  return (
    <PageShell>
      <NewsViewTracker slug={a.slug} />
      <OneSignalProvider><NewsNotificationPrompt /></OneSignalProvider>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify({ '@context': 'https://schema.org', '@type': 'NewsArticle', headline: a.title, image: [a.image], datePublished: a.publishedAt, dateModified: a.publishedAt, author: { '@type': 'Person', name: a.author }, publisher: publisherJsonLd, description: a.excerpt, mainEntityOfPage: absoluteUrl(`/news/${a.slug}`) }) }} />
      <main>
        <article className="article-page container">
          <header className="article-header">
            <div className="breadcrumbs"><a href="/">Home</a><ChevronRight size={14} /><a href="/news">News</a><ChevronRight size={14} /><a href={`/news/${categorySlug(a.category)}`}>{a.category}</a></div>
            <span className="category-badge">{a.category}</span>
            <h1>{a.title}</h1>
            <p className="article-dek">{a.excerpt}</p>
            <Meta a={a} />
          </header>
          {a.image ? (
            <figure className="article-hero">
              <img className="article-hero-image" src={a.image} alt={a.alt} />
              <figcaption>{a.alt}</figcaption>
            </figure>
          ) : null}
          <div className="article-layout">
            <div className="article-main">
              <div className="article-body">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  rehypePlugins={[rehypeRaw, rehypeSanitize, rehypeHighlight]}
                  components={{ table: MarkdownTable }}
                >
                  {a.content}
                </ReactMarkdown>
                {a.imported && a.sourceName ? <SourceNote sourceName={a.sourceName} /> : null}
              </div>
              <div className="share-row"><b><Share2 size={17} /> Share this story</b><button onClick={() => navigator.clipboard?.writeText(window.location.href)}><Copy size={16} /> Copy Link</button></div>
              {a.tags.length > 0 ? <div className="article-tags filed-under"><span>Filed under: </span>{a.tags.map((t, i) => <span key={t}>{i > 0 ? ', ' : ''}<a href={`/search?q=${encodeURIComponent(t)}`}>{t}</a></span>)}</div> : null}
            </div>
            <aside className="article-sidebar">
              {mostReadStories.length ? (
                <section className="sidebar-block">
                  <h2>Most read</h2>
                  <div className="trending-list">
                    {mostReadStories.map((item, i) => (
                      <a href={`/news/${item.slug}`} className="trending-item" key={item.id}>
                        <span className="trend-number">{String(i + 1).padStart(2, '0')}</span>
                        <span><b>{item.title}</b><small>{item.category}</small></span>
                      </a>
                    ))}
                  </div>
                </section>
              ) : null}
              {moreFromCategory.length ? (
                <section className="sidebar-block sidebar-more">
                  <h2>More from this category</h2>
                  <div className="sidebar-list">
                    {moreFromCategory.map((item) => <a href={`/news/${item.slug}`} key={item.id}>{item.title}</a>)}
                  </div>
                </section>
              ) : null}
            </aside>
          </div>
          {relatedStories.length ? (
            <section className="related-section">
              <div className="section-heading"><div><span className="eyebrow">KEEP READING</span><h2>Related Stories</h2></div></div>
              <div className="story-grid three">{relatedStories.map((x) => <ArticleCard a={x} key={x.id} />)}</div>
            </section>
          ) : null}
        </article>
      </main>
    </PageShell>
  )
}
export function SearchPage({ initialQuery = '', articles }: { initialQuery?: string; articles: Article[] }) { const [q, setQ] = useState(initialQuery); const [category, setCategory] = useState('All'); const [sort, setSort] = useState('newest'); const results = useMemo(() => { const source = category === 'All' ? articles : articles.filter((a) => a.category.toLowerCase() === category.toLowerCase()); const r = q.trim() ? source.filter((a) => [a.title, a.excerpt, a.category, a.author, ...a.tags].join(' ').toLowerCase().includes(q.trim().toLowerCase())) : source; return sort === 'oldest' ? [...r].reverse() : sort === 'popular' ? [...r].sort((a, b) => b.views - a.views) : [...r].sort((a, b) => +new Date(b.publishedAt) - +new Date(a.publishedAt)) }, [q, category, sort, articles]); return <PageShell><main><Intro eyebrow="FUTO CENTRAL SEARCH" title="Search FUTO Central" description="Find news, stories, events, opportunities and updates from the FUTO community." /><section className="container news-archive"><div className="news-search"><Search size={18} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search news, stories, events..." aria-label="Search FUTO Central" /></div><div className="search-controls"><select value={category} onChange={e => setCategory(e.target.value)} aria-label="Filter by category">{categories.map(c => <option key={c}>{c}</option>)}</select><select value={sort} onChange={e => setSort(e.target.value)} aria-label="Sort results"><option value="newest">Newest</option><option value="oldest">Oldest</option><option value="popular">Most Read</option></select></div>{q ? <p className="results-count">{results.length} stories found for “{q}”</p> : <p className="results-count">What are you looking for?</p>}{results.length ? <div className="latest-grid">{results.map(a => <ArticleCard a={a} key={a.id} />)}</div> : <Empty search title="No stories found" text="We couldn't find any stories matching your search. Try a different keyword or browse all of our latest news." />}</section></main></PageShell> }
function EventCard({ e }: { e: FutoEvent }) { const d = new Date(e.date); return <article className="event-card"><div className="event-date"><strong>{String(d.getDate()).padStart(2, '0')}</strong><span>{d.toLocaleDateString('en-US', { month: 'short' }).toUpperCase()}</span></div><div className="event-info"><span className="category-badge">{e.category}</span><h3>{e.title}</h3><p>{e.time}<span /> {e.location}<span /> {e.status}</p></div><ArrowUpRight size={18} /></article> }
export function EventsPage() { const [q, setQ] = useState(''); const [cat, setCat] = useState('All'); const upcoming = searchEvents(q, getUpcomingEvents().filter(e => cat === 'All' || e.category === cat)); return <PageShell active="Events"><main><Intro eyebrow="FUTO CENTRAL EVENTS" title="What's Happening at FUTO" description="Discover upcoming events, activities, programs, competitions and gatherings happening across the FUTO community." /><section className="container events-page"><div className="news-search"><Search size={18} /><input value={q} onChange={e => setQ(e.target.value)} placeholder="Search events..." aria-label="Search events" /></div><nav className="category-nav">{eventCategories.map(c => <button className={cat === c ? 'selected' : ''} onClick={() => setCat(c)} key={c}>{c}</button>)}</nav><div className="section-heading"><div><span className="eyebrow">UPCOMING</span><h2>Upcoming Events</h2></div></div><div className="events-list">{upcoming.map(e => <EventCard e={e} key={e.id} />)}</div>{!upcoming.length && <Empty title="No upcoming events" text="There are currently no upcoming events listed. Check back soon for new activities and announcements." />}<div className="section-heading past-heading"><div><span className="eyebrow">ARCHIVE</span><h2>Past Events</h2></div></div><div className="events-list">{getPastEvents().map(e => <EventCard e={e} key={e.id} />)}</div></section></main></PageShell> }


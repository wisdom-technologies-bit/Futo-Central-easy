/**
 * One shared slug helper for the whole site.
 *
 * It reproduces the URLs the site already publishes: "Technology & Innovation"
 * becomes "technology-innovation" (the ampersand is dropped, not expanded), so
 * breadcrumbs, category navigation and imported article slugs all agree.
 */
export function slugify(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96)
    .replace(/-+$/g, '')
}

/** Slug used for a news category link. */
export function categorySlug(name: string): string {
  return slugify(name)
}

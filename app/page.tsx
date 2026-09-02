export const dynamic = 'force-dynamic'

import FutoHomepage from '@/components/futo/futo-homepage'
import { emptyNewsHomeData, getNewsHomeData } from '@/lib/news-db'

export default async function Home() {
  let data = emptyNewsHomeData
  try {
    data = await getNewsHomeData()
  } catch (error) {
    console.error('[v0] Public news data unavailable:', error instanceof Error ? error.message : 'unknown error')
  }
  return <FutoHomepage data={data} />
}

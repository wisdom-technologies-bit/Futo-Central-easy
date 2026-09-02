import { requireAdmin } from '@/lib/editorial-auth'
import { getAllNotices } from '@/lib/notices-data'
import { NoticesAdmin } from '@/components/futo/notices-admin'
export default async function NoticesPage(){await requireAdmin(); return <NoticesAdmin notices={await getAllNotices()}/>}

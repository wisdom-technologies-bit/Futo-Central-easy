import { requireAdmin } from '@/lib/editorial-auth'
import { NoticeComposer } from '@/components/futo/notices-admin'
export default async function NewNoticePage(){await requireAdmin();return <NoticeComposer/>}

import { notFound } from 'next/navigation'
import { requireAdmin } from '@/lib/editorial-auth'
import { getNotice } from '@/lib/notices-data'
import { NoticeComposer } from '@/components/futo/notices-admin'
export default async function EditNoticePage({params}:{params:Promise<{id:string}>}){await requireAdmin();const {id}=await params;const notice=await getNotice(id);if(!notice)notFound();return <NoticeComposer notice={notice}/>} 

import { getDatabase } from '@/lib/db'

export type NoticeMedia = { id: string; media_type: string; secure_url: string; cloudinary_public_id: string; thumbnail_url: string | null; caption: string | null; display_order: number; duration: number | null }
export type Notice = { id: string; content_type: 'text'|'audio'|'image'|'video'; title: string|null; content: string|null; status: string; created_at: string; published_at: string|null; media: NoticeMedia[] }

const base = `SELECT n.id,n.content_type,n.title,n.content,n.status,n.created_at,n.published_at, COALESCE(json_agg(json_build_object('id',m.id,'media_type',m.media_type,'secure_url',m.secure_url,'cloudinary_public_id',m.cloudinary_public_id,'thumbnail_url',m.thumbnail_url,'caption',m.caption,'display_order',m.display_order,'duration',m.duration) ORDER BY m.display_order) FILTER (WHERE m.id IS NOT NULL),'[]') media FROM notices n LEFT JOIN notice_media m ON m.notice_id=n.id`
export async function getPublishedNotices(limit=30): Promise<Notice[]> { const db=getDatabase(); if(!db) return []; try { const r=await db.query<Notice>(`${base} WHERE n.status='published' GROUP BY n.id ORDER BY n.published_at DESC NULLS LAST LIMIT $1`,[limit]); return r.rows } catch { return [] } }
export async function getAllNotices(): Promise<Notice[]> { const db=getDatabase(); if(!db) return []; try { const r=await db.query<Notice>(`${base} GROUP BY n.id ORDER BY n.created_at DESC LIMIT 100`); return r.rows } catch { return [] } }
export async function getNotice(id:string): Promise<Notice|null> { const db=getDatabase(); if(!db) return null; try { const r=await db.query<Notice>(`${base} WHERE n.id=$1 GROUP BY n.id`,[id]); return r.rows[0]??null } catch { return null } }

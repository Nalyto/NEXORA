import { createClient } from '@supabase/supabase-js';
const URL=(process.env.SUPABASE_URL||'https://bejgqjqjtvkqanzuihby.supabase.co').replace(/\/$/,'');
const KEY=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
const json=(res,status,body)=>res.status(status).setHeader('Content-Type','application/json').json(body);
export default async function handler(req,res){
 if(req.method!=='POST')return json(res,405,{error:'Method not allowed'});
 if(!KEY)return json(res,500,{error:'Konfigurasi server Supabase belum lengkap.'});
 try{
  const token=(req.headers.authorization||'').replace(/^Bearer\s+/i,'').trim();
  if(!token)return json(res,401,{error:'Sesi login tidak ditemukan.'});
  const admin=createClient(URL,KEY,{auth:{autoRefreshToken:false,persistSession:false}});
  const {data:{user},error:userError}=await admin.auth.getUser(token);
  if(userError||!user)return json(res,401,{error:'Sesi login tidak valid.'});
  const {data:members,error:memberError}=await admin.from('company_users').select('id,company_id,role,status').eq('user_id',user.id).eq('status','active');
  if(memberError)throw memberError;
  if(!members?.length)return json(res,403,{error:'Akun berhasil login, tetapi belum memiliki keanggotaan perusahaan NEXORA yang aktif.'});
  const {data:profile,error:profileError}=await admin.from('profiles').select('id,status').eq('id',user.id).maybeSingle();
  if(profileError)throw profileError;
  if(profile?.status==='inactive')return json(res,403,{error:'Profil NEXORA sedang dinonaktifkan. Hubungi Owner.'});
  if(!profile){
   const {error:createError}=await admin.from('profiles').insert({id:user.id,name:user.user_metadata?.name||user.user_metadata?.full_name||user.email?.split('@')[0]||'User',email:user.email||'',status:'active'});
   if(createError)throw createError;
  }
  return json(res,200,{ok:true,profileCreated:!profile,memberships:members.length});
 }catch(e){console.error('session bootstrap failed:',e);return json(res,500,{error:e.message||'Gagal menyiapkan sesi NEXORA.'});}
}

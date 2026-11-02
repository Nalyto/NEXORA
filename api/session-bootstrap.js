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
  const companyIds=[...new Set(members.map(m=>m.company_id))];
  const [{data:companies,error:companiesError},{data:branches,error:branchesError},{data:allMembers,error:allMembersError}]=await Promise.all([
   admin.from('companies').select('*').in('id',companyIds),
   admin.from('branches').select('*').in('company_id',companyIds).eq('is_active',true),
   admin.from('company_users').select('id,company_id,user_id,role,status').in('company_id',companyIds)
  ]);
  if(companiesError)throw companiesError;if(branchesError)throw branchesError;if(allMembersError)throw allMembersError;
  const userIds=[...new Set((allMembers||[]).map(m=>m.user_id).filter(Boolean))];
  const [{data:profiles,error:profilesError},{data:branchLinks,error:linksError}]=await Promise.all([
   admin.from('profiles').select('id,name,email,status').in('id',userIds),
   admin.from('company_user_branches').select('company_user_id,branch_id').in('company_user_id',(allMembers||[]).map(m=>m.id))
  ]);
  if(profilesError)throw profilesError;if(linksError)throw linksError;
  return json(res,200,{ok:true,profileCreated:!profile,profile:{id:user.id,name:profile?.name||user.user_metadata?.name||user.email?.split('@')[0]||'User',email:profile?.email||user.email||'',status:profile?.status||'active'},memberships:members,companies:companies||[],branches:branches||[],allMembers:allMembers||[],profiles:profiles||[],branchLinks:branchLinks||[]});
 }catch(e){console.error('session bootstrap failed:',e);return json(res,500,{error:e.message||'Gagal menyiapkan sesi NEXORA.'});}
}

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://bejgqjtvkqanzuihby.supabase.co';
const SUPABASE_SECRET_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
function json(res,status,body){res.status(status).setHeader('Content-Type','application/json').json(body);}

export default async function handler(req,res){
  if(req.method!=='POST') return json(res,405,{error:'Method not allowed'});
  if(!SUPABASE_SECRET_KEY) return json(res,500,{error:'SUPABASE_SECRET_KEY belum dipasang di Vercel.'});
  try{
    const token=(req.headers.authorization||'').replace(/^Bearer\\s+/i,'').trim();
    if(!token) return json(res,401,{error:'Sesi Owner tidak ditemukan.'});
    const admin=createClient(SUPABASE_URL,SUPABASE_SECRET_KEY,{auth:{autoRefreshToken:false,persistSession:false}});
    const {data:{user},error:userError}=await admin.auth.getUser(token);
    if(userError||!user) return json(res,401,{error:'Sesi Owner tidak valid.'});
    const {email,name,password,role,branchIds,companyId}=req.body||{};
    const normalizedEmail=String(email||'').trim().toLowerCase();
    const normalizedName=String(name||'').trim();
    if(!normalizedEmail||!normalizedName||!password||!companyId||!role) return json(res,400,{error:'Email, nama, password, perusahaan, dan role wajib diisi.'});
    if(String(password).length<8) return json(res,400,{error:'Password awal minimal 8 karakter.'});
    const {data:membership,error:membershipError}=await admin.from('company_users').select('id,role,status').eq('company_id',companyId).eq('user_id',user.id).maybeSingle();
    if(membershipError) throw membershipError;
    if(!membership||membership.status!=='active'||membership.role!=='owner') return json(res,403,{error:'Hanya Owner aktif yang dapat menambahkan member.'});
    const validRoles=['manajer','kasir','marketing','gudang'];
    const normalizedRole=String(role).toLowerCase();
    if(!validRoles.includes(normalizedRole)) return json(res,400,{error:'Role member tidak valid.'});
    const branches=Array.isArray(branchIds)?[...new Set(branchIds.filter(Boolean))]:[];
    if(!branches.length) return json(res,400,{error:'Pilih minimal satu cabang.'});
    const {data:branchRows,error:branchError}=await admin.from('branches').select('id').eq('company_id',companyId).in('id',branches);
    if(branchError) throw branchError;
    if((branchRows||[]).length!==branches.length) return json(res,400,{error:'Satu atau beberapa cabang tidak valid untuk perusahaan ini.'});
    const {data:existingInvite}=await admin.from('company_invitations').select('id').eq('company_id',companyId).eq('email',normalizedEmail).eq('status','pending').gt('expires_at',new Date().toISOString()).limit(1).maybeSingle();
    if(existingInvite) return json(res,409,{error:'Masih ada undangan aktif untuk email ini. Batalkan/selesaikan undangan lama terlebih dahulu.'});
    const {data:created,error:createError}=await admin.auth.admin.createUser({email:normalizedEmail,password:String(password),email_confirm:true,user_metadata:{name:normalizedName}});
    if(createError){
      const msg=String(createError.message||'').toLowerCase();
      if(msg.includes('already')||msg.includes('registered')||msg.includes('exists')) return json(res,409,{error:'Email ini sudah memiliki akun NEXORA. Gunakan email lain atau buat alur tambah ke perusahaan untuk akun yang sudah ada.'});
      throw createError;
    }
    const newUser=created.user;
    try{
      const {error:profileError}=await admin.from('profiles').upsert({id:newUser.id,name:normalizedName,email:normalizedEmail,status:'active'},{onConflict:'id'});
      if(profileError) throw profileError;
      const {data:memberRow,error:memberError}=await admin.from('company_users').insert({company_id:companyId,user_id:newUser.id,role:normalizedRole,status:'active'}).select('id').single();
      if(memberError) throw memberError;
      const links=branches.map(branch_id=>({company_user_id:memberRow.id,branch_id}));
      const {error:linksError}=await admin.from('company_user_branches').insert(links);
      if(linksError) throw linksError;
    }catch(saveError){
      await admin.auth.admin.deleteUser(newUser.id);
      throw saveError;
    }
    return json(res,200,{ok:true,message:'Member berhasil dibuat. Berikan email dan password awal kepada member secara aman.'});
  }catch(e){console.error('create member failed:',e);return json(res,500,{error:e.message||'Gagal menambahkan member.'});}
}

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
  const db=createClient(URL,KEY,{auth:{autoRefreshToken:false,persistSession:false}});
  const {data:{user},error:authError}=await db.auth.getUser(token);
  if(authError||!user)return json(res,401,{error:'Sesi login tidak valid.'});
  const {action,companyId}=req.body||{};
  if(!companyId)return json(res,400,{error:'Perusahaan belum dipilih.'});
  const {data:membership,error:membershipError}=await db.from('company_users').select('id,role,status').eq('company_id',companyId).eq('user_id',user.id).eq('status','active').maybeSingle();
  if(membershipError)throw membershipError;
  if(!membership)return json(res,403,{error:'Tidak memiliki akses ke perusahaan ini.'});
  const role=String(membership.role||'').toLowerCase();
  const canManage=['owner','manajer'].includes(role);
  if(action==='list'){
   const {data,error}=await db.from('products').select('legacy_id,name,type,category,price,cost,stock,is_active,updated_at').eq('company_id',companyId).eq('is_active',true).order('name');
   if(error)throw error;
   return json(res,200,{ok:true,products:data||[]});
  }
  if(action==='import_legacy'||action==='upsert'){
   if(!canManage)return json(res,403,{error:'Hanya Owner atau Manajer yang dapat mengelola master produk.'});
   const incoming=action==='import_legacy'?req.body.products:[req.body.product];
   if(!Array.isArray(incoming)||!incoming.length)return json(res,400,{error:'Data produk kosong.'});
   if(incoming.length>1000)return json(res,400,{error:'Maksimal 1000 produk per proses.'});
   if(action==='import_legacy'){
    const {count,error:countError}=await db.from('products').select('id',{count:'exact',head:true}).eq('company_id',companyId);
    if(countError)throw countError;
    if(count>0)return json(res,409,{error:'Produk cloud sudah tersedia. Impor awal dibatalkan untuk mencegah duplikasi.'});
   }
   const rows=incoming.map(p=>({
    company_id:companyId,legacy_id:String(p.id||p.legacy_id||'').slice(0,120),
    name:String(p.name||'').trim().slice(0,160),type:p.type==='Layanan'?'Layanan':'Produk',
    category:String(p.category||'Umum').trim().slice(0,100)||'Umum',
    price:Math.max(0,Number(p.price)||0),cost:Math.max(0,Number(p.cost)||0),
    stock:Math.max(0,Number(p.stock)||0),is_active:p.status===false||p.active===false?false:true,updated_at:new Date().toISOString()
   }));
   if(rows.some(p=>!p.legacy_id||!p.name))return json(res,400,{error:'Setiap produk wajib memiliki ID lama dan nama.'});
   const {data,error}=await db.from('products').upsert(rows,{onConflict:'company_id,legacy_id'}).select('legacy_id');
   if(error)throw error;
   return json(res,200,{ok:true,saved:data?.length||0});
  }
  if(action==='adjust_stock'){
   if(!['owner','manajer','kasir','gudang'].includes(role))return json(res,403,{error:'Role ini tidak memiliki izin untuk mengubah stok.'});
   const changes=Array.isArray(req.body?.changes)?req.body.changes:[{legacyId:req.body?.legacyId,delta:req.body?.delta,setStock:req.body?.setStock}];
   if(!changes.length||changes.length>500||changes.some(x=>!x.legacyId))return json(res,400,{error:'Daftar perubahan stok tidak valid.'});
   const {data,error}=await db.rpc('nexora_apply_product_stock_changes',{p_company_id:companyId,p_changes:changes.map(x=>({legacyId:String(x.legacyId),delta:Number(x.delta)||0,setStock:x.setStock===undefined||x.setStock===null?null:Number(x.setStock)}))});
   if(error)throw error;
   return json(res,200,{ok:true,changes:data||[]});
  }
  if(action==='deactivate'){
   if(!canManage)return json(res,403,{error:'Hanya Owner atau Manajer yang dapat menonaktifkan produk.'});
   const {legacyId}=req.body||{};
   const {error}=await db.from('products').update({is_active:false,updated_at:new Date().toISOString()}).eq('company_id',companyId).eq('legacy_id',legacyId);
   if(error)throw error;
   return json(res,200,{ok:true});
  }
  return json(res,400,{error:'Aksi produk tidak dikenal.'});
 }catch(e){console.error('products API:',e);return json(res,500,{error:e.message||'Gagal memproses data produk.'});}
}

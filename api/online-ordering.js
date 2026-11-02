import { createClient } from '@supabase/supabase-js';

const URL=(process.env.SUPABASE_URL||'https://bejgqjqjtvkqanzuihby.supabase.co').replace(/\/$/,'');
const KEY=process.env.SUPABASE_SECRET_KEY||process.env.SUPABASE_SERVICE_ROLE_KEY;
const BUCKET='nexora-online-ordering';
const admin=()=>createClient(URL,KEY,{auth:{autoRefreshToken:false,persistSession:false}});
const send=(res,status,body)=>res.status(status).setHeader('Content-Type','application/json').json(body);
const slugify=s=>String(s||'').toLowerCase().normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9]+/g,'-').replace(/^-|-$/g,'').slice(0,55);
const mimeExt=m=>({'image/jpeg':'jpg','image/png':'png','image/webp':'webp'}[m]||null);
function decodeImage(data){const m=String(data||'').match(/^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/);if(!m)throw new Error('Format gambar harus JPG, PNG, atau WEBP.');const b=Buffer.from(m[2],'base64');if(!b.length||b.length>3*1024*1024)throw new Error('Ukuran gambar maksimal 3 MB.');return {bytes:b,mime:m[1],ext:mimeExt(m[1])};}
async function staffFor(db,req,companyId,branchId,allowed=['owner']){const token=(req.headers.authorization||'').replace(/^Bearer\\s+/i,'').trim();if(!token)throw Object.assign(new Error('Sesi login diperlukan.'),{status:401});const {data:{user},error}=await db.auth.getUser(token);if(error||!user)throw Object.assign(new Error('Sesi login tidak valid.'),{status:401});const {data:m,error:e}=await db.from('company_users').select('id,role,status').eq('company_id',companyId).eq('user_id',user.id).maybeSingle();if(e)throw e;const role=String(m?.role||'').toLowerCase();if(!m||m.status!=='active'||!allowed.includes(role))throw Object.assign(new Error('Akun tidak memiliki izin untuk tindakan ini.'),{status:403});if(branchId&&role!=='owner'){const {data:link,error:le}=await db.from('company_user_branches').select('branch_id').eq('company_user_id',m.id).eq('branch_id',branchId).maybeSingle();if(le)throw le;if(!link)throw Object.assign(new Error('Akun tidak memiliki akses ke cabang pesanan ini.'),{status:403});}return {user,role};}
async function ownerFor(db,req,companyId){return (await staffFor(db,req,companyId,null,['owner'])).user;}
export default async function handler(req,res){
 if(req.method!=='POST')return send(res,405,{error:'Method not allowed'});
 if(!KEY)return send(res,500,{error:'Konfigurasi server Supabase belum lengkap.'});
 const db=admin();
 try{
  const body=req.body||{},action=body.action;
  if(action==='public_store'){
   const slug=slugify(body.slug);if(!slug)return send(res,400,{error:'Link toko tidak valid.'});
   const {data:store,error}=await db.from('online_stores').select('id,slug,display_name,description,company_id,branch_id,qris_image_path,is_published').eq('slug',slug).eq('is_published',true).maybeSingle();
   if(error)throw error;if(!store)return send(res,404,{error:'Toko tidak ditemukan atau belum dipublikasikan.'});
   const {data:products,error:pe}=await db.from('online_store_products').select('source_product_id,name,description,category,image_url,price').eq('store_id',store.id).eq('is_active',true).order('sort_order');
   if(pe)throw pe;let qrisUrl=null;
   if(store.qris_image_path){const {data:signed,error:se}=await db.storage.from(BUCKET).createSignedUrl(store.qris_image_path,3600);if(!se)qrisUrl=signed.signedUrl;}
   return send(res,200,{store:{slug:store.slug,name:store.display_name||'Toko NEXORA',description:store.description||''},products:products||[],qrisUrl});
  }
  if(action==='create_order'){
   const slug=slugify(body.slug),name=String(body.customerName||'').trim(),phone=String(body.customerPhone||'').trim(),note=String(body.note||'').trim(),items=Array.isArray(body.items)?body.items:[];
   if(!slug||!name||!phone||!items.length||items.length>50)return send(res,400,{error:'Lengkapi nama, nomor WhatsApp, dan keranjang pesanan.'});
   if(name.length>100||phone.length>30||note.length>500)return send(res,400,{error:'Data pelanggan terlalu panjang.'});
   const {data:store,error:se}=await db.from('online_stores').select('id,company_id,branch_id,is_published').eq('slug',slug).eq('is_published',true).maybeSingle();if(se)throw se;if(!store)return send(res,404,{error:'Toko tidak tersedia.'});
   const ids=[...new Set(items.map(x=>String(x.productId||'')))];if(ids.some(x=>!x))return send(res,400,{error:'Item pesanan tidak valid.'});
   const {data:products,error:pe}=await db.from('online_store_products').select('source_product_id,name,price,is_active').eq('store_id',store.id).eq('is_active',true).in('source_product_id',ids);if(pe)throw pe;
   if((products||[]).length!==ids.length)return send(res,400,{error:'Ada produk yang sudah tidak tersedia. Muat ulang toko.'});
   const byId=Object.fromEntries(products.map(p=>[p.source_product_id,p]));let lines=[],subtotal=0;
   for(const item of items){const p=byId[String(item.productId)],qty=Math.floor(Number(item.quantity));if(!p||!Number.isFinite(qty)||qty<1||qty>99)return send(res,400,{error:'Jumlah produk tidak valid.'});const line=p.price*qty;subtotal+=line;lines.push({source_product_id:p.source_product_id,product_name:p.name,unit_price:p.price,quantity:qty,line_total:line});}
   const method=body.paymentMethod==='cash'?'cash':'qris_static';const orderNo='ONL-'+Date.now().toString().slice(-8)+'-'+Math.random().toString(36).slice(2,5).toUpperCase();const uniqueCode=method==='cash'?'NX'+String(Math.floor(100000+Math.random()*900000)):null;
   const {data:order,error:oe}=await db.from('online_orders').insert({store_id:store.id,company_id:store.company_id,branch_id:store.branch_id,order_number:orderNo,unique_code:uniqueCode,payment_method:method,payment_status:method==='cash'?'awaiting_cash':'awaiting_payment',order_status:method==='cash'?'awaiting_cash':'awaiting_payment',customer_name:name,customer_phone:phone,customer_note:note,subtotal,total:subtotal}).select('id,public_token,order_number,total,unique_code,payment_method').single();if(oe)throw oe;
   const {error:ie}=await db.from('online_order_items').insert(lines.map(x=>({...x,order_id:order.id})));if(ie){await db.from('online_orders').delete().eq('id',order.id);throw ie;}
   return send(res,200,{order:{token:order.public_token,number:order.order_number,total:order.total,uniqueCode:order.unique_code,paymentMethod:order.payment_method}});
  }
  if(action==='cancel_order'){
   const token=String(body.token||'');if(!token)return send(res,400,{error:'Kode pesanan tidak valid.'});
   const {data:order,error:oe}=await db.from('online_orders').select('id,payment_status,order_status').eq('public_token',token).maybeSingle();if(oe)throw oe;if(!order)return send(res,404,{error:'Pesanan tidak ditemukan.'});
   if(order.payment_status==='approved'||['queued','processing','ready','completed'].includes(order.order_status))return send(res,409,{error:'Pesanan sudah disetujui atau diproses dan tidak dapat dibatalkan dari halaman pembeli.'});
   const {error:ce}=await db.from('online_orders').update({payment_status:'rejected',order_status:'cancelled',rejection_note:'Dibatalkan oleh pembeli.',updated_at:new Date().toISOString()}).eq('id',order.id);if(ce)throw ce;
   return send(res,200,{ok:true,message:'Pesanan berhasil dibatalkan.'});
  }
  if(action==='submit_proof'){
   const token=String(body.token||''),image=decodeImage(body.imageData),dbPath='proofs/'+token+'/'+Date.now()+'.'+image.ext;
   const {data:order,error:oe}=await db.from('online_orders').select('id,payment_status').eq('public_token',token).maybeSingle();if(oe)throw oe;if(!order)return send(res,404,{error:'Pesanan tidak ditemukan.'});if(!['awaiting_payment','rejected'].includes(order.payment_status))return send(res,409,{error:'Bukti pembayaran untuk pesanan ini sudah dikirim.'});
   const {error:up}=await db.storage.from(BUCKET).upload(dbPath,image.bytes,{contentType:image.mime,upsert:false});if(up)throw up;
   const {error:ue}=await db.from('online_orders').update({payment_proof_path:dbPath,payment_status:'proof_submitted',order_status:'awaiting_verification',payment_submitted_at:new Date().toISOString(),rejection_note:null}).eq('id',order.id);if(ue)throw ue;
   return send(res,200,{ok:true,message:'Bukti pembayaran berhasil dikirim. Menunggu verifikasi Owner.'});
  }
  if(action==='cashier_receive'){
   const companyId=String(body.companyId||''),orderId=String(body.orderId||''),branchId=String(body.branchId||''),received=Number(body.receivedAmount);const {user}=await staffFor(db,req,companyId,branchId,['owner','kasir']);
   if(!orderId||!Number.isFinite(received)||received<0)return send(res,400,{error:'Nominal uang diterima tidak valid.'});
   const {data:order,error:oe}=await db.from('online_orders').select('id,company_id,branch_id,total,payment_method,payment_status,order_status').eq('id',orderId).eq('company_id',companyId).eq('branch_id',branchId).maybeSingle();if(oe)throw oe;if(!order)return send(res,404,{error:'Pesanan tidak ditemukan.'});
   if(order.payment_method!=='cash'||order.payment_status!=='awaiting_cash'||order.order_status!=='awaiting_cash')return send(res,409,{error:'Pesanan tunai tidak lagi menunggu pembayaran.'});
   if(received<Number(order.total))return send(res,400,{error:'Uang diterima masih kurang dari total pembayaran.'});
   const patch={payment_status:'approved',order_status:'queued',cash_received_amount:received,cash_change:received-Number(order.total),cash_received_by:user.id,cash_received_at:new Date().toISOString(),reviewed_by:user.id,reviewed_at:new Date().toISOString()};
   const {error:ue}=await db.from('online_orders').update(patch).eq('id',orderId).eq('payment_status','awaiting_cash');if(ue)throw ue;
   return send(res,200,{ok:true,orderStatus:'queued',total:order.total,receivedAmount:received,change:received-Number(order.total)});
  }
  if(action==='review_order'){
   const companyId=String(body.companyId||''),orderId=String(body.orderId||''),decision=body.decision;
   const user=await ownerFor(db,req,companyId);if(!orderId||!['approve','reject'].includes(decision))return send(res,400,{error:'Permintaan verifikasi tidak valid.'});
   const {data:order,error:oe}=await db.from('online_orders').select('id,company_id,payment_status,order_status').eq('id',orderId).eq('company_id',companyId).maybeSingle();if(oe)throw oe;if(!order)return send(res,404,{error:'Pesanan tidak ditemukan.'});if(order.payment_status!=='proof_submitted')return send(res,409,{error:'Pesanan belum memiliki bukti pembayaran yang menunggu verifikasi.'});
   const patch=decision==='approve'?{payment_status:'approved',order_status:'queued',reviewed_by:user.id,reviewed_at:new Date().toISOString(),rejection_note:null}:{payment_status:'rejected',order_status:'awaiting_payment',reviewed_by:user.id,reviewed_at:new Date().toISOString(),rejection_note:String(body.reason||'Bukti pembayaran belum dapat diverifikasi.').slice(0,300)};
   const {error:ue}=await db.from('online_orders').update(patch).eq('id',orderId);if(ue)throw ue;return send(res,200,{ok:true,orderStatus:patch.order_status,paymentStatus:patch.payment_status});
  }
  if(action==='owner_get_store'){
   const companyId=String(body.companyId||''),branchId=String(body.branchId||'');await ownerFor(db,req,companyId);
   const {data:store,error}=await db.from('online_stores').select('slug,display_name,description,is_published,qris_image_path').eq('company_id',companyId).eq('branch_id',branchId).maybeSingle();if(error)throw error;
   return send(res,200,{store:store?{slug:store.slug,displayName:store.display_name,description:store.description,isPublished:store.is_published,hasQris:!!store.qris_image_path}:null});
  }
  if(action==='owner_list'){
   const companyId=String(body.companyId||''),branchId=body.branchId?String(body.branchId):null,{user}=await staffFor(db,req,companyId,branchId,['owner','kasir']);
   let query=db.from('online_orders').select('id,branch_id,order_number,unique_code,payment_method,cash_received_amount,cash_change,customer_name,customer_phone,total,payment_status,order_status,created_at,payment_proof_path,customer_note').eq('company_id',companyId).order('created_at',{ascending:false}).limit(100);
   if(branchId)query=query.eq('branch_id',branchId);
   const {data:orders,error}=await query;if(error)throw error;
   const withProof=await Promise.all((orders||[]).map(async o=>{if(!o.payment_proof_path)return {...o,paymentProofUrl:null};const {data:s}=await db.storage.from(BUCKET).createSignedUrl(o.payment_proof_path,900);return {...o,paymentProofUrl:s?.signedUrl||null};}));
   return send(res,200,{orders:withProof,userId:user.id});
  }
  if(action==='save_store'){
   const companyId=String(body.companyId||''),branchId=String(body.branchId||''),user=await ownerFor(db,req,companyId);
   const slug=slugify(body.slug);if(!slug||!branchId)return send(res,400,{error:'Slug dan cabang wajib diisi.'});
   const {data:branch,error:be}=await db.from('branches').select('id').eq('id',branchId).eq('company_id',companyId).maybeSingle();if(be)throw be;if(!branch)return send(res,400,{error:'Cabang tidak valid.'});
   let {data:existing,error:ee}=await db.from('online_stores').select('id').eq('company_id',companyId).eq('branch_id',branchId).maybeSingle();if(ee)throw ee;
   const payload={company_id:companyId,branch_id:branchId,slug,display_name:String(body.displayName||'').trim().slice(0,100)||'Toko Online',description:String(body.description||'').trim().slice(0,500),is_published:body.isPublished===true,updated_at:new Date().toISOString()};
   if(body.qrisImageData){const img=decodeImage(body.qrisImageData),path='qris/'+companyId+'/'+branchId+'/'+Date.now()+'.'+img.ext;const {error:up}=await db.storage.from(BUCKET).upload(path,img.bytes,{contentType:img.mime,upsert:false});if(up)throw up;payload.qris_image_path=path;}
   if(body.isPublished===true&&!payload.qris_image_path&&existing){const {data:oldStore,error:oldError}=await db.from('online_stores').select('qris_image_path').eq('id',existing.id).single();if(oldError)throw oldError;if(!oldStore.qris_image_path)return send(res,400,{error:'Upload QRIS terlebih dahulu sebelum mempublikasikan toko.'});}else if(body.isPublished===true&&!payload.qris_image_path&&!existing){return send(res,400,{error:'Upload QRIS terlebih dahulu sebelum mempublikasikan toko.'});}
   let result;if(existing){result=await db.from('online_stores').update(payload).eq('id',existing.id).select('id,slug,is_published').single();}else{result=await db.from('online_stores').insert(payload).select('id,slug,is_published').single();}
   if(result.error)throw result.error;
   return send(res,200,{ok:true,store:result.data,ownerId:user.id});
  }
  if(action==='sync_products'){
   const companyId=String(body.companyId||''),branchId=String(body.branchId||''),user=await ownerFor(db,req,companyId),products=Array.isArray(body.products)?body.products:[];
   const {data:store,error:se}=await db.from('online_stores').select('id').eq('company_id',companyId).eq('branch_id',branchId).maybeSingle();if(se)throw se;if(!store)return send(res,404,{error:'Simpan pengaturan toko terlebih dahulu.'});
   if(products.length>500)return send(res,400,{error:'Jumlah produk melebihi batas.'});
   const rows=products.filter(p=>p&&p.id&&String(p.name||'').trim()).map((p,i)=>({store_id:store.id,source_product_id:String(p.id),name:String(p.name).slice(0,150),description:String(p.description||'').slice(0,500),category:String(p.category||'Umum').slice(0,80),image_url:null,price:Math.max(0,Number(p.price)||0),is_active:true,sort_order:i,synced_at:new Date().toISOString()}));
   if(rows.length){const {error:up}=await db.from('online_store_products').upsert(rows,{onConflict:'store_id,source_product_id'});if(up)throw up;}
   return send(res,200,{ok:true,synced:rows.length,ownerId:user.id});
  }
  return send(res,400,{error:'Aksi tidak dikenal.'});
 }catch(e){console.error('online ordering:',e);return send(res,e.status||500,{error:e.message||'Terjadi kesalahan server.'});}
}

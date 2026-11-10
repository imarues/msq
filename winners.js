import { getDemoEntries } from "./simulation.js";
// Transparent winner selection for MSQ. Manual choices are explicitly labelled manual.
const now = () => Math.floor(Date.now()/1000);
const safe = s => String(s ?? "").replace(/[&<>"]/g, x=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[x]));
async function tg(env,method,body){
  const r=await fetch("https://api.telegram.org/bot"+env.BOT_TOKEN+"/"+method,{
    method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)
  });
  const json=await r.json();
  if(!r.ok||!json.ok)throw Error(method+": "+(json.description||r.status));
  return json.result;
}
const ownerMsg = (env,id,text,options={}) => tg(env,"sendMessage",{chat_id:id,text,...options});
const callback = (env,id,text) => tg(env,"answerCallbackQuery",{callback_query_id:id,text: String(text).slice(0,180),show_alert:false});
const formatName = p => (p.name||("مشارك "+p.user_id)).slice(0,100);
const allowed = m => ["member","administrator","creator"].includes(m.status)||(m.status==="restricted" && m.is_member===true);
const contestOpen = c => c && c.ends_at>now() && c.status==="active";
export async function setupWinnerTables(env){
  await env.DB.batch([
    env.DB.prepare("CREATE TABLE IF NOT EXISTS draw_config(contest_id INTEGER PRIMARY KEY, winner_count INTEGER NOT NULL DEFAULT 1, announce_mode TEXT NOT NULL DEFAULT 'manual')"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS draw_results(contest_id INTEGER PRIMARY KEY, result_kind TEXT NOT NULL, winners_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'prepared', message_id INTEGER, prepared_at INTEGER NOT NULL, announced_at INTEGER)"),
    env.DB.prepare("CREATE TABLE IF NOT EXISTS simulated_entries(contest_id INTEGER PRIMARY KEY, entries_json TEXT NOT NULL)")
  ]);
}
export async function addDrawConfig(env,id,count,mode){
  await env.DB.prepare("INSERT OR REPLACE INTO draw_config(contest_id,winner_count,announce_mode) VALUES(?,?,?)").bind(id,Math.max(1,Math.min(10,Number(count)||1)),mode==="auto"?"auto":"manual").run();
}
export async function contestMenu(env,id,chat){
  const c=await env.DB.prepare("SELECT * FROM contests WHERE id=?").bind(id).first();
  if(!c)return ownerMsg(env,chat,"المسابقة غير موجودة.");
  const cfg=await env.DB.prepare("SELECT * FROM draw_config WHERE contest_id=?").bind(id).first();
  const result=await env.DB.prepare("SELECT * FROM draw_results WHERE contest_id=?").bind(id).first();
  const n=await env.DB.prepare("SELECT COUNT(*) AS n FROM participants WHERE contest_id=? AND eligible=1").bind(id).first();
  const ended=!contestOpen(c);
  const mock=await getDemoEntries(env,id);
  const keyboard={inline_keyboard:mock?.length?[
    [{text:"🧪 إعلان نتائج المحاكاة التعليمية",callback_data:"admin:simulation:"+id}],
    [{text:"🔄 تحديث حالة النتائج",callback_data:"admin:contest:"+id}]
  ]:[
    [{text:"🎲 سحب عشوائي وإعلان",callback_data:"admin:random:"+id}],
    [{text:"👤 اختيار مشارك وإعلان (يدوي)",callback_data:"admin:pick:"+id}],
    [{text:"🔄 تحديث حالة النتائج",callback_data:"admin:contest:"+id}]
  ]};
  return ownerMsg(env,chat,"🏆 "+c.name+" (#"+id+")\n\n"+
    "👥 المشتركون: "+(n?.n||0)+
    "\n⏳ الحالة: "+(ended?"انتهى الاشتراك":"الاشتراك مستمر")+
    "\n🎖 عدد الفائزين: "+(cfg?.winner_count||1)+
    "\n📢 الإعلان: "+(cfg?.announce_mode==="auto"?"تلقائي بعد النهاية":"يدوي من الإدارة")+
    "\n🏁 النتائج: "+(result?.status==="published"?"معلنة":result?.status==="prepared"?"جاهزة للنشر":"لم تُعلن")+(mock?.length?"\n🧪 محاكاة تعليمية، أسماء نتائجها محددة مسبقاً.":"")+
    "\n\nبعد انتهاء التسجيل، استخدم إحدى طريقتي إعلان الفائزين. الاختيار اليدوي يُعلن باسمه الحقيقي، وليس كقرعة عشوائية.",
    {reply_markup:keyboard});
}
async function participants(env,id){
  const r=await env.DB.prepare("SELECT * FROM participants WHERE contest_id=? AND eligible=1 ORDER BY RANDOM() LIMIT 120").bind(id).all();
  return r.results||[];
}
async function eligible(env,id,user){
  const chs=await env.DB.prepare("SELECT chat_id FROM channels WHERE contest_id=?").bind(id).all();
  if((chs.results||[]).length!==3)throw Error("عدد القنوات غير صحيح.");
  const checks=await Promise.all(chs.results.map(ch=>tg(env,"getChatMember",{chat_id:ch.chat_id,user_id:Number(user.user_id)})));
  const ok=checks.every(allowed);
  await env.DB.prepare("UPDATE participants SET eligible=?,verified_at=? WHERE contest_id=? AND user_id=?").bind(ok?1:0,now(),id,user.user_id).run();
  return ok;
}
async function randomWinners(env,id,wanted){
  let selected=[],tested=new Set(),limit=0;
  while(selected.length<wanted && limit++<4){
    const candidates=await participants(env,id);
    if(!candidates.length)break;
    let examined=0;
    for(const p of candidates){
      if(tested.has(p.user_id))continue;
      tested.add(p.user_id);examined++;
      if(await eligible(env,id,p)){
        selected.push(p);
        if(selected.length>=wanted)break;
      }
      if(tested.size>=320)break;
    }
    if(!examined||tested.size>=320||candidates.length<120)break;
  }
  return selected;
}
async function prepare(env,c,kind,winners){
  const stamp=now();
  await env.DB.prepare("INSERT OR IGNORE INTO draw_results(contest_id,result_kind,winners_json,status,prepared_at) VALUES(?,?,?,'prepared',?)")
    .bind(c.id,kind,JSON.stringify(winners.map(p=>({user_id:String(p.user_id),name:formatName(p),username:p.username||null}))),stamp).run();
  return env.DB.prepare("SELECT * FROM draw_results WHERE contest_id=?").bind(c.id).first();
}
async function announcePrepared(env,c,row){
  if(row.status==="published")return "النتائج مُعلنة مسبقاً.";
  const claim=await env.DB.prepare("UPDATE draw_results SET status='publishing',prepared_at=? WHERE contest_id=? AND (status='prepared' OR (status='publishing' AND prepared_at<?))").bind(now(),c.id,now()-120).run();
  if(!claim.meta?.changes)return "جاري إعلان النتائج؛ يُمنع النشر المكرر.";
  let winners=JSON.parse(row.winners_json);
  const simulated=row.result_kind==="simulation";
  const label=simulated?"محاكاة تعليمية — أسماء محددة مسبقاً، ليست قرعة حقيقية":row.result_kind==="manual"?"اختيار يدوي من الإدارة":"سحب عشوائي من المشاركين المؤهلين";
  const lines=winners.map((w,i)=> (i+1)+". "+safe(w.name)+(w.username?" (@"+safe(w.username)+")":"")).join("\n");
  const text=(simulated?"🧪 نتائج تجريبية وليست فوزاً حقيقياً\n\n":"")+"🏆 نتائج المسابقة: "+safe(c.name)+
    "\n\n📋 طريقة اختيار الفائزين: "+label+
    "\n\n"+(winners.length?"🎉 الفائزون:\n"+lines:"لم يتوفر مشاركون مؤهلون للسحب.")+
    (simulated?"\n\n⚠️ هذه أسماء موضوعة مسبقاً للعرض التعليمي، ولم يُشترط تسجيل أصحابها أو استيفاؤهم شروط المشاركة. لا توجد جوائز حقيقية.":"\n\n✅ تم التحقق من شروط المشاركة قبل اعتماد النتائج.");
  const msg=await tg(env,"sendMessage",{chat_id:c.chat_id,text,parse_mode:"HTML",disable_web_page_preview:true});
  await env.DB.prepare("UPDATE draw_results SET status='published',announced_at=?,message_id=? WHERE contest_id=? AND status='publishing'")
    .bind(now(),msg.message_id,c.id).run();
  const privateLines=winners.map(w=>w.name+" | "+(w.username?"@"+w.username:"بدون يوزر")+" | "+w.user_id).join("\n");
  await ownerMsg(env,c.owner_id,"✅ أُعلنت نتائج "+c.name+" (#"+c.id+")\nطريقة الاختيار: "+label+"\n"+(privateLines||"لا يوجد فائزون")+
    "\nالرابط: https://t.me/"+c.chat_username.replace("@","")+"/"+msg.message_id).catch(e=>console.log("owner winner alert: "+e.message));
  return "تم إعلان النتائج بالقناة.";
}
async function announceSimulation(env,c){
  if(contestOpen(c))throw Error("ما انتهت المدة بعد.");
  const list=await getDemoEntries(env,c.id);
  if(!list?.length)throw Error("ماكو نتائج محاكاة محفوظة.");
  const prior=await env.DB.prepare("SELECT * FROM draw_results WHERE contest_id=?").bind(c.id).first();
  if(prior)return announcePrepared(env,c,prior);
  const row=await prepare(env,c,"simulation",list);
  return announcePrepared(env,c,row);
}
async function alreadyOrCreate(env,c,kind,manualUser=null){
  if(contestOpen(c))throw Error("المسابقة ما انتهت بعد. انتظر نهاية التسجيل.");
  if(await getDemoEntries(env,c.id))throw Error("هذه مسابقة محاكاة تعليمية، استخدم زر إعلان نتائج المحاكاة.");
  const previous=await env.DB.prepare("SELECT * FROM draw_results WHERE contest_id=?").bind(c.id).first();
  if(previous)return announcePrepared(env,c,previous);
  const config=await env.DB.prepare("SELECT winner_count FROM draw_config WHERE contest_id=?").bind(c.id).first();
  const wanted=Math.max(1,Math.min(10,Number(config?.winner_count)||1));
  let winners=[];
  if(kind==="manual"){
    const ids=Array.isArray(manualUser)?manualUser:[String(manualUser)];
    if(ids.length!==wanted||new Set(ids).size!==wanted)throw Error("يجب تحديد "+wanted+" فائز مختلف.");
    for(const uid of ids){
      const person=await env.DB.prepare("SELECT * FROM participants WHERE contest_id=? AND user_id=? AND eligible=1").bind(c.id,String(uid)).first();
      if(!person)throw Error("هذا الـID مو مسجل كمشارك مؤهل: "+uid);
      if(!await eligible(env,c.id,person))throw Error("المشارك ما يستوفي شرط عضوية القنوات الثلاث: "+uid);
      winners.push(person);
    }
  }else winners=await randomWinners(env,c.id,wanted);
  const saved=await prepare(env,c,kind,winners);
  return announcePrepared(env,c,saved);
}
export async function announceAutomatic(env,c){
  const config=await env.DB.prepare("SELECT announce_mode FROM draw_config WHERE contest_id=?").bind(c.id).first();
  if(config?.announce_mode!=="auto")return false;
  if(await getDemoEntries(env,c.id))await announceSimulation(env,c);
  else await alreadyOrCreate(env,c,"random");
  return true;
}
export async function retryUnannounced(env){
  const r=await env.DB.prepare(
    "SELECT c.* FROM contests c JOIN draw_config d ON d.contest_id=c.id LEFT JOIN draw_results w ON w.contest_id=c.id WHERE c.ends_at<=? AND c.status='ended' AND d.announce_mode='auto' AND (w.contest_id IS NULL OR w.status IN ('prepared','publishing')) ORDER BY c.id ASC LIMIT 5"
  ).bind(now()).all();
  for(const c of r.results||[])try{await announceAutomatic(env,c);}catch(e){console.log("auto winner retry #"+c.id+": "+e.message);}
}
export async function adminWinnerCallback(env,cb){
  const m=/^admin:(contest|random|pick|simulation):(\d+)$/.exec(String(cb.data||""));
  if(!m)return false;
  await callback(env,cb.id,"تم استلام الطلب");
  const id=Number(m[2]);
  const c=await env.DB.prepare("SELECT * FROM contests WHERE id=?").bind(id).first();
  if(!c){await ownerMsg(env,cb.from.id,"المسابقة غير موجودة.");return true;}
  if(m[1]==="contest"){await contestMenu(env,id,cb.from.id);return true;}
  const mock=await getDemoEntries(env,id);
  if(m[1]==="simulation"){
    try{const message=await announceSimulation(env,c);await ownerMsg(env,cb.from.id,"🧪 "+message);}catch(e){await ownerMsg(env,cb.from.id,"⚠️ "+e.message);}
    return true;
  }
  if(mock?.length){await ownerMsg(env,cb.from.id,"هذه مسابقة محاكاة تعليمية؛ استخدم زر إعلان نتائج المحاكاة.");return true;}
  if(contestOpen(c)){await ownerMsg(env,cb.from.id,"⏳ الاشتراك مستمر. بعد انتهاء وقت المسابقة تكدر تعلن النتائج.");return true;}
  if(m[1]==="pick"){
    const previous=await env.DB.prepare("SELECT status FROM draw_results WHERE contest_id=?").bind(id).first();
    if(previous){await ownerMsg(env,cb.from.id,"النتائج مُجهزة أو مُعلنة مسبقاً. ما يصير نغيّر نوع السحب.");return true;}
    await env.DB.prepare("INSERT INTO setup(owner_id,step,data) VALUES(?,'winner_manual',?) ON CONFLICT(owner_id) DO UPDATE SET step='winner_manual',data=excluded.data")
      .bind(String(cb.from.id),JSON.stringify({contest_id:id,selected:[]})).run();
    const cfg=await env.DB.prepare("SELECT winner_count FROM draw_config WHERE contest_id=?").bind(id).first();
    await ownerMsg(env,cb.from.id,"👤 الاختيار اليدوي: أرسل Telegram ID للمشارك الأول.\nعدد الفائزين المطلوب: "+(cfg?.winner_count||1)+"\n\nبعد استلام جميع المعرفات والتأكد من الشروط، تُعلن النتيجة بوضوح كاختيار يدوي.\n\nللإلغاء: /cancel");
    return true;
  }
  try{
    const result=await alreadyOrCreate(env,c,"random");
    await ownerMsg(env,cb.from.id,"🎲 "+result);
  }catch(e){await ownerMsg(env,cb.from.id,"⚠️ تعذر السحب: "+e.message);}
  return true;
}
export async function manualWinnerMessage(env,msg,st){
  const value=String(msg.text||"").trim();
  if(!/^\d{4,20}$/.test(value)){await ownerMsg(env,msg.chat.id,"ارسل Telegram ID رقمي صحيح للمشارك، أو /cancel.");return;}
  const c=await env.DB.prepare("SELECT * FROM contests WHERE id=?").bind(st.data.contest_id).first();
  if(!c){await ownerMsg(env,msg.chat.id,"المسابقة غير موجودة.");return;}
  try{
    const cfg=await env.DB.prepare("SELECT winner_count FROM draw_config WHERE contest_id=?").bind(c.id).first();
    const wanted=Math.max(1,Math.min(10,Number(cfg?.winner_count)||1));
    const selected=Array.isArray(st.data.selected)?st.data.selected:[];
    if(selected.includes(value)){await ownerMsg(env,msg.chat.id,"هذا المشترك سبق اخترته، أرسل ID مختلف.");return;}
    const user=await env.DB.prepare("SELECT * FROM participants WHERE contest_id=? AND user_id=? AND eligible=1").bind(c.id,value).first();
    if(!user||!await eligible(env,c.id,user)){await ownerMsg(env,msg.chat.id,"❌ هذا الشخص مو مؤهل أو مو مسجل بالمسابقة. أرسل ID ثاني.");return;}
    selected.push(value);
    if(selected.length<wanted){
      await env.DB.prepare("UPDATE setup SET data=? WHERE owner_id=? AND step='winner_manual'").bind(JSON.stringify({contest_id:c.id,selected}),String(msg.from.id)).run();
      await ownerMsg(env,msg.chat.id,"✅ تم اعتماد "+selected.length+" من "+wanted+" للفوز.\nأرسل ID الفائز التالي، أو /cancel.");
      return;
    }
    const result=await alreadyOrCreate(env,c,"manual",selected);
    await env.DB.prepare("DELETE FROM setup WHERE owner_id=?").bind(String(msg.from.id)).run();
    await ownerMsg(env,msg.chat.id,"✅ "+result);
  }catch(e){await ownerMsg(env,msg.chat.id,"⚠️ "+e.message+"\nجرّب ID آخر أو /cancel.");}
}

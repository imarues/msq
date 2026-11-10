// Educational demonstration-only results. The published contest and result must disclose simulation.
export function parseDemoEntries(text,count){
  const lines=String(text||"").split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  if(lines.length!==count)throw Error("ارسل "+count+" سطر بالضبط، لكل فائز تجريبي سطر واحد.");
  const result=[],used=new Set();
  for(const line of lines){
    let username=null,user_id=null,name=null;
    const handle=/^@?([a-zA-Z][a-zA-Z0-9_]{4,31})$/.exec(line);
    const named=/^([0-9]{4,20})\s*[-–—]\s*(.{2,70})$/u.exec(line);
    if(handle){
      username=handle[1];user_id="demo:@"+username.toLowerCase();name="@"+username;
    }else if(named){
      user_id=named[1];name=named[2].trim();
    }else throw Error("صيغة غير صحيحة: "+line.slice(0,70)+"\nاستعمل @username أو 123456789 - اسم تجريبي");
    const key=String(user_id).toLowerCase();
    if(used.has(key))throw Error("لا تكرر نفس المستخدم مرتين.");
    used.add(key);result.push({user_id,name,username});
  }
  return result;
}
export async function saveDemoEntries(env,id,entries){
  if(!Array.isArray(entries)||entries.length<1||entries.length>10)throw Error("عدد النتائج التجريبية غير صحيح.");
  await env.DB.prepare("INSERT INTO simulated_entries(contest_id,entries_json) VALUES(?,?)").bind(id,JSON.stringify(entries)).run();
}
export async function getDemoEntries(env,id){
  const row=await env.DB.prepare("SELECT entries_json FROM simulated_entries WHERE contest_id=?").bind(id).first();
  return row?JSON.parse(row.entries_json):null;
}


const canonical = value => String(value||"").trim().toLowerCase().replace(/^https?:\/\/(www\.)?t\.me\//,"@").replace(/^@/,"");
export function requireClassroomChannels(env,channels){
  const chosen=String(env.DEMO_ALLOWED_CHANNELS||"").split(/[\s,;]+/).filter(Boolean).map(canonical);
  const specified=channels.map(c=>canonical(c.username));
  if(chosen.length!==3 || new Set(chosen).size!==3 || specified.length!==3 ||
     !specified.every(ch=>chosen.includes(ch))){
    throw Error("وضع العرض المقيد يحتاج إعداد DEMO_ALLOWED_CHANNELS بيوزرات القنوات التجريبية الثلاث داخل Cloudflare. ما يصير تشغيله على قناة غير مخصصة للعرض.");
  }
}

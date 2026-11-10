// Classroom-only preset result entries, with a private audit record and channel allowlist.
export function parseDemoEntries(text,count){
  const lines=String(text||"").split(/\r?\n/).map(x=>x.trim()).filter(Boolean);
  if(lines.length!==count)throw Error("أرسل "+count+" سطر بالضبط، سطر لكل فائز تجريبي.");
  const entries=[],seen=new Set();
  const handle=/^@?([A-Za-z][A-Za-z0-9_]{4,31})$/;
  const handleFull=/^([^\r\n]{2,70}?)\s*[-–—|]\s*@([A-Za-z][A-Za-z0-9_]{4,31})$/u;
  const handleFirst=/^@([A-Za-z][A-Za-z0-9_]{4,31})\s*[-–—|]\s*(.{2,70})$/u;
  const idFull=/^([0-9]{4,20})\s*[-–—|]\s*(.{2,70})$/u;
  for(const line of lines){
    let entry;
    const a=handleFull.exec(line),b=handleFirst.exec(line),d=idFull.exec(line),h=handle.exec(line);
    if(a)entry={user_id:"demo:@"+a[2].toLowerCase(),name:a[1].trim(),username:a[2]};
    else if(b)entry={user_id:"demo:@"+b[1].toLowerCase(),name:b[2].trim(),username:b[1]};
    else if(d)entry={user_id:d[1],name:d[2].trim(),username:null};
    else if(h)entry={user_id:"demo:@"+h[1].toLowerCase(),name:"@"+h[1],username:h[1]};
    else throw Error("صيغة غير صحيحة: "+line.slice(0,70)+
      "\nاكتب «الاسم - @username» أو «123456789 - الاسم» أو «@username».");
    if(!entry.name||!entry.name.trim())throw Error("اسم الفائز التجريبي فارغ.");
    const k=entry.user_id.toLowerCase();
    if(seen.has(k))throw Error("لا تكرر نفس اليوزر أو الـID مرتين.");
    seen.add(k);entries.push(entry);
  }
  return entries;
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
  if(chosen.length<3 || new Set(chosen).size!==chosen.length || specified.length!==3 ||
     new Set(specified).size!==3 || !specified.every(ch=>chosen.includes(ch))){
    throw Error("أضف 3 قنوات تجريبية مختلفة أو أكثر إلى DEMO_ALLOWED_CHANNELS في Cloudflare. يجب أن تكون قنوات المسابقة الثلاث كلها ضمن القائمة المسموحة.");
  }
}

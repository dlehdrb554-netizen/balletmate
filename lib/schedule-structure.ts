export type ParsedScheduleSession = {
  weekday: number;
  start_time: string;
  end_time: string | null;
  note: string | null;
};

export type StructuredSchedule = {
  proposed_title: string;
  audience: "adult" | "kids" | "all";
  proposed_level: string | null;
  proposed_class_type: string | null;
  sessions: ParsedScheduleSession[];
};

const weekdayMap: Record<string, number> = { 일:0, 월:1, 화:2, 수:3, 목:4, 금:5, 토:6 };

function toTime(hourRaw: string, minuteRaw?: string, meridiem?: string): string | null {
  let hour = Number(hourRaw);
  const minute = Number(minuteRaw || 0);
  if (!Number.isInteger(hour) || hour < 0 || hour > 24 || minute < 0 || minute > 59 || (hour===24&&minute!==0)) return null;
  if (meridiem?.includes("오후") && hour < 12) hour += 12;
  if (meridiem?.includes("오전") && hour === 12) hour = 0;
  if (hour === 24) hour = 0;
  return String(hour).padStart(2,"0")+":"+String(minute).padStart(2,"0");
}

function extractTimes(text: string): {start:string;end:string|null}[] {
  const results: {start:string;end:string|null}[]=[];
  const range=/((?:오전|오후)?\s*\d{1,2}(?::\d{2}|\s*시(?:\s*\d{1,2}\s*분)?)\s*(?:오전|오후)?)\s*(?:-|~|〜|–|—|부터)\s*((?:오전|오후)?\s*\d{1,2}(?::\d{2}|\s*시(?:\s*\d{1,2}\s*분)?)\s*(?:오전|오후)?)/g;
  const parseOne=(value:string)=>{
    const normalized=value.replace(/\s+/g," ").trim();
    const m=normalized.match(/(오전|오후)?\s*(\d{1,2})(?::(\d{2})|\s*시(?:\s*(\d{1,2})\s*분)?)\s*(오전|오후)?/);
    return m?toTime(m[2],m[3]||m[4],m[1]||m[5]):null;
  };
  let match:RegExpExecArray|null;
  while((match=range.exec(text))!==null){
    const startText=match[1],endText=match[2];
    const endMeridiem=(endText.match(/오전|오후/)||[])[0];
    const startMeridiem=(startText.match(/오전|오후/)||[])[0]||endMeridiem;
    const endMeridiem=(endText.match(/오전|오후/)||[])[0]||startMeridiem;
    const start=parseOne(startMeridiem&&!/오전|오후/.test(startText)?startMeridiem+" "+startText:startText);
    const end=parseOne(endMeridiem&&!/오전|오후/.test(endText)?endMeridiem+" "+endText:endText);
    if(start&&end&&start!==end)results.push({start,end});
  }
  const singles=/(오전|오후)?\s*(\d{1,2})(?::(\d{2})|\s*시(?:\s*(\d{1,2})\s*분)?)\s*(오전|오후)?/g;
  while((match=singles.exec(text))!==null){
    const t=toTime(match[2],match[3]||match[4],match[1]||match[5]);
    if(t&&!results.some(r=>r.start===t||r.end===t))results.push({start:t,end:null});
  }
  return results.slice(0,12);
}

export function parseScheduleEvidence(text:string): StructuredSchedule | null {
  const compact=text.replace(/[\u200b-\u200d\ufeff]/g," ").replace(/\s+/g," ").trim();
  const days=new Set<number>();
  const daySequence=compact.match(/[월화수목금토일]{2,7}/g)||[];
  for(const sequence of daySequence)for(const char of sequence)if(char in weekdayMap)days.add(weekdayMap[char]);
  for(const [char,weekday] of Object.entries(weekdayMap)){
    const dayWord=new RegExp(char+"요일");
    const standalone=new RegExp("(^|[\\s,·/])"+char+"(?=([\\s,·/]|$))");
    if(dayWord.test(compact)||standalone.test(compact))days.add(weekday);
  }
  if(/평일/.test(compact))for(const d of [1,2,3,4,5])days.add(d);
  if(/주말/.test(compact))for(const d of [0,6])days.add(d);
  if(/매일/.test(compact))for(const d of [0,1,2,3,4,5,6])days.add(d);
  const times=extractTimes(compact);
  if(days.size===0||times.length===0)return null;
  const audience:StructuredSchedule["audience"]=/키즈|유아|어린이|초등|아동/.test(compact)?"kids":/성인|adult/.test(compact)?"adult":"all";
  const levelMatch=compact.match(/(입문|초급|기초|중급|고급|advanced|beginner)/i);
  const level=levelMatch?levelMatch[1]:null;
  const typeMatch=compact.match(/(발레핏|포인트|토슈즈|스트레칭|바워크|센터|작품|기초반|테크닉)/);
  const classType=typeMatch?typeMatch[1]:null;
  const audienceLabel=audience==="kids"?"키즈":audience==="adult"?"성인":"";
  const proposedTitle=[audienceLabel,level,classType||"발레"].filter(Boolean).join(" ");
  const sessions:ParsedScheduleSession[]=[];
  for(const weekday of [...days].sort((a,b)=>a-b)){
    for(const time of times){
      sessions.push({weekday,start_time:time.start,end_time:time.end,note:[audienceLabel,level,classType].filter(Boolean).join(" ")||null});
    }
  }
  return {proposed_title:proposedTitle,audience,proposed_level:level,proposed_class_type:classType,sessions:sessions.slice(0,28)};
}

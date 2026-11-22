import React, { useCallback, useEffect, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";

import * as FileSystem from "expo-file-system/legacy";
import { fetchStudioBlogPosts } from "../lib/studio-blog-content";
import { parseScheduleEvidence } from "../lib/schedule-structure";

type EvidenceCandidate = {id:number;studio_id:string;studio_name:string;source_id:number;source_title:string|null;source_url:string;source_post_date?:string|null;candidate_type:"price"|"schedule";candidate_value:string;normalized_value:string|null;price_period?:string|null;price_frequency_per_week?:number|null;evidence_text:string;confidence:number;review_status:"pending"|"verified"|"rejected";created_at:string};

type StudioRow = {
  id:string; name:string; latitude:number; longitude:number; district:string|null;
  address:string|null; phone:string|null; price_per_class:number|null; website_url:string|null;
  source_url:string|null; source_name:string|null; verified_at:string|null; image_urls:string[]|null; image_source_name:string|null; image_usage_note:string|null;
  adult_classes:boolean; kids_classes:boolean; is_active:boolean;
};

const blank = {name:"",latitude:"",longitude:"",district:"",address:"",phone:"",website_url:"",source_url:"",source_name:"",verified_at:"",image_urls:"",image_source_name:"",image_usage_note:"",price_per_class:"",adult_classes:true,kids_classes:false,is_active:false};
const c = {ink:"#252238",muted:"#8B879A",purple:"#7661D8",pale:"#F3F0FF",line:"#EAE7F0",white:"#FFFFFF",bg:"#FAF9FC"};

function parseOcrFields(text:string){
  const compact=text.replace(/\s+/g," ");
  let amount:number|null=null;
  let m=compact.match(/₩\s*([\d,]+)/);
  if(m)amount=Number(m[1].replace(/,/g,""));
  if(!amount){m=compact.match(/(\d{1,2})\s*만\s*(\d{1,2})\s*천\s*원?/);if(m)amount=Number(m[1])*10000+Number(m[2])*1000;}
  if(!amount){m=compact.match(/(\d{1,2})\s*만\s*원/);if(m)amount=Number(m[1])*10000;}
  if(!amount){m=compact.match(/(\d{1,2})\s*천\s*원/);if(m)amount=Number(m[1])*1000;}
  if(!amount){m=compact.match(/([\d,]+)\s*원/);if(m)amount=Number(m[1].replace(/,/g,""));}
  const monthMatch=compact.match(/(\d+)\s*(?:개월|달)/);
  const weekMatch=compact.match(/(\d+)\s*주(?:간)?/);
  const ticketMatch=compact.match(/(\d+)\s*회\s*(?:권|수강권|이용권|패키지)/);
  const countMatch=compact.match(/(\d+)\s*회\s*(?=(?:수업|레슨|이용|패키지|권|\d+\s*원|\d+\s*만))/);
  const weeklyFrequency=compact.match(/주\s*(\d+)\s*회/);
  const sessionCount=countMatch&&!(weeklyFrequency&&countMatch[1]===weeklyFrequency[1])?countMatch:null;
  const price_period=monthMatch?monthMatch[1]+"개월":weekMatch?weekMatch[1]+"주":/(연간|1년|연\s*(?:수강료|회비|등록비|비용|가격))/.test(compact)?"연 단위":/(매월|월\s*(?:수강료|회비|등록비|비용|가격)|월간|한\s*달|월\s*\d+\s*회)/.test(compact)?"월 단위":ticketMatch?ticketMatch[1]+"회권":sessionCount?sessionCount[1]+"회":/(1회당|회당|원데이|일일\s*(?:수강|체험))/.test(compact)?"1회":"기간 미확인";
  const freqMatch=compact.match(/주\s*(\d{1,2})\s*회/);
  const frequencyCandidate=freqMatch?Number(freqMatch[1]):null;
  const frequency_per_week=frequencyCandidate&&frequencyCandidate>=1&&frequencyCandidate<=14?frequencyCandidate:null;
  const dayMap:[RegExp,string][]=[
    [/(?:월요일|(?:^|[\s,·/])월(?=[\s,·/]|$)(?!\s*\d+\s*회))/,"월"],
    [/(?:화요일|(?:^|[\s,·/])화(?=[\s,·/]|$)(?!\s*\d+\s*회))/,"화"],
    [/(?:수요일|(?:^|[\s,·/])수(?=[\s,·/]|$)(?!\s*\d+\s*회))/,"수"],
    [/(?:목요일|(?:^|[\s,·/])목(?=[\s,·/]|$)(?!\s*\d+\s*회))/,"목"],
    [/(?:금요일|(?:^|[\s,·/])금(?=[\s,·/]|$)(?!\s*\d+\s*회))/,"금"],
    [/(?:토요일|(?:^|[\s,·/])토(?=[\s,·/]|$)(?!\s*\d+\s*회))/,"토"],
    [/(?:일요일|(?:^|[\s,·/])일(?=[\s,·/]|$)(?!\s*\d+\s*회))/,"일"]
  ];
  const compactDaySequence=compact.match(/[월화수목금토일]{2,7}/g)?.join("")||"";
  const schedule_days=dayMap.filter(([re],index)=>re.test(compact)||compactDaySequence.includes(["월","화","수","목","금","토","일"][index])).map(([,day])=>day);
  const times=compact.match(/(?:오전|오후)\s*\d{1,2}(?::\d{2})?|\b\d{1,2}:\d{2}\b|\b\d{1,2}\s*시(?:\s*\d{1,2}\s*분)?/g)||[];
  const schedule_time=times.length?times.slice(0,8).join(", "):null;
  const detected_kind=amount!==null?"price":schedule_days.length||schedule_time||/시간표|타임/.test(compact)?"schedule":"unknown";
  return {amount_krw:amount,price_period:amount!==null?price_period:null,frequency_per_week, schedule_days,schedule_time,detected_kind};
}

function parseCsv(text:string): string[][] {
  const rows:string[][]=[]; let row:string[]=[]; let cell=""; let quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(ch==='"'&&quoted&&text[i+1]==='"'){cell+='"';i++;}
    else if(ch==='"'){quoted=!quoted;}
    else if(ch===","&&!quoted){row.push(cell.trim());cell="";}
    else if((ch==="\n"||ch==="\r")&&!quoted){if(ch==="\r"&&text[i+1]==="\n")i++;row.push(cell.trim());if(row.some(v=>v!==""))rows.push(row);row=[];cell="";}
    else cell+=ch;
  }
  row.push(cell.trim());if(row.some(v=>v!==""))rows.push(row);
  return rows;
}

const seoulDate=()=>{const now=new Date();return now.getFullYear()+"-"+String(now.getMonth()+1).padStart(2,"0")+"-"+String(now.getDate()).padStart(2,"0");};
const datePlusDays=(date:string,days:number):string|null=>{
  const value=new Date(date+"T00:00:00.000Z");
  if(!Number.isFinite(value.getTime()))return null;
  value.setUTCDate(value.getUTCDate()+days);
  return value.toISOString().slice(0,10);
};

const loadOcrModule=async()=>{
  try{
    const module=await import("@zhanziyang/expo-text-extractor");
    if(!module.isSupported){Alert.alert("OCR 미지원","현재 Android 빌드에는 OCR 네이티브 모듈이 포함되어 있지 않습니다. 관리자 기능의 나머지 메뉴는 계속 이용할 수 있습니다.");return null;}
    return module;
  }catch(error:any){
    Alert.alert("OCR 모듈을 사용할 수 없음","OCR 기능은 현재 빌드에서 비활성화되어 있습니다. 관리자 화면은 계속 이용할 수 있습니다.");
    console.warn("Optional OCR module unavailable:",error);
    return null;
  }
};

export default function Admin() {
  const [adminTab,setAdminTab]=useState<"overview"|"review"|"publish"|"studios">("overview");
  const [studioActionId,setStudioActionId]=useState<string|null>(null);
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");
  const [session,setSession]=useState<any>(null);
  const [authorized,setAuthorized]=useState(false);
  const [checking,setChecking]=useState(true);
  const [busy,setBusy]=useState(false);
  const [rows,setRows]=useState<StudioRow[]>([]);
  const [studioSearch,setStudioSearch]=useState("");
  const [studioListFilter,setStudioListFilter]=useState<"all"|"missing_photo"|"missing_website"|"website_candidate"|"active"|"inactive">("all");
  const [form,setForm]=useState({...blank});
  const [editing,setEditing]=useState<string|null>(null);
  const [csvText,setCsvText]=useState("");
  const [importing,setImporting]=useState(false);
  const [classStudio,setClassStudio]=useState<StudioRow|null>(null);
  const [officialBlogStudio,setOfficialBlogStudio]=useState<StudioRow|null>(null);
  const [officialBlogUrls,setOfficialBlogUrls]=useState("");
  const [officialBlogBusy,setOfficialBlogBusy]=useState(false);
  const [classRows,setClassRows]=useState<any[]>([]);
  const [classEditing,setClassEditing]=useState<string|null>(null);
  const [classBusy,setClassBusy]=useState(false);
  const [classForm,setClassForm]=useState({title:"",audience:"adult" as "adult"|"kids"|"all",level:"",class_type:"",duration_minutes:"60",price:"",sessions:""});
  const [evidenceRows,setEvidenceRows]=useState<EvidenceCandidate[]>([]);
  const [selectedEvidenceIds,setSelectedEvidenceIds]=useState<number[]>([]);
  const [selectedScheduleIds,setSelectedScheduleIds]=useState<number[]>([]);
  const [selectedPriceIds,setSelectedPriceIds]=useState<number[]>([]);
  const [expandedScheduleCandidateId,setExpandedScheduleCandidateId]=useState<number|null>(null);
  const [expandedPublicScheduleStudioId,setExpandedPublicScheduleStudioId]=useState<string|null>(null);
  const [verifiedPriceRows,setVerifiedPriceRows]=useState<EvidenceCandidate[]>([]);
  const [verifiedScheduleRows,setVerifiedScheduleRows]=useState<EvidenceCandidate[]>([]);
  const [activePublicSchedules,setActivePublicSchedules]=useState<any[]>([]);
  const [publishedScheduleCandidateIds,setPublishedScheduleCandidateIds]=useState<number[]>([]);
  const [publishedCandidateIds,setPublishedCandidateIds]=useState<number[]>([]);
  const [activePublicPrices,setActivePublicPrices]=useState<any[]>([]);
  const [evidenceBusy,setEvidenceBusy]=useState(false);
  const [ocrBusy,setOcrBusy]=useState(false);
  const [ocrAvailability,setOcrAvailability]=useState<"unknown"|"available"|"unavailable">("unknown");
  const [ocrRows,setOcrRows]=useState<any[]>([]);
  const [selectedOcrIds,setSelectedOcrIds]=useState<number[]>([]);
  const [batchOcrOffset,setBatchOcrOffset]=useState(0);
  const [scheduleClassCandidates,setScheduleClassCandidates]=useState<any[]>([]);
  const [candidateTitles,setCandidateTitles]=useState<Record<number,string>>({});
  const [candidateSessions,setCandidateSessions]=useState<Record<number,string>>({});
  const [dashboard,setDashboard]=useState<any>(null);
  const [dashboardBusy,setDashboardBusy]=useState(false);
  const [dashboardError,setDashboardError]=useState<string|null>(null);
  const [retryBusy,setRetryBusy]=useState(false);
  const [reportRows,setReportRows]=useState<any[]>([]);
  const [reportsBusy,setReportsBusy]=useState(false);
  const [reportsError,setReportsError]=useState<string|null>(null);

  const checkAdmin=useCallback(async(s:any)=>{
    if(!s){setAuthorized(false);setChecking(false);return;}
    setChecking(true);
    const {data,error}=await supabase!.rpc("is_balletmate_admin");
    setAuthorized(!error&&data===true);
    setChecking(false);
  },[]);

  useEffect(()=>{
    if(!supabase){setChecking(false);return;}
    supabase.auth.getSession().then(({data})=>{setSession(data.session);checkAdmin(data.session);});
    const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,s)=>{setSession(s);checkAdmin(s);});
    return ()=>subscription.unsubscribe();
  },[checkAdmin]);

  const openOfficialBlogManager=async(studio:StudioRow)=>{
    if(!supabase)return;
    setOfficialBlogStudio(studio);
    setOfficialBlogUrls("");
    setOfficialBlogBusy(true);
    const {data,error}=await supabase.rpc("admin_get_studio_official_blog_accounts",{p_studio_id:studio.id});
    if(error)Alert.alert("공식 블로그 조회 실패",error.message);
    else setOfficialBlogUrls((Array.isArray(data)?data:[]).map((row:any)=>row.blogger_url).filter(Boolean).join("\n"));
    setOfficialBlogBusy(false);
  };
  const saveOfficialBlogAccounts=async()=>{
    if(!supabase||!officialBlogStudio)return;
    const urls=[...new Set(officialBlogUrls.split(/[\\n,]+/).map(value=>value.trim()).filter(Boolean))];
    if(urls.length>5){Alert.alert("등록 한도","학원별 공식 블로그는 최대 5개까지 등록할 수 있습니다.");return;}
    setOfficialBlogBusy(true);
    const {data,error}=await supabase.rpc("admin_set_studio_official_blog_accounts",{p_studio_id:officialBlogStudio.id,p_blogger_urls:urls});
    if(error)Alert.alert("공식 블로그 저장 실패",error.message);
    else{Alert.alert("저장 완료",officialBlogStudio.name+" 공식 블로그 "+urls.length+"개를 등록했습니다.\n이제 해당 계정 게시물만 앱의 공개 소식에 표시됩니다.");setOfficialBlogStudio(null);setOfficialBlogUrls("");}
    setOfficialBlogBusy(false);
  };

  const requeueStudioBlogSearch=(studio:StudioRow)=>{
    if(!supabase)return;
    Alert.alert("블로그 검색 다시 요청",studio.name+"의 네이버 블로그 검색을 대기열에 다시 등록할까요?",[
      {text:"취소",style:"cancel"},
      {text:"요청",onPress:async()=>{
        setBusy(true);
        const {error}=await supabase!.rpc("admin_requeue_studio_blog_search",{p_studio_id:studio.id});
        if(error)Alert.alert("요청 실패",error.message);
        else Alert.alert("요청 등록","검색 대기열에 등록했습니다. 자동 작업이 순차적으로 처리합니다.");
        setBusy(false);await loadDashboard();
      }}
    ]);
  };

  const retryFailedQueues=async()=>{
    const client=supabase;
    if(!client)return;
    Alert.alert("실패 작업 재처리","실패한 블로그 검색·게시글 수집 작업을 대기열로 돌리고 재시도 횟수를 초기화할까요?",[
      {text:"취소",style:"cancel"},
      {text:"재처리",onPress:async()=>{
        setRetryBusy(true);
        const {data,error}=await client.rpc("balletmate_admin_retry_failed_collection_jobs");
        if(error)Alert.alert("재처리 요청 실패",error.message);
        else {Alert.alert("재처리 예약 완료", "블로그 검색 "+(data.blog_search_requeued||0)+"개 · 게시글 "+(data.blog_post_requeued||0)+"개 · 사진 "+(data.image_requeued||0)+"개");await loadDashboard();}
        setRetryBusy(false);
      }}
    ]);
  };

  const loadReports=useCallback(async()=>{
    if(!supabase||!authorized)return;
    setReportsBusy(true);setReportsError(null);
    const {data,error}=await supabase.rpc("admin_list_studio_user_reports");
    if(error){setReportsError(error.message);setReportRows([]);}
    else setReportRows((Array.isArray(data)?data:[]).slice(0,100));
    setReportsBusy(false);
  },[authorized]);
  const updateReportStatus=async(id:number,status:"in_review"|"resolved"|"rejected")=>{
    if(!supabase)return;
    const {error}=await supabase.rpc("admin_update_studio_user_report",{p_report_id:id,p_status:status});
    if(error)Alert.alert("상태 변경 실패",error.message);else await loadReports();
  };

  const loadDashboard=useCallback(async()=>{
    if(!supabase||!authorized)return;
    setDashboardBusy(true);setDashboardError(null);
    const {data,error}=await supabase.rpc("balletmate_admin_dashboard_stats");
    if(error){setDashboardError(error.message);setDashboard(null);}
    else setDashboard(data);
    setDashboardBusy(false);
  },[authorized]);

  const load=useCallback(async()=>{
    if(!supabase||!authorized)return;
    setBusy(true);
    const columns="id,name,latitude,longitude,district,address,phone,website_url,source_url,source_name,verified_at,image_urls,image_source_name,image_usage_note,price_per_class,adult_classes,kids_classes,is_active";
    const {data,error}=await supabase.from("studios").select(columns).order("name").limit(100);
    if(error)Alert.alert("조회 실패",error.message);else setRows((data||[]) as StudioRow[]);
    setBusy(false);
  },[authorized]);

  const loadEvidence=useCallback(async()=>{
    if(!supabase||!authorized)return;
    setEvidenceBusy(true);
    const columns="id,studio_id,studio_name,source_id,source_title,source_url,source_post_date,candidate_type,candidate_value,normalized_value,price_period,price_frequency_per_week,evidence_text,confidence,review_status,created_at";
    const today=seoulDate();
    const [pending,verified,verifiedSchedules,published,publishedSchedules]=await Promise.all([
      supabase.from("studio_blog_evidence_candidates").select(columns).eq("review_status","pending").order("created_at",{ascending:false}).limit(100),
      supabase.from("studio_blog_evidence_candidates").select(columns).eq("review_status","verified").eq("candidate_type","price").order("reviewed_at",{ascending:false}).limit(100),
      supabase.from("studio_blog_evidence_candidates").select(columns).eq("review_status","verified").eq("candidate_type","schedule").order("reviewed_at",{ascending:false}).limit(100),
      supabase.from("studio_public_prices").select("id,candidate_id,studio_id,amount_krw,price_period,frequency_per_week,source_url,source_post_date,published_at,expires_at,is_active").order("published_at",{ascending:false}).limit(100),
      supabase.from("studio_public_schedules").select("id,candidate_id,studio_id,schedule_text,source_url,source_post_date,published_at,expires_at,is_active").order("published_at",{ascending:false}).limit(100),
    ]);
    if(pending.error)Alert.alert("자동 수집 자료 조회 실패",pending.error.message);
    else {setEvidenceRows((pending.data||[]) as EvidenceCandidate[]);setSelectedEvidenceIds(ids=>ids.filter(id=>(pending.data||[]).some((row:any)=>row.id===id)));}
    if(verified.error)Alert.alert("검증 가격 조회 실패",verified.error.message);
else {setVerifiedPriceRows((verified.data||[]) as EvidenceCandidate[]);setSelectedPriceIds(ids=>ids.filter(id=>(verified.data||[]).some((row:any)=>row.id===id)));}
    if(verifiedSchedules.error)Alert.alert("검증 시간표 조회 실패",verifiedSchedules.error.message);
    else {setVerifiedScheduleRows((verifiedSchedules.data||[]) as EvidenceCandidate[]);setSelectedScheduleIds(ids=>ids.filter(id=>(verifiedSchedules.data||[]).some((row:any)=>row.id===id)));}
    const publishedRows=published.data||[];
    const scheduleRows=publishedSchedules.data||[];
    const studioIds=[...new Set([...publishedRows,...scheduleRows].map((row:any)=>row.studio_id).filter(Boolean))];
    const studioNames=new Map<string,string>();
    if(studioIds.length){
      const {data:names,error:namesError}=await supabase.from("studios").select("id,name").in("id",studioIds);
      if(!namesError)for(const item of names||[])studioNames.set(item.id,item.name);
    }
    if(published.error)Alert.alert("공개 가격 조회 실패",published.error.message);
    else {setPublishedCandidateIds(publishedRows.map((row:any)=>Number(row.candidate_id)));setActivePublicPrices(publishedRows.filter((row:any)=>row.is_active).map((row:any)=>({...row,studio_name:studioNames.get(row.studio_id)||"학원명 미확인"})));}
    if(publishedSchedules.error)Alert.alert("공개 시간표 조회 실패",publishedSchedules.error.message);
    else {setPublishedScheduleCandidateIds(scheduleRows.map((row:any)=>Number(row.candidate_id)));setActivePublicSchedules(scheduleRows.filter((row:any)=>row.is_active&&(!row.expires_at||row.expires_at>=today)).map((row:any)=>({...row,studio_name:studioNames.get(row.studio_id)||"학원명 미확인"})));}
    setEvidenceBusy(false);
  },[authorized]);
  const loadScheduleClassCandidates=useCallback(async()=>{
    if(!supabase||!authorized)return;
    const {data,error}=await supabase.from("studio_schedule_class_candidates").select("*").eq("status","pending").order("created_at",{ascending:false}).limit(100);
    if(error)Alert.alert("구조화 시간표 후보 조회 실패",error.message);
    else {const rows=data||[];setScheduleClassCandidates(rows);setCandidateTitles(Object.fromEntries(rows.map((row:any)=>[row.id,row.proposed_title])));setCandidateSessions(Object.fromEntries(rows.map((row:any)=>[row.id,(Array.isArray(row.sessions)?row.sessions:[]).map((x:any)=>[x.weekday,x.start_time,(x.end_time||""),x.note||""].join(",")).join("\n")])));}
  },[authorized]);

  useEffect(()=>{
    if(adminTab==="overview"){loadDashboard();loadReports();}
    else if(adminTab==="review"||adminTab==="publish"){loadEvidence();if(adminTab==="publish")loadScheduleClassCandidates();}
    else if(adminTab==="studios")load();
  },[adminTab,loadDashboard,loadReports,loadEvidence,loadScheduleClassCandidates,load]);

  const generateScheduleClassCandidate=async(item:EvidenceCandidate)=>{
    if(!supabase||item.review_status!=="verified"||item.candidate_type!=="schedule")return;
    const sourceDate=item.source_post_date;
    const expiry=sourceDate?datePlusDays(sourceDate,45):null;
    if(!sourceDate||!expiry||expiry<seoulDate()){
      Alert.alert("최신 자료 확인","원문 게시일이 없거나 45일이 지난 자료는 시간표 후보로 만들지 않습니다.");return;
    }
    const raw=(item.normalized_value||item.candidate_value||"")+" "+(item.evidence_text||"");
    const parsed=parseScheduleEvidence(raw);
    if(!parsed){Alert.alert("자동 구조화 불가","요일과 시간을 함께 확인할 수 있는 표현이 없습니다. 원문을 확인하고 수업 관리에서 수동 등록해 주세요.");return;}
    setEvidenceBusy(true);
    try{
      const {data:existing,error:checkError}=await supabase.from("studio_schedule_class_candidates").select("id").eq("evidence_candidate_id",item.id).maybeSingle();
      if(checkError)throw checkError;
      if(existing){Alert.alert("이미 생성됨","이 근거로 구조화 후보가 이미 생성되어 있습니다.");await loadScheduleClassCandidates();return;}
      const {error}=await supabase.from("studio_schedule_class_candidates").insert({
        evidence_candidate_id:item.id,studio_id:item.studio_id,studio_name:item.studio_name,
        source_title:item.source_title,source_url:item.source_url,source_post_date:sourceDate,
        source_text:raw,proposed_title:parsed.proposed_title,audience:parsed.audience,
        proposed_level:parsed.proposed_level,proposed_class_type:parsed.proposed_class_type,sessions:parsed.sessions,status:"pending"
      });
      if(error)throw error;
      Alert.alert("후보 생성 완료","요일과 시간을 추출했습니다. 수업명과 시간표를 확인한 뒤 등록해 주세요.");
      await loadScheduleClassCandidates();
    }catch(e:any){Alert.alert("후보 생성 실패",e.message||"구조화 후보를 저장하지 못했습니다.");}
    finally{setEvidenceBusy(false);}
  };

  const createClassFromScheduleCandidate=async(candidate:any)=>{
    const client=supabase;
    if(!client)return;
    const title=(candidateTitles[candidate.id]||candidate.proposed_title||"").trim();
    const rawSessions=candidateSessions[candidate.id]??(Array.isArray(candidate.sessions)?candidate.sessions.map((x:any)=>[x.weekday,x.start_time,x.end_time||"",x.note||""].join(",")).join("\n"):"");
    const sessions=rawSessions.split(/\r?\n/).map(line=>line.trim()).filter(Boolean).map(line=>{const parts=line.split(",").map(v=>v.trim());const weekday=Number(parts[0]);const start_time=parts[1]||"";const end_time=parts[2]||null;const note=parts.slice(3).join(",").trim()||null;if(!parts[0]||!Number.isInteger(weekday)||weekday<0||weekday>6||!/^([01]\d|2[0-3]):[0-5]\d$/.test(start_time)||(end_time&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(end_time))||(end_time&&end_time<=start_time))return null;return {weekday,start_time,end_time,note};});
    if(!title||!sessions.length||sessions.length>28||sessions.some((x:any)=>x===null)){Alert.alert("시간표 확인","수업명과 시간표가 필요합니다. 각 줄을 요일번호,시작시간,종료시간,메모 형식으로 입력하고 시간은 24시간 HH:MM로 작성해 주세요. 종료시간은 비워둘 수 있습니다.");return;}
    const duplicateKeys=new Set<string>();for(const item of sessions as any[]){const key=item.weekday+"|"+item.start_time;if(duplicateKeys.has(key)){Alert.alert("중복 시간표","같은 요일과 시작시간이 중복되어 있습니다.");return;}duplicateKeys.add(key);}
    Alert.alert("실제 수업 등록 확인",candidate.studio_name+" · "+title+"\n"+sessions.map((x:any)=>["일","월","화","수","목","금","토"][x.weekday]+" "+x.start_time+(x.end_time?"~"+x.end_time:"")).join("\n")+"\n원문과 비교하여 현재 운영 시간표가 맞는지 확인했습니까?",[
      {text:"취소",style:"cancel"},
      {text:"확인 후 등록",onPress:async()=>{
        setEvidenceBusy(true);
        let createdClassId:string|null=null;
        try{
          const {data:claim,error:claimError}=await client.from("studio_schedule_class_candidates").update({status:"creating",sessions}).eq("id",candidate.id).eq("status","pending").select("id").maybeSingle();
          if(claimError)throw claimError;
          if(!claim){Alert.alert("이미 처리 중","다른 요청에서 이 후보를 처리했거나 상태가 변경되었습니다.");return;}
          const {data:classData,error:classError}=await client.from("classes").insert({
            studio_id:candidate.studio_id,title,audience:candidate.audience||"all",
            level:candidate.proposed_level||null,class_type:candidate.proposed_class_type||null,
            duration_minutes:null,price:null,is_active:true
          }).select("id").single();
          if(classError)throw classError;
          createdClassId=classData.id;
          const sessionPayload=sessions.map((session:any)=>({class_id:createdClassId,weekday:session.weekday,start_time:session.start_time,end_time:session.end_time||null,note:session.note||null,is_active:true}));
          const {error:sessionError}=await client.from("class_sessions").insert(sessionPayload);
          if(sessionError)throw sessionError;
          const {data:marked,error:updateError}=await client.from("studio_schedule_class_candidates").update({status:"created",created_class_id:createdClassId,reviewed_by:session?.user?.id||null,reviewed_at:new Date().toISOString()}).eq("id",candidate.id).eq("status","creating").select("id").maybeSingle();
          if(updateError)throw updateError;
          if(!marked)throw new Error("후보 상태 변경에 실패했습니다. 수업 등록을 되돌립니다.");
          Alert.alert("등록 완료","확인한 시간표를 실제 수업 및 요일별 세션으로 등록했습니다.");
          await loadScheduleClassCandidates();
          if(classStudio?.id===candidate.studio_id)await loadClasses(candidate.studio_id);
        }catch(error:any){
          if(createdClassId)await client.from("classes").delete().eq("id",createdClassId);
          await client.from("studio_schedule_class_candidates").update({status:"pending"}).eq("id",candidate.id).eq("status","creating");
          Alert.alert("수업 등록 실패",error.message||"등록 중 오류가 발생했습니다.");
        }
        finally{setEvidenceBusy(false);}
      }}
    ]);
  };
  const rejectScheduleClassCandidate=async(candidate:any)=>{
    if(!supabase)return;
    const {error}=await supabase.from("studio_schedule_class_candidates").update({status:"rejected",reviewed_by:session?.user?.id||null,reviewed_at:new Date().toISOString()}).eq("id",candidate.id);
    if(error)Alert.alert("제외 실패",error.message);else await loadScheduleClassCandidates();
  };

  const checkOcrAvailability=async()=>{
    setOcrBusy(true);
    const module=await loadOcrModule();
    setOcrAvailability(module&&module.isSupported?"available":"unavailable");
    setOcrBusy(false);
  };

  const loadOcr=useCallback(async()=>{
    if(!supabase||!authorized)return;
    const {data,error}=await supabase.from("studio_image_ocr_results").select("id,studio_id,studio_name,source_id,image_url,source_url,source_post_date,image_label,extracted_text,detected_kind,amount_krw,price_period,frequency_per_week,schedule_days,schedule_time,review_status,created_at").eq("review_status","pending").order("created_at",{ascending:false}).limit(100);
    if(error)Alert.alert("OCR 결과 조회 실패",error.message);else {setOcrRows(data||[]);setSelectedOcrIds(ids=>ids.filter(id=>(data||[]).some((row:any)=>row.id===id)));}
  },[authorized]);

  useEffect(()=>{if(adminTab==="review")loadOcr();},[adminTab,loadOcr]);
  const runLocalOcr=async(id:string,name:string)=>{
    if(!supabase)return;
    const ocr=await loadOcrModule();if(!ocr)return;
    const permission=await ImagePicker.requestMediaLibraryPermissionsAsync();
    if(!permission.granted){Alert.alert("사진 권한","사진 보관함 접근 권한을 허용해 주세요.");return;}
    const picked=await ImagePicker.launchImageLibraryAsync({mediaTypes:["images"],allowsMultipleSelection:true,selectionLimit:2,quality:0.8});
    if(picked.canceled||!picked.assets?.length)return;
    setOcrBusy(true);let saved=0;
    try{
      for(let i=0;i<picked.assets.length;i++){
        const asset=picked.assets[i];
        const resized=await ImageManipulator.manipulateAsync(asset.uri,[ {resize:{width:1500}} ],{compress:0.72,format:ImageManipulator.SaveFormat.JPEG});
        let lines:any[]=[];
        try{lines=await ocr.extractTextFromImage(resized.uri,Platform.OS==="android"?{script:ocr.TextRecognitionScript.KOREAN}:{languages:["ko-KR","en-US"]});}finally{await FileSystem.deleteAsync(resized.uri,{idempotent:true}).catch(()=>{});}
        const extracted=(lines||[]).join("\n").trim();if(!extracted)continue;
        const priceHit=/(원|만원|천원|회권|수강료|월\s*\d+회|등록비|개월권)/i.test(extracted);
        const scheduleHit=/(월|화|수|목|금|토|일)요일|\b(월|화|수|목|금|토|일)\b|오전|오후|\d{1,2}:\d{2}|시간표|타임/i.test(extracted);
        const detected_kind=priceHit&&scheduleHit?"unknown":priceHit?"price":scheduleHit?"schedule":"unknown";
        const {error}=await supabase.from("studio_image_ocr_results").insert({studio_id:id,studio_name:name,image_label:asset.fileName||("선택 이미지 "+(i+1)),extracted_text:extracted,detected_kind,created_by:session?.user?.id||null});
        if(error)throw error;saved++;
      }
      await loadOcr();Alert.alert("기기 내 OCR 완료",name+" · "+saved+"개 이미지의 글자를 추출했습니다. 원본 이미지는 서버로 전송하지 않았습니다.");
    }catch(error:any){Alert.alert("OCR 처리 실패",error?.message||"이미지 형식 또는 OCR 모듈 상태를 확인해 주세요.");}
    finally{setOcrBusy(false);}
  };

  const runBlogImageOcr=async(id:string,name:string)=>{
    if(!supabase)return;
    const ocr=await loadOcrModule();if(!ocr)return;
    if(!FileSystem.cacheDirectory){Alert.alert("임시 저장소 오류","기기 임시 저장소를 사용할 수 없습니다.");return;}
    setOcrBusy(true);
    let processed=0,skipped=0,failed=0;
    try{
      const posts=await fetchStudioBlogPosts(id);
      const candidates=posts.flatMap(post=>(post.image_urls||[]).filter(url=>/^https:\/\//i.test(url)).map(url=>({source_id:post.source_id,source_url:post.post_url,post_date:post.post_date,title:post.title,image_url:url})));
      if(!candidates.length){Alert.alert("블로그 이미지 없음",name+"에서 OCR 가능한 공개 블로그 이미지가 확인되지 않았습니다.");return;}
      const {data:existing,error:existingError}=await supabase.from("studio_image_ocr_results").select("source_id,image_url").eq("studio_id",id).not("image_url","is",null).limit(1000);
      if(existingError)throw existingError;
      const seen=new Set((existing||[]).map((x:any)=>String(x.source_id)+"|"+x.image_url));
      const todo=candidates.filter(x=>!seen.has(String(x.source_id)+"|"+x.image_url)).slice(0,2);
      skipped=candidates.length-todo.length;
      if(!todo.length){Alert.alert("추가 OCR 없음",name+"의 기존 블로그 이미지는 모두 OCR 처리됐습니다. 새 블로그 게시물이 수집되면 다시 실행해 주세요.");return;}
      const dir=FileSystem.cacheDirectory+"balletmate-ocr/";
      const dirInfo=await FileSystem.getInfoAsync(dir);
      if(!dirInfo.exists)await FileSystem.makeDirectoryAsync(dir,{intermediates:true});
      for(let i=0;i<todo.length;i++){
        const item=todo[i];
        let localUri:string|null=null;
        try{
          const ext=(item.image_url.split("?")[0].match(/\.(png|webp|jpeg|jpg)$/i)?.[1]||"jpg").toLowerCase();
          localUri=dir+"studio-"+id+"-source-"+item.source_id+"-"+i+"."+ext;
          const downloaded=await FileSystem.downloadAsync(item.image_url,localUri,{headers:{"User-Agent":"Mozilla/5.0 BalletmateImageOCR"}});
          if(downloaded.status<200||downloaded.status>=300)throw new Error("이미지 다운로드 HTTP "+downloaded.status);
          const resized=await ImageManipulator.manipulateAsync(downloaded.uri,[ {resize:{width:1500}} ],{compress:0.72,format:ImageManipulator.SaveFormat.JPEG});
          let lines:any[]=[];
          try{lines=await ocr.extractTextFromImage(resized.uri,Platform.OS==="android"?{script:ocr.TextRecognitionScript.KOREAN}:{languages:["ko-KR","en-US"]});}finally{await FileSystem.deleteAsync(resized.uri,{idempotent:true}).catch(()=>{});}
          const extracted=(lines||[]).join("\n").trim();
          if(extracted.length<3){skipped++;continue;}
          const parsed=parseOcrFields(extracted);
          const {error}=await supabase.from("studio_image_ocr_results").upsert({
            studio_id:id,studio_name:name,source_id:item.source_id,image_url:item.image_url,source_url:item.source_url,source_post_date:item.post_date||null,
            image_label:item.title||("블로그 게시물 "+item.source_id),extracted_text:extracted,
            detected_kind:parsed.detected_kind,amount_krw:parsed.amount_krw,price_period:parsed.price_period,
            frequency_per_week:parsed.frequency_per_week,schedule_days:parsed.schedule_days,schedule_time:parsed.schedule_time,
            created_by:session?.user?.id||null
          },{onConflict:"source_id,image_url",ignoreDuplicates:true});
          if(error)throw error;
          processed++;
        }catch(imageError){failed++;}
        finally{if(localUri)await FileSystem.deleteAsync(localUri,{idempotent:true}).catch(()=>{});}
      }
      await loadOcr();
      Alert.alert("블로그 이미지 OCR 완료",name+"\n새로 처리: "+processed+"장 · 글자 없음/중복: "+skipped+"장 · 실패: "+failed+"장\n이미지 파일은 기기 임시 저장소에서만 처리했습니다.");
    }catch(error:any){Alert.alert("블로그 OCR 실패",error?.message||"블로그 이미지 조회 또는 OCR 처리에 실패했습니다.");}
    finally{setOcrBusy(false);}
  };


  const runBatchBlogImageOcr=async()=>{
    if(!supabase)return;
    const ocr=await loadOcrModule();if(!ocr)return;
    if(!FileSystem.cacheDirectory){Alert.alert("임시 저장소 오류","기기 임시 저장소를 사용할 수 없습니다.");return;}
    if(!rows.length){Alert.alert("학원 데이터 없음","먼저 학원 목록을 새로고침해 주세요.");return;}
    setOcrBusy(true);
    let processed=0,skipped=0,failed=0,checkedStudios=0;
    try{
      const scanCount=Math.min(12,rows.length);
      const selected=Array.from({length:scanCount},(_,i)=>rows[(batchOcrOffset+i)%rows.length]);
      setBatchOcrOffset((batchOcrOffset+scanCount)%rows.length);
      const buckets:Array<{studio:StudioRow;items:any[]}>= [];
      for(const studio of selected){
        try{
          const posts=await fetchStudioBlogPosts(studio.id);
          const items=posts.flatMap(post=>(post.image_urls||[])
            .filter(url=>/^https:\/\//i.test(url))
            .map(url=>({studio_id:studio.id,studio_name:studio.name,source_id:post.source_id,source_url:post.post_url,post_date:post.post_date,title:post.title,image_url:url})));
          if(items.length)buckets.push({studio,items});
        }catch(error){failed++;}
        checkedStudios++;
      }
      if(!buckets.length){Alert.alert("OCR 대상 없음","이번 차례에 확인한 "+checkedStudios+"개 학원에서 블로그 이미지 자료를 찾지 못했습니다.");return;}
      const studioIds=buckets.map(bucket=>bucket.studio.id);
      const existing:any[]=[];
      for(let offset=0;;offset+=1000){
        const {data,error}=await supabase.from("studio_image_ocr_results")
          .select("studio_id,source_id,image_url").in("studio_id",studioIds).not("image_url","is",null)
          .order("source_id",{ascending:true}).range(offset,offset+999);
        if(error)throw error;
        existing.push(...(data||[]));
        if(!data||data.length<1000)break;
      }
      const seen=new Set(existing.map((item:any)=>item.studio_id+"|"+item.source_id+"|"+item.image_url));
      const candidateSeen=new Set<string>();
      const todo:any[]=[];
      let cursor=0;
      while(todo.length<3&&buckets.some(bucket=>bucket.items.length)){
        const bucket=buckets[cursor%buckets.length];
        const item=bucket.items.shift();
        cursor++;
        if(!item)continue;
        const key=item.studio_id+"|"+item.source_id+"|"+item.image_url;
        if(seen.has(key)||candidateSeen.has(key)){skipped++;continue;}
        candidateSeen.add(key);todo.push(item);
      }
      skipped+=buckets.reduce((sum,bucket)=>sum+bucket.items.length,0);
      if(!todo.length){Alert.alert("추가 OCR 없음","이번에 확인한 "+checkedStudios+"개 학원의 블로그 이미지는 이미 처리됐습니다. 다음 실행에서는 다른 학원부터 확인합니다.");return;}
      const dir=FileSystem.cacheDirectory+"balletmate-ocr/";
      const dirInfo=await FileSystem.getInfoAsync(dir);
      if(!dirInfo.exists)await FileSystem.makeDirectoryAsync(dir,{intermediates:true});
      for(let i=0;i<todo.length;i++){
        const item=todo[i];let localUri:string|null=null;
        try{
          const ext=(item.image_url.split("?")[0].match(/\.(png|webp|jpeg|jpg)$/i)?.[1]||"jpg").toLowerCase();
          localUri=dir+"batch-"+item.source_id+"-"+i+"."+ext;
          const downloaded=await FileSystem.downloadAsync(item.image_url,localUri,{headers:{"User-Agent":"Mozilla/5.0 BalletmateImageOCR"}});
          if(downloaded.status<200||downloaded.status>=300)throw new Error("이미지 다운로드 HTTP "+downloaded.status);
          const resized=await ImageManipulator.manipulateAsync(downloaded.uri,[ {resize:{width:1500}} ],{compress:0.72,format:ImageManipulator.SaveFormat.JPEG});
          let lines:any[]=[];
          try{lines=await ocr.extractTextFromImage(resized.uri,Platform.OS==="android"?{script:ocr.TextRecognitionScript.KOREAN}:{languages:["ko-KR","en-US"]});}finally{await FileSystem.deleteAsync(resized.uri,{idempotent:true}).catch(()=>{});}
          const extracted=(lines||[]).join("\n").trim();
          if(extracted.length<3){skipped++;continue;}
          const parsed=parseOcrFields(extracted);
          const {error}=await supabase.from("studio_image_ocr_results").upsert({
            studio_id:item.studio_id,studio_name:item.studio_name,source_id:item.source_id,image_url:item.image_url,source_url:item.source_url,source_post_date:item.post_date||null,
            image_label:item.title||("블로그 게시물 "+item.source_id),extracted_text:extracted,
            detected_kind:parsed.detected_kind,amount_krw:parsed.amount_krw,price_period:parsed.price_period,
            frequency_per_week:parsed.frequency_per_week,schedule_days:parsed.schedule_days,schedule_time:parsed.schedule_time,
            created_by:session?.user?.id||null
          },{onConflict:"source_id,image_url",ignoreDuplicates:true});
          if(error)throw error;
          processed++;
        }catch(imageError){failed++;}
        finally{if(localUri)await FileSystem.deleteAsync(localUri,{idempotent:true}).catch(()=>{});}
      }
      await loadOcr();
      Alert.alert("일괄 블로그 OCR 완료","학원 확인: "+checkedStudios+"곳\n새로 처리: "+processed+"장 · 글자 없음/중복: "+skipped+"장 · 실패: "+failed+"장\n1회 최대 3장으로 제한해 처리했습니다.");
    }catch(error:any){Alert.alert("일괄 OCR 실패",error?.message||"블로그 이미지 조회 또는 OCR 처리에 실패했습니다.");}
    finally{setOcrBusy(false);}
  };

  const forwardOcrToEvidence=async(item:any)=>{
    if(!supabase)return;
    if(!item.source_id||!item.source_url){Alert.alert("원문 정보 없음","블로그 게시물과 연결된 OCR 결과만 검토 대기열로 전달할 수 있습니다.");return;}
    const amount=Number(item.amount_krw);
    const isPrice=Number.isInteger(amount)&&amount>0;
    const scheduleDays=Array.isArray(item.schedule_days)?item.schedule_days:[];
    const isSchedule=scheduleDays.length>0||!!item.schedule_time;
    const candidates:any[]=[];
    if(isPrice){
      const structured=amount.toLocaleString("en-US")+"원 · "+(item.price_period||"기간 미확인")+(item.frequency_per_week?" · 주 "+item.frequency_per_week+"회":"");
      candidates.push({
        studio_id:item.studio_id,studio_name:item.studio_name,source_id:item.source_id,
        source_title:item.image_label,source_url:item.source_url,source_post_date:item.source_post_date||null,candidate_type:"price",
        candidate_value:"OCR#"+item.id+" "+structured,normalized_value:String(amount),
        price_period:item.price_period||"기간 미확인",
        price_frequency_per_week:item.frequency_per_week||null,
        evidence_text:item.extracted_text,confidence:0.55,review_status:"pending"
      });
    }
    if(isSchedule){
      const structured=(scheduleDays.length?scheduleDays.join("·"):"요일 미확인")+(item.schedule_time?" · "+item.schedule_time:"");
      candidates.push({
        studio_id:item.studio_id,studio_name:item.studio_name,source_id:item.source_id,
        source_title:item.image_label,source_url:item.source_url,source_post_date:item.source_post_date||null,candidate_type:"schedule",
        candidate_value:"OCR#"+item.id+" "+structured,normalized_value:structured,
        price_period:"기간 미확인",price_frequency_per_week:null,
        evidence_text:item.extracted_text,confidence:0.55,review_status:"pending"
      });
    }
    if(!candidates.length){Alert.alert("후보 분류 불가","가격 금액이나 요일·시간을 확인하지 못해 검토 대기열로 전달할 수 없습니다.");return;}
    setEvidenceBusy(true);
    try{
      const {error}=await supabase.from("studio_blog_evidence_candidates").upsert(candidates,{onConflict:"source_id,candidate_type,candidate_value",ignoreDuplicates:true});
      if(error)throw error;
      const {error:updateError}=await supabase.from("studio_image_ocr_results").update({
        review_status:"verified",reviewed_by:session?.user?.id||null,reviewed_at:new Date().toISOString()
      }).eq("id",item.id);
      if(updateError)throw updateError;
      setOcrRows(current=>current.filter(row=>row.id!==item.id));
      await loadEvidence();
      Alert.alert("검토 대기열 전달 완료",candidates.length+"개 유형의 OCR 근거를 검토 목록으로 보냈습니다. 앱에 자동 공개되지는 않았습니다.");
    }catch(error:any){Alert.alert("전달 실패",error?.message||"근거 후보 저장에 실패했습니다.");}
    finally{setEvidenceBusy(false);}
  };


  const reviewOcrBatch=async(status:"verified"|"rejected")=>{
    if(!supabase||!selectedOcrIds.length)return;
    const {error}=await supabase.from("studio_image_ocr_results").update({review_status:status,reviewed_by:session?.user?.id||null,reviewed_at:new Date().toISOString()}).in("id",selectedOcrIds);
    if(error)Alert.alert("OCR 일괄 검토 실패",error.message);
    else {setOcrRows(rows=>rows.filter(row=>!selectedOcrIds.includes(row.id)));setSelectedOcrIds([]);Alert.alert("OCR 검토 완료",selectedOcrIds.length+"개 결과를 "+(status==="verified"?"확인":"제외")+" 처리했습니다.");}
  };

  const reviewOcr=async(item:any,status:"verified"|"rejected")=>{
    if(!supabase)return;
    const {error}=await supabase.from("studio_image_ocr_results").update({review_status:status,reviewed_by:session?.user?.id||null,reviewed_at:new Date().toISOString()}).eq("id",item.id);
    if(error)Alert.alert("OCR 검토 저장 실패",error.message);else setOcrRows(current=>current.filter(row=>row.id!==item.id));
  };


  const reviewEvidence=async(item:EvidenceCandidate,status:"verified"|"rejected")=>{
    if(!supabase)return;
    setEvidenceBusy(true);
    const {error}=await supabase.from("studio_blog_evidence_candidates").update({
      review_status:status,reviewed_by:session?.user?.id||null,reviewed_at:new Date().toISOString(),
    }).eq("id",item.id);
    if(error)Alert.alert("검토 상태 저장 실패",error.message);
    else {
      setEvidenceRows(current=>current.filter(row=>row.id!==item.id));
      if(status==="verified"){
        const verifiedItem:EvidenceCandidate={...item,review_status:"verified"};
        if(item.candidate_type==="price")setVerifiedPriceRows(current=>[verifiedItem,...current]);
        if(item.candidate_type==="schedule")setVerifiedScheduleRows(current=>[verifiedItem,...current]);
      }
    }
    setEvidenceBusy(false);
  };
  const reviewEvidenceBatch=async(status:"verified"|"rejected")=>{
    if(!supabase||!selectedEvidenceIds.length)return;
    setEvidenceBusy(true);
    const selected=evidenceRows.filter(row=>selectedEvidenceIds.includes(row.id));
    const {error}=await supabase.from("studio_blog_evidence_candidates").update({review_status:status,reviewed_by:session?.user?.id||null,reviewed_at:new Date().toISOString()}).in("id",selectedEvidenceIds);
    if(error)Alert.alert("일괄 검토 저장 실패",error.message);
    else{
      setEvidenceRows(rows=>rows.filter(row=>!selectedEvidenceIds.includes(row.id)));
      if(status==="verified"){
        setVerifiedPriceRows(rows=>[...selected.filter(row=>row.candidate_type==="price").map(row=>({...row,review_status:"verified" as const})),...rows]);
        setVerifiedScheduleRows(rows=>[...selected.filter(row=>row.candidate_type==="schedule").map(row=>({...row,review_status:"verified" as const})),...rows]);
      }
      setSelectedEvidenceIds([]);
      Alert.alert("일괄 검토 완료",selected.length+"개 자료를 "+(status==="verified"?"근거 확인":"제외")+" 처리했습니다.");
    }
    setEvidenceBusy(false);
  };

  const deactivatePublicPrice=async(price:any)=>{
    if(!supabase)return;
    Alert.alert("가격 공개 중단","이 가격을 앱에서 더 이상 표시하지 않을까요?",[
      {text:"취소",style:"cancel"},
      {text:"공개 중단",style:"destructive",onPress:async()=>{
        setEvidenceBusy(true);
        const {error}=await supabase!.from("studio_public_prices").update({is_active:false}).eq("id",price.id);
        if(error)Alert.alert("공개 중단 실패",error.message);
        else {setActivePublicPrices(current=>current.filter(row=>row.id!==price.id));Alert.alert("처리 완료","해당 가격을 앱 공개 목록에서 제외했습니다.");}
        setEvidenceBusy(false);
      }}
    ]);
  };

  const deactivatePublicSchedule=async(schedule:any)=>{
    if(!supabase)return;
    Alert.alert("시간표 공개 중단","이 시간표 자료를 앱에서 더 이상 표시하지 않을까요?",[
      {text:"취소",style:"cancel"},
      {text:"공개 중단",style:"destructive",onPress:async()=>{
        setEvidenceBusy(true);
        const {error}=await supabase!.from("studio_public_schedules").update({is_active:false}).eq("id",schedule.id);
        if(error)Alert.alert("공개 중단 실패",error.message);
        else {setActivePublicSchedules(current=>current.filter(row=>row.id!==schedule.id));Alert.alert("처리 완료","해당 시간표 자료를 앱 공개 목록에서 제외했습니다.");}
        setEvidenceBusy(false);
      }}
    ]);
  };

  const publishSchedule=async(item:EvidenceCandidate)=>{
    if(!supabase||item.candidate_type!=="schedule")return;
    if(item.review_status!=="verified"){Alert.alert("검증 필요","관리자가 근거를 확인한 시간표만 공개할 수 있습니다.");return;}
    const scheduleText=(item.normalized_value||item.candidate_value||"").replace(/^OCR#\d+\s*/i,"").trim();
    if(scheduleText.length<2||!item.source_url||!item.evidence_text){
      Alert.alert("공개할 수 없는 시간표","시간표 내용과 원문 근거가 확인되는 자료만 공개할 수 있습니다.");return;
    }
    setEvidenceBusy(true);
    try{
      const sourcePostDate=item.source_post_date||null;
      const today=seoulDate();
      const expiresAt=datePlusDays(sourcePostDate||today,sourcePostDate?45:30);
      if(!expiresAt)throw new Error("만료일을 계산하지 못했습니다.");
      if(sourcePostDate&&expiresAt<today){Alert.alert("오래된 시간표","원문 게시일로부터 45일이 지나 최신 시간표로 공개하지 않았습니다. 최신 자료를 다시 수집해 주세요.");return;}
      if(!sourcePostDate){const confirmed=await new Promise<boolean>(resolve=>Alert.alert("게시일 미확인 시간표","원문 게시일이 확인되지 않습니다. 원문을 직접 확인하고 현재 운영 중인 시간표임을 확인한 경우에만 공개하세요. 게시일 미확인 상태로 30일 후 자동 만료됩니다.",[{text:"취소",style:"cancel",onPress:()=>resolve(false)},{text:"확인했고 공개",onPress:()=>resolve(true)}]));if(!confirmed)return;}
      const {error}=await supabase.from("studio_public_schedules").insert({
        candidate_id:item.id,studio_id:item.studio_id,schedule_text:scheduleText,
        evidence_text:item.evidence_text,source_title:item.source_title,source_url:item.source_url,
        source_post_date:sourcePostDate,expires_at:expiresAt,
        published_by:session?.user?.id||null,is_active:true,
      });
      if(error)throw error;
      Alert.alert("시간표 공개 완료",item.studio_name+"의 관리자 확인 시간표 자료를 공개했습니다.");
      await loadEvidence();
    }catch(error:any){Alert.alert("시간표 공개 실패",error?.message||"시간표 자료를 저장하지 못했습니다.");}
    finally{setEvidenceBusy(false);}
  };

  const publishScheduleBatch=async()=>{
    if(!supabase||!selectedScheduleIds.length)return;
    const selected=verifiedScheduleRows.filter(row=>selectedScheduleIds.includes(row.id)&&!publishedScheduleCandidateIds.includes(row.id));
    const today=seoulDate();
    const old=selected.filter(row=>row.source_post_date&&datePlusDays(row.source_post_date,45)!==null&&datePlusDays(row.source_post_date,45)!<today);
    const valid=selected.filter(row=>!row.source_post_date||(datePlusDays(row.source_post_date,45)!==null&&datePlusDays(row.source_post_date,45)!>=today));
    if(!valid.length){Alert.alert("공개할 자료 없음",old.length+"개 자료가 45일 초과로 만료되었습니다.");return;}
    const noDate=valid.filter(row=>!row.source_post_date).length;
    Alert.alert("시간표 일괄 공개","선택 "+selected.length+"개 중 공개 대상 "+valid.length+"개"+(old.length?"\n45일 초과 제외 "+old.length+"개":"")+(noDate?"\n게시일 미확인 "+noDate+"개 (원문 직접 확인 전제, 30일 만료)":"")+"\n일괄 공개할까요?",[{text:"취소",style:"cancel"},{text:"공개",onPress:async()=>{
      setEvidenceBusy(true);let ok=0,failed=0;
      for(const item of valid){
        const sourcePostDate=item.source_post_date||null;
        const expiry=datePlusDays(sourcePostDate||today,sourcePostDate?45:30);
        const textValue=(item.normalized_value||item.candidate_value||"").replace(/^OCR#\d+\s*/i,"").trim();
        if(!textValue||!item.source_url||!item.evidence_text||!expiry){failed++;continue;}
        const {error}=await supabase!.from("studio_public_schedules").insert({candidate_id:item.id,studio_id:item.studio_id,schedule_text:textValue,evidence_text:item.evidence_text,source_title:item.source_title,source_url:item.source_url,source_post_date:sourcePostDate,expires_at:expiry,published_by:session?.user?.id||null,is_active:true});
        if(error)failed++;else{ok++;setPublishedScheduleCandidateIds(ids=>[...ids,item.id]);}
      }
      setSelectedScheduleIds([]);await loadEvidence();setEvidenceBusy(false);
      Alert.alert("일괄 공개 결과",ok+"개 공개 성공"+(failed?" / "+failed+"개 실패":""));
    }}]);
  };
  const publishPrice=async(item:EvidenceCandidate)=>{
    if(!supabase)return;
    const amount=Number(item.normalized_value);
    if(item.candidate_type!=="price"||item.review_status!=="verified"||!Number.isInteger(amount)||amount<=0||!item.price_period||item.price_period==="기간 미확인"){
      Alert.alert("공개할 수 없는 가격","관리자가 검증했고 가격 금액과 이용 기간이 명확한 자료만 공개할 수 있습니다.");return;
    }
    setEvidenceBusy(true);
    try{
      const sourcePostDate=item.source_post_date||null;
      if(!sourcePostDate){Alert.alert("원문 게시일 확인 필요","게시일을 확인할 수 없는 자료는 최신 여부를 보장할 수 없어 공개하지 않습니다.");return;}
      const expiresAt=null;
      const {error}=await supabase.from("studio_public_prices").insert({
        candidate_id:item.id,studio_id:item.studio_id,amount_krw:amount,
        price_period:item.price_period,frequency_per_week:item.price_frequency_per_week||null,
        evidence_text:item.evidence_text,source_title:item.source_title,source_url:item.source_url,
        source_post_date:sourcePostDate,expires_at:expiresAt,
        published_by:session?.user?.id||null,is_active:true,
      });
      if(error)throw error;
      setPublishedCandidateIds(current=>[...current,item.id]);
      Alert.alert("가격 공개 완료",item.studio_name+"의 검증 가격을 공개 목록에 추가했습니다.");
      await loadEvidence();
    }catch(error:any){Alert.alert("가격 공개 실패",error?.message||"가격 자료를 저장하지 못했습니다.");}
    finally{setEvidenceBusy(false);}
  };

  const publishPriceBatch=async()=>{
    if(!supabase||!selectedPriceIds.length)return;
    const selected=verifiedPriceRows.filter(row=>selectedPriceIds.includes(row.id)&&!publishedCandidateIds.includes(row.id));
    const valid=selected.filter(item=>{
      const amount=Number(item.normalized_value);
      return item.candidate_type==="price"&&Number.isInteger(amount)&&amount>0&&!!item.price_period&&item.price_period!=="기간 미확인"&&!!item.source_post_date&&!!item.source_url&&!!item.evidence_text;
    });
    if(!valid.length){Alert.alert("공개할 자료 없음","가격·이용 기간·원문 게시일·원문 근거가 확인되는 자료가 없습니다.");return;}
    Alert.alert("가격 일괄 공개","선택 "+selected.length+"개 중 공개 가능한 "+valid.length+"개를 등록할까요?",[{text:"취소",style:"cancel"},{text:"공개",onPress:async()=>{
      setEvidenceBusy(true);let ok=0,failed=0;
      for(const item of valid){
        const expiry=null;
        const {error}=await supabase!.from("studio_public_prices").insert({
          candidate_id:item.id,studio_id:item.studio_id,amount_krw:Number(item.normalized_value),
          price_period:item.price_period,frequency_per_week:item.price_frequency_per_week||null,
          evidence_text:item.evidence_text,source_title:item.source_title,source_url:item.source_url,
          source_post_date:item.source_post_date,expires_at:expiry,
          published_by:session?.user?.id||null,is_active:true,
        });
        if(error)failed++;else{ok++;setPublishedCandidateIds(ids=>[...ids,item.id]);}
      }
      setSelectedPriceIds([]);await loadEvidence();setEvidenceBusy(false);
      Alert.alert("일괄 공개 결과",ok+"개 공개 성공"+(failed?" / "+failed+"개 실패":""));
    }}]);
  };

  const login=async()=>{
    if(!supabase)return;
    setBusy(true);
    const normalized=username.trim().toLowerCase();
    if(!/^[a-z0-9_]{3,24}$/.test(normalized)){Alert.alert("아이디 확인","아이디는 영문 소문자, 숫자, 밑줄로 3~24자 입력하세요.");setBusy(false);return;}
    const {data,error}=await supabase.auth.signInWithPassword({email:normalized+"@balletmate.app",password});
    if(error)Alert.alert("로그인 실패",error.message);else {setSession(data.session);await checkAdmin(data.session);}
    setBusy(false);
  };
  const logout=async()=>{await supabase?.auth.signOut();setSession(null);setAuthorized(false);};
  const startEdit=(r:StudioRow)=>{
    setEditing(r.id);setForm({name:r.name,latitude:String(r.latitude),longitude:String(r.longitude),district:r.district||"",address:r.address||"",phone:r.phone||"",website_url:r.website_url||"",source_url:r.source_url||"",source_name:r.source_name||"",verified_at:r.verified_at?r.verified_at.slice(0,10):"",image_urls:(r.image_urls||[]).join("\n"),image_source_name:r.image_source_name||"",image_usage_note:r.image_usage_note||"",price_per_class:r.price_per_class==null?"":String(r.price_per_class),adult_classes:r.adult_classes,kids_classes:r.kids_classes,is_active:r.is_active});
  };
  const visibleStudioRows=rows.filter(row=>{
    const q=studioSearch.trim().toLowerCase();
    if(q&&!([row.name,row.district||"",row.address||"",row.phone||""].some(value=>value.toLowerCase().includes(q))))return false;
    if(studioListFilter==="missing_photo"&&(row.image_urls||[]).length>0)return false;
    if(studioListFilter==="missing_website"&&!!row.website_url)return false;
    if(studioListFilter==="website_candidate"&&!String(row.source_name||"").includes("홈페이지 검색 후보"))return false;
    if(studioListFilter==="active"&&!row.is_active)return false;
    if(studioListFilter==="inactive"&&row.is_active)return false;
    return true;
  });
  const reset=()=>{setEditing(null);setForm({...blank});};
  const save=async()=>{
    if(!supabase)return;
    if(!form.name.trim()||!form.latitude.trim()||!form.longitude.trim()){Alert.alert("필수 정보","학원명과 위도/경도를 입력하세요.");return;}
    if(form.website_url.trim()&&!/^https:\/\//i.test(form.website_url.trim())){Alert.alert("홈페이지 주소","공식 홈페이지는 https:// 주소로 입력하세요.");return;}
    if(form.source_url.trim()&&!/^https:\/\//i.test(form.source_url.trim())){Alert.alert("출처 주소","출처 URL은 https:// 주소로 입력하세요.");return;}
    const imageUrls=form.image_urls.split(/[\n,]+/).map(v=>v.trim()).filter(Boolean);
    if(imageUrls.length>10||imageUrls.some(v=>!/^https:\/\//i.test(v))){Alert.alert("사진 주소 확인","사진은 HTTPS 주소로 최대 10개까지 입력할 수 있습니다.");return;}
    const verifiedAt=form.verified_at.trim()?new Date(form.verified_at.trim()):null;
    if(verifiedAt&&!Number.isFinite(verifiedAt.getTime())){Alert.alert("확인 날짜","확인 날짜는 YYYY-MM-DD 형식으로 입력하세요.");return;}
    const lat=Number(form.latitude),lng=Number(form.longitude),price=form.price_per_class.trim()?Number(form.price_per_class):null;
    if(!Number.isFinite(lat)||lat < -90||lat > 90||!Number.isFinite(lng)||lng < -180||lng > 180|| (price!==null&&(!Number.isFinite(price)||price<0))){Alert.alert("입력 확인","좌표 또는 가격이 올바르지 않습니다.");return;}
    const payload={name:form.name.trim(),latitude:lat,longitude:lng,district:form.district.trim()||null,address:form.address.trim()||null,phone:form.phone.trim()||null,website_url:form.website_url.trim()||null,source_url:form.source_url.trim()||null,source_name:form.source_name.trim()||null,verified_at:verifiedAt?verifiedAt.toISOString():null,image_urls:imageUrls,image_source_name:form.image_source_name.trim()||(imageUrls.length&&!editing?"관리자 직접 등록":null),image_usage_note:form.image_usage_note.trim()||null,price_per_class:price,adult_classes:form.adult_classes,kids_classes:form.kids_classes,is_active:form.is_active,updated_at:new Date().toISOString()};
    setBusy(true);
    const q=editing?supabase.from("studios").update(payload).eq("id",editing):supabase.from("studios").insert(payload);
    const {error}=await q;
    if(error)Alert.alert("저장 실패",error.message);else{Alert.alert("저장 완료",form.is_active?"앱 공개 목록에 반영됩니다.":"비공개 상태로 저장했습니다.");reset();await load();}
    setBusy(false);
  };
  const crawlImages=async(id:string,name:string)=>{
    if(!supabase)return;
    setBusy(true);
    try{
      const {data,error}=await supabase.functions.invoke("crawl-studio",{body:{studioId:id}});
      if(error)Alert.alert("사진 수집 실패",error.message||"잠시 후 다시 시도해 주세요.");
      else if(data?.error)Alert.alert("사진 수집 실패",data.error);
      else{await supabase.from("studio_image_crawl_queue").update({status:"done",last_error:null,updated_at:new Date().toISOString()}).eq("studio_id",id);Alert.alert("사진 수집 완료",name+" · "+data.count+"개 이미지가 공식 홈페이지에서 확인되어 저장됐습니다.");await load();}
    }catch(error:any){Alert.alert("사진 수집 실패",error?.message||"연결 상태를 확인해 주세요.");}
    finally{setBusy(false);}
  };
  const uploadPhotos=async(id:string,name:string)=>{
    if(!supabase)return;
    const current=rows.find(r=>r.id===id);
    const existing=current?.image_urls||[];
    if(existing.length>=10){Alert.alert("사진 등록 한도","학원별 사진은 최대 10장까지 등록할 수 있습니다.");return;}
    const permission=await ImagePicker.requestMediaLibraryPermissionsAsync();
    if(!permission.granted){Alert.alert("사진 권한","사진 보관함 접근 권한을 허용해 주세요.");return;}
    const picked=await ImagePicker.launchImageLibraryAsync({mediaTypes:["images"],allowsMultipleSelection:true,selectionLimit:Math.min(10,10-existing.length),quality:0.82});
    if(picked.canceled||!picked.assets?.length)return;
    const assets=picked.assets.slice(0,10-existing.length);
    const uploadedPaths:string[]=[];
    setBusy(true);
    try{
      const urls:string[]=[];
      for(let i=0;i<assets.length;i++){
        const asset=assets[i];
        const mime=asset.mimeType||"image/jpeg";
        if(!["image/jpeg","image/png","image/webp"].includes(mime))throw new Error("JPG, PNG, WEBP 사진만 등록할 수 있습니다.");
        if((asset.fileSize||0)>5*1024*1024)throw new Error("사진 한 장의 용량은 5MB 이하여야 합니다.");
        const ext=mime==="image/png"?"png":mime==="image/webp"?"webp":"jpg";
        const path=id+"/"+Date.now()+"_"+i+"."+ext;
        const response=await fetch(asset.uri);
        if(!response.ok)throw new Error("선택한 사진 파일을 읽지 못했습니다.");
        const bytes=await response.arrayBuffer();
        const {error:uploadError}=await supabase.storage.from("studio-photos").upload(path,bytes,{contentType:mime,cacheControl:"31536000",upsert:false});
        if(uploadError)throw uploadError;
        uploadedPaths.push(path);
        urls.push(supabase.storage.from("studio-photos").getPublicUrl(path).data.publicUrl);
      }
      const {error:updateError}=await supabase.from("studios").update({
        image_urls:[...existing,...urls],
        image_source_name:"관리자 직접 등록",
        image_usage_note:current?.image_usage_note||"관리자가 직접 업로드한 사진",
        updated_at:new Date().toISOString()
      }).eq("id",id);
      if(updateError)throw updateError;
      Alert.alert("사진 등록 완료",name+" · "+urls.length+"장 업로드 완료");
      await load();
    }catch(error:any){
      if(uploadedPaths.length)await supabase.storage.from("studio-photos").remove(uploadedPaths);
      Alert.alert("사진 업로드 실패",error?.message||"잠시 후 다시 시도해 주세요.");
    }finally{setBusy(false);}
  };
  const importCsv=async()=>{
    if(!supabase||!csvText.trim())return;
    const parsed=parseCsv(csvText);
    if(parsed.length<2){Alert.alert("CSV 확인","첫 줄에 헤더가 있고, 두 번째 줄부터 학원 데이터가 있어야 합니다.");return;}
    const headers=parsed[0].map(v=>v.toLowerCase().trim());
    if(["name","latitude","longitude"].some(k=>!headers.includes(k))){Alert.alert("CSV 헤더 확인","필수 헤더는 name, latitude, longitude 입니다.");return;}
    if(parsed.length-1>50){Alert.alert("일괄 등록 제한","한 번에 최대 50개 학원까지만 등록할 수 있습니다.");return;}
    const get=(row:string[],key:string)=>{const idx=headers.indexOf(key);return idx<0?"":(row[idx]||"").trim();};
    const candidateNames=[...new Set(parsed.slice(1).map(row=>get(row,"name")).filter(Boolean))];
    const {data:existingRows,error:existingError}=await supabase.from("studios").select("name,address,phone").in("name",candidateNames).limit(1000);
    if(existingError){Alert.alert("중복 확인 실패",existingError.message);return;}
    const identityKey=(name:string,address:string,phone:string)=>name.trim().toLowerCase().replace(/\s/g,"")+"|"+(phone?phone.replace(/[^0-9]/g,""):(address?address.replace(/\s/g,"").toLowerCase():""));
    const existing=new Set((existingRows||[]).map(r=>identityKey(r.name,r.address||"",r.phone||"")));
    const payload:any[]=[];let skipped=0;
    for(const row of parsed.slice(1)){
      const name=get(row,"name"),latitude=Number(get(row,"latitude")),longitude=Number(get(row,"longitude"));
      if(!name||!Number.isFinite(latitude)||latitude < -90||latitude>90||!Number.isFinite(longitude)||longitude < -180||longitude>180){skipped++;continue;}
      const address=get(row,"address"),phone=get(row,"phone"),key=identityKey(name,address,phone);
      if(existing.has(key)){skipped++;continue;} existing.add(key);
      const website=get(row,"website_url"),source=get(row,"source_url");
      if((website&&!/^https:\/\//i.test(website))||(source&&!/^https:\/\//i.test(source))){skipped++;continue;}
      const imgs=get(row,"image_urls").split(/[|;]/).map(v=>v.trim()).filter(Boolean);
      if(imgs.length>10||imgs.some(v=>!/^https:\/\//i.test(v))){skipped++;continue;}
      const price=get(row,"price_per_class"),verifiedRaw=get(row,"verified_at"),verifiedDate=verifiedRaw?new Date(verifiedRaw):null;
      if((price&&(!Number.isFinite(Number(price))||Number(price)<0))||(verifiedDate&&!Number.isFinite(verifiedDate.getTime()))){skipped++;continue;}
      payload.push({name,latitude,longitude,district:get(row,"district")||null,address:address||null,phone:phone||null,website_url:website||null,source_url:source||null,source_name:get(row,"source_name")||null,verified_at:verifiedDate?verifiedDate.toISOString():null,image_urls:imgs,image_source_name:imgs.length?"관리자 직접 등록":null,image_usage_note:get(row,"image_usage_note")||null,price_per_class:price?Number(price):null,adult_classes:/^(1|true|yes|y)$/i.test(get(row,"adult_classes")),kids_classes:/^(1|true|yes|y)$/i.test(get(row,"kids_classes")),is_active:/^(1|true|yes|y)$/i.test(get(row,"is_active"))});
    }
    if(!payload.length){Alert.alert("등록할 데이터 없음","중복 또는 형식 오류로 제외 "+skipped+"개");return;}
    setImporting(true);
    const {error}=await supabase.from("studios").insert(payload);
    if(error)Alert.alert("일괄 등록 실패",error.message);
    else{setCsvText("");Alert.alert("일괄 등록 완료",payload.length+"개 등록, "+skipped+"개 제외. 홈페이지가 있는 학원은 수집 대기열에 추가됐습니다.");await load();}
    setImporting(false);
  };
  const loadClasses=useCallback(async(studioId:string)=>{
    if(!supabase)return;
    setClassBusy(true);
    const {data,error}=await supabase.from("classes").select("id,studio_id,title,audience,level,class_type,duration_minutes,price,is_active,class_sessions(id,weekday,start_time,end_time,note,is_active)").eq("studio_id",studioId).order("created_at",{ascending:false}).limit(100);
    if(error)Alert.alert("수업 조회 실패",error.message);else setClassRows(data||[]);
    setClassBusy(false);
  },[]);
  useEffect(()=>{if(classStudio)loadClasses(classStudio.id);else setClassRows([]);},[classStudio,loadClasses]);
  const resetClass=()=>{setClassEditing(null);setClassForm({title:"",audience:"adult",level:"",class_type:"",duration_minutes:"60",price:"",sessions:""});};
  const editClass=(row:any)=>{
    setClassEditing(row.id);
    setClassForm({
      title:row.title||"",audience:row.audience||"adult",level:row.level||"",class_type:row.class_type||"",
      duration_minutes:row.duration_minutes==null?"":String(row.duration_minutes),price:row.price==null?"":String(row.price),
      sessions:(row.class_sessions||[]).filter((x:any)=>x.is_active!==false).map((x:any)=>[x.weekday,(x.start_time||"").slice(0,5),(x.end_time||"").slice(0,5),x.note||""].join(",")).join("\n")
    });
  };
  const saveClass=async()=>{
    if(!supabase||!classStudio)return;
    if(!classForm.title.trim()){Alert.alert("필수 정보","수업명을 입력하세요.");return;}
    const duration=classForm.duration_minutes.trim()?Number(classForm.duration_minutes):null;
    const price=classForm.price.trim()?Number(classForm.price):null;
    if((duration!==null&&(!Number.isInteger(duration)||duration<=0))||(price!==null&&(!Number.isFinite(price)||price<0))){Alert.alert("입력 확인","수업 시간은 양의 정수, 가격은 0 이상의 숫자여야 합니다.");return;}
    const sessions=classForm.sessions.split(/\r?\n/).map(v=>v.trim()).filter(Boolean).map(line=>{
      const [weekdayRaw,startRaw,endRaw,noteRaw]=line.split(",").map(v=>v.trim());
      const weekday=Number(weekdayRaw);
      if(!Number.isInteger(weekday)||weekday<0||weekday>6||!/^([01]\d|2[0-3]):[0-5]\d$/.test(startRaw||"")||(endRaw&&!/^([01]\d|2[0-3]):[0-5]\d$/.test(endRaw)))return null;
      return {weekday,start_time:startRaw,end_time:endRaw||null,note:noteRaw||null,is_active:true};
    });
    if(sessions.some(v=>v===null)){Alert.alert("시간표 형식","요일(0=일~6=토),시작시간,종료시간,메모 형식으로 한 줄씩 입력하세요. 예: 1,19:00,20:00,성인 초급");return;}
    setClassBusy(true);
    try{
      const payload={studio_id:classStudio.id,title:classForm.title.trim(),audience:classForm.audience,level:classForm.level.trim()||null,class_type:classForm.class_type.trim()||null,duration_minutes:duration,price,is_active:true};
      let classId=classEditing;
      if(classEditing){
        const {error}=await supabase.from("classes").update(payload).eq("id",classEditing);
        if(error)throw error;
      }else{
        const {data,error}=await supabase.from("classes").insert(payload).select("id").single();
        if(error)throw error;
        classId=data.id;
      }
      // Insert the replacement timetable before removing the previous rows.
      // A failed insert must never erase a timetable that was already working.
      const previousSessionIds=classEditing
        ? (classRows.find(row=>row.id===classEditing)?.class_sessions||[]).map((row:any)=>row.id).filter(Boolean)
        : [];
      let insertedSessionIds:string[]=[];
      if(sessions.length){
        const {data:insertedSessions,error:sessionError}=await supabase.from("class_sessions")
          .insert(sessions.map(v=>({...v,class_id:classId}))).select("id");
        if(sessionError)throw sessionError;
        insertedSessionIds=(insertedSessions||[]).map((row:any)=>row.id).filter(Boolean);
      }
      if(previousSessionIds.length){
        const {error:deleteError}=await supabase.from("class_sessions").delete().in("id",previousSessionIds);
        if(deleteError){
          if(insertedSessionIds.length)await supabase.from("class_sessions").delete().in("id",insertedSessionIds);
          throw deleteError;
        }
      }
      Alert.alert("저장 완료","수업과 시간표를 저장했습니다.");
      resetClass();
      await loadClasses(classStudio.id);
    }catch(error:any){Alert.alert("저장 실패",error?.message||"수업 저장 중 오류가 발생했습니다.");}
    finally{setClassBusy(false);}
  };
  const deleteClass=(id:string,title:string)=>Alert.alert("수업 삭제",title+" 수업을 삭제할까요?",[{text:"취소",style:"cancel"},{text:"삭제",style:"destructive",onPress:async()=>{
    if(!supabase)return;setClassBusy(true);
    const {error}=await supabase.from("classes").delete().eq("id",id);
    if(error)Alert.alert("삭제 실패",error.message);else await loadClasses(classStudio!.id);
    setClassBusy(false);
  }}]);
  const classField=(label:string,key:keyof typeof classForm,keyboard:any="default")=><View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput style={[styles.input,key==="sessions"&&{minHeight:110,textAlignVertical:"top"}]} multiline={key==="sessions"} value={String(classForm[key])} onChangeText={v=>setClassForm(x=>({...x,[key]:v}))} keyboardType={keyboard} placeholder={label}/></View>;
  const remove=(id:string,name:string)=>Alert.alert("학원 삭제",name+" 정보를 삭제할까요?",[{text:"취소",style:"cancel"},{text:"삭제",style:"destructive",onPress:async()=>{setBusy(true);const {error}=await supabase!.from("studios").delete().eq("id",id);if(error)Alert.alert("삭제 실패",error.message);else await load();setBusy(false);}}]);
  const field=(label:string,key:keyof typeof blank,keyboard:any="default")=><View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput style={[styles.input,(key==="image_urls"||key==="image_usage_note")&&{minHeight:72,textAlignVertical:"top"}]} multiline={key==="image_urls"||key==="image_usage_note"} value={String(form[key])} onChangeText={v=>setForm(f=>({...f,[key]:v}))} keyboardType={keyboard} placeholder={label}/></View>;
  const toggle=(label:string,key:"adult_classes"|"kids_classes"|"is_active")=><Pressable onPress={()=>setForm(f=>({...f,[key]:!f[key]}))} style={styles.toggle}><Text style={[styles.toggleText,form[key]&&styles.toggleOn]}>{form[key]?"✓ ":"○ "}{label}</Text></Pressable>;

  if(checking)return <SafeAreaView style={styles.safe}><ActivityIndicator style={{marginTop:50}} color={c.purple}/></SafeAreaView>;
  if(!session)return <SafeAreaView style={styles.safe}><View style={styles.login}><Ionicons name="shield-checkmark-outline" size={38} color={c.purple} style={{alignSelf:"center",marginBottom:4}} /><Text style={[styles.brand,{textAlign:"center"}]}>Balletmate 관리자</Text><Text style={styles.hint}>관리자 계정으로 로그인하세요.</Text><TextInput style={styles.input} value={username} onChangeText={setUsername} placeholder="관리자 아이디" autoCapitalize="none"/><TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="비밀번호" secureTextEntry/><Pressable style={[styles.button,styles.loginButton]} onPress={login} disabled={busy}><Text style={styles.buttonText}>{busy?"처리 중…":"로그인"}</Text></Pressable></View></SafeAreaView>;
  if(!authorized)return <SafeAreaView style={styles.safe}><View style={styles.login}><Text style={styles.brand}>관리자 권한 없음</Text><Text style={styles.hint}>이 계정은 Balletmate 관리자 목록에 등록되지 않았습니다.</Text><Pressable style={[styles.button,styles.loginButton]} onPress={logout}><Text style={styles.buttonText}>로그아웃</Text></Pressable></View></SafeAreaView>;

  return <SafeAreaView style={styles.safe}><KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==="ios"?"padding":undefined}><ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.header}><View><Text style={styles.brand}>Balletmate 관리자</Text><Text style={styles.hint}>학원 데이터 관리 · {rows.length}개</Text></View><Pressable onPress={logout}><Text style={styles.logout}>로그아웃</Text></Pressable></View>
    <View style={styles.adminTabs}>{([{key:"overview",label:"현황"},{key:"review",label:"자료 검토"},{key:"publish",label:"공개 관리"},{key:"studios",label:"학원 관리"}] as const).map(item=><Pressable key={item.key} onPress={()=>setAdminTab(item.key)} style={[styles.adminTab,adminTab===item.key&&styles.adminTabActive]}><Text style={[styles.adminTabText,adminTab===item.key&&styles.adminTabTextActive]}>{item.label}</Text></Pressable>)}</View>
        {adminTab==="overview"&&<>
<View style={styles.panel}><View style={styles.listHead}><Text style={styles.heading}>자동 수집 운영 현황</Text><Pressable onPress={loadDashboard} disabled={dashboardBusy}><Text style={styles.refresh}>{dashboardBusy?"조회 중…":"새로고침"}</Text></Pressable></View>{dashboardError?<Text style={styles.hint}>대시보드 SQL 적용 필요 또는 조회 오류: {dashboardError}</Text>:dashboard?<><View style={styles.statsGrid}>{[
      ["학원",dashboard.studios?.total??0,"공개 "+(dashboard.studios?.active??0)],
      ["블로그 검색",dashboard.blog_search?.pending??0,"대기 · 진행 "+(dashboard.blog_search?.processing??0)+" · 실패 "+(dashboard.blog_search?.failed??0)],
      ["게시글 수집",dashboard.blog_posts?.pending??0,"대기 · 진행 "+(dashboard.blog_posts?.processing??0)+" · 실패 "+(dashboard.blog_posts?.failed??0)],
      ["사진 미확보 학원",dashboard.photos?.missing??0,"사진이 등록되지 않은 활성 학원"],
      ["사진 수집 대기",dashboard.image_queue?.pending??0,"진행 "+(dashboard.image_queue?.processing??0)+" · 실패 "+(dashboard.image_queue?.failed??0)],
      ["장기 정체",Number(dashboard.blog_search?.stalled||0)+Number(dashboard.blog_posts?.stalled||0)+Number(dashboard.image_queue?.stalled||0),"검색·게시글·사진 20분 이상"],
      ["사용자 제보",dashboard.reports?.pending??0,"학원 정보 검토 요청"],
      ["근거 검수",dashboard.evidence?.pending??0,"가격·시간표 후보"],
      ["시간표 후보",dashboard.schedule_candidates?.pending??0,"등록 대기"],
      ["공개 가격",dashboard.public_prices?.active??0,"활성 자료"],
      ["공개 시간표",dashboard.public_schedules?.active??0,"활성 자료"],
      ["지역 발견",dashboard.discovery?.last_inserted??0,"최근 실행 신규 발견"]
    ].map(([label,value,caption])=><View key={String(label)} style={styles.statCard}><Text style={styles.statLabel}>{label}</Text><Text style={styles.statValue}>{Number(value).toLocaleString("ko-KR")}</Text><Text style={styles.statCaption}>{caption}</Text></View>)}</View><Text style={styles.hint}>최근 지역 탐색: {dashboard.discovery?.last_region||"실행 기록 없음"} · {dashboard.discovery?.last_run_at?new Date(dashboard.discovery.last_run_at).toLocaleString("ko-KR"):"기록 없음"}</Text>{dashboard.discovery?.last_error&&<Text style={styles.errorHint}>최근 탐색 오류: {dashboard.discovery.last_error}</Text>}<Pressable style={styles.secondary} disabled={retryBusy} onPress={retryFailedQueues}><Text style={styles.secondaryText}>{retryBusy?"재처리 요청 중…":"실패한 수집 작업 재처리"}</Text></Pressable></>:<Text style={styles.hint}>통계를 불러오는 중입니다.</Text>}</View>
    <View style={styles.panel}><View style={styles.listHead}><Text style={styles.heading}>학원 정보 사용자 제보 ({reportRows.filter(r=>r.status==="pending"||r.status==="in_review").length})</Text><Pressable onPress={loadReports}><Text style={styles.refresh}>{reportsBusy?"조회 중…":"새로고침"}</Text></Pressable></View>{reportsError?<View><Text style={styles.hint}>제보 조회 오류: {reportsError}</Text><Pressable onPress={loadReports}><Text style={styles.action}>다시 시도</Text></Pressable></View>:reportRows.length?reportRows.map(report=><View key={"report-"+report.id} style={styles.evidenceCard}><Text style={styles.evidenceStudio}>{report.studio_name||"학원"} · {report.category} · {new Date(report.created_at).toLocaleDateString("ko-KR")}</Text><Text style={styles.evidenceText}>{report.description}</Text><Text style={styles.rowMeta}>상태: {report.status==="pending"?"대기":report.status==="in_review"?"검토 중":report.status==="resolved"?"처리 완료":"기각"}</Text>{(report.status==="pending"||report.status==="in_review")&&<View style={styles.rowActions}><Pressable onPress={()=>updateReportStatus(report.id,"in_review")}><Text style={styles.action}>검토 중</Text></Pressable><Pressable onPress={()=>updateReportStatus(report.id,"resolved")}><Text style={styles.action}>처리 완료</Text></Pressable><Pressable onPress={()=>updateReportStatus(report.id,"rejected")}><Text style={styles.reject}>기각</Text></Pressable></View>}</View>):<Text style={styles.hint}>접수된 제보가 없습니다.</Text>}</View>
        </>}
    {adminTab==="publish"&&<>
<View style={styles.panel}><View style={styles.listHead}><Text style={styles.heading}>공개 중인 가격 · {activePublicPrices.length}건</Text><Pressable onPress={loadEvidence}><Text style={styles.refresh}>새로고침</Text></Pressable></View><View style={styles.compactTableHeader}><Text style={styles.compactNumber}>#</Text><Text style={styles.compactMain}>학원 · 가격</Text><Text style={styles.compactAction}>관리</Text></View>{activePublicPrices.slice(0,100).map((price,index)=><View key={"active-price-"+price.id} style={styles.compactTableRow}><Text style={styles.compactNumber}>{index+1}</Text><View style={styles.compactMain}><Text style={styles.compactPrimary} numberOfLines={1}>{price.studio_name}</Text><Text style={styles.compactSecondary} numberOfLines={1}>{Number(price.amount_krw).toLocaleString("ko-KR")}원 · {price.price_period}{price.frequency_per_week?" · 주 "+price.frequency_per_week+"회":""}</Text></View><Pressable onPress={()=>deactivatePublicPrice(price)} disabled={evidenceBusy}><Text style={styles.compactAction}>중단</Text></Pressable></View>)}{!activePublicPrices.length&&!evidenceBusy&&<Text style={styles.hint}>현재 공개 중인 가격이 없습니다.</Text>}</View>
<View style={styles.panel}><View style={styles.listHead}><Text style={styles.heading}>공개 중인 시간표 · 학원 {new Set(activePublicSchedules.map((x:any)=>x.studio_id)).size}곳 / {activePublicSchedules.length}건</Text><Pressable onPress={loadEvidence}><Text style={styles.refresh}>새로고침</Text></Pressable></View><View style={styles.compactTableHeader}><Text style={styles.compactNumber}>#</Text><Text style={styles.compactMain}>학원명 · 등록 시간표 수</Text><Text style={styles.compactAction}>상세</Text></View>{[...new Map(activePublicSchedules.map((item:any)=>[item.studio_id,{studio_id:item.studio_id,studio_name:item.studio_name}])).values()].map((studio:any,index)=><View key={"active-schedule-studio-"+studio.studio_id}><View style={styles.compactTableRow}><Text style={styles.compactNumber}>{index+1}</Text><View style={styles.compactMain}><Text style={styles.compactPrimary}>{studio.studio_name||"학원명 미확인"}</Text><Text style={styles.compactSecondary}>{activePublicSchedules.filter((x:any)=>x.studio_id===studio.studio_id).length}개 등록 자료</Text></View><Pressable onPress={()=>setExpandedPublicScheduleStudioId(id=>id===studio.studio_id?null:studio.studio_id)}><Text style={styles.compactAction}>{expandedPublicScheduleStudioId===studio.studio_id?"접기":"상세 보기"}</Text></Pressable></View>{expandedPublicScheduleStudioId===studio.studio_id&&<View style={styles.compactExpanded}>{activePublicSchedules.filter((x:any)=>x.studio_id===studio.studio_id).map((item:any)=><View key={"public-schedule-detail-"+item.id} style={styles.compactTableRow}><View style={styles.compactMain}><Text style={styles.compactSecondary}>{String(item.schedule_text||"내용 없음")}</Text><Text style={styles.compactSecondary}>게시일 {item.source_post_date||"미확인"}</Text></View><Pressable onPress={()=>deactivatePublicSchedule(item)} disabled={evidenceBusy}><Text style={[styles.compactAction,{color:"#B95764"}]}>중단</Text></Pressable></View>)}</View>}</View>)}{!activePublicSchedules.length&&!evidenceBusy&&<Text style={styles.hint}>현재 공개 중인 시간표가 없습니다.</Text>}</View>
<View style={styles.panel}><View style={styles.listHead}><Text style={styles.heading}>공개 대기 시간표 · {verifiedScheduleRows.length}건</Text><Pressable onPress={()=>setSelectedScheduleIds(verifiedScheduleRows.filter(item=>!publishedScheduleCandidateIds.includes(item.id)).map(item=>item.id))}><Text style={styles.refresh}>전체 선택</Text></Pressable><Pressable onPress={()=>setSelectedScheduleIds([])}><Text style={styles.refresh}>해제</Text></Pressable></View><Pressable style={styles.button} disabled={evidenceBusy||!selectedScheduleIds.length} onPress={publishScheduleBatch}><Text style={styles.buttonText}>선택 {selectedScheduleIds.length}개 공개</Text></Pressable><View style={styles.compactTableHeader}><Text style={styles.compactNumber}>#</Text><Text style={styles.compactMain}>학원 · 시간표</Text><Text style={styles.compactAction}>선택</Text></View>{verifiedScheduleRows.slice(0,100).map((item,index)=><View key={"verified-schedule-"+item.id} style={styles.compactTableRow}><Text style={styles.compactNumber}>{index+1}</Text><Pressable style={styles.compactMain} onPress={()=>Linking.openURL(item.source_url)}><Text style={styles.compactPrimary} numberOfLines={1}>{item.studio_name}</Text><Text style={styles.compactSecondary} numberOfLines={1}>{String(item.normalized_value||item.candidate_value||item.evidence_text||"내용 없음").replace(/^OCR#\d+\s*/i,"")}</Text></Pressable><Pressable onPress={()=>setSelectedScheduleIds(ids=>ids.includes(item.id)?ids.filter(id=>id!==item.id):[...ids,item.id])}><Text style={styles.compactAction}>{selectedScheduleIds.includes(item.id)?"☑":"□"}</Text></Pressable></View>)}{!verifiedScheduleRows.length&&!evidenceBusy&&<Text style={styles.hint}>공개 대기 자료가 없습니다.</Text>}</View>
<View style={styles.panel}><View style={styles.listHead}><Text style={styles.heading}>시간표 등록 후보 · {scheduleClassCandidates.length}건</Text><Pressable onPress={loadScheduleClassCandidates}><Text style={styles.refresh}>새로고침</Text></Pressable></View><View style={styles.compactTableHeader}><Text style={styles.compactNumber}>#</Text><Text style={styles.compactMain}>학원 · 수업</Text><Text style={styles.compactAction}>상세</Text></View>{scheduleClassCandidates.slice(0,100).map((candidate,index)=><View key={"class-candidate-"+candidate.id}><View style={styles.compactTableRow}><Text style={styles.compactNumber}>{index+1}</Text><View style={styles.compactMain}><Text style={styles.compactPrimary} numberOfLines={1}>{candidate.studio_name}</Text><Text style={styles.compactSecondary} numberOfLines={1}>{candidateTitles[candidate.id]||candidate.proposed_title} · {(candidate.sessions||[]).length}개 세션</Text></View><Pressable onPress={()=>setExpandedScheduleCandidateId(id=>id===candidate.id?null:candidate.id)}><Text style={styles.compactAction}>{expandedScheduleCandidateId===candidate.id?"접기":"상세"}</Text></Pressable></View>{expandedScheduleCandidateId===candidate.id&&<View style={styles.compactExpanded}><TextInput style={styles.input} value={candidateTitles[candidate.id]??candidate.proposed_title} onChangeText={value=>setCandidateTitles(current=>({...current,[candidate.id]:value}))} placeholder="수업명"/><TextInput style={[styles.input,{minHeight:84,textAlignVertical:"top"}]} multiline value={candidateSessions[candidate.id]??(candidate.sessions||[]).map((x:any)=>[x.weekday,x.start_time,x.end_time||"",x.note||""].join(",")).join("\n")} onChangeText={value=>setCandidateSessions(current=>({...current,[candidate.id]:value}))} placeholder="요일번호,시작,종료,메모"/><Pressable onPress={()=>Linking.openURL(candidate.source_url)}><Text style={styles.action}>원문 확인</Text></Pressable><View style={styles.buttons}><Pressable style={styles.secondary} disabled={evidenceBusy} onPress={()=>rejectScheduleClassCandidate(candidate)}><Text style={styles.secondaryText}>제외</Text></Pressable><Pressable style={styles.button} disabled={evidenceBusy} onPress={()=>createClassFromScheduleCandidate(candidate)}><Text style={styles.buttonText}>확인 후 수업 등록</Text></Pressable></View></View>}</View>)}{!scheduleClassCandidates.length&&!evidenceBusy&&<Text style={styles.hint}>등록 후보가 없습니다.</Text>}</View>
<View style={styles.panel}><View style={styles.listHead}><Text style={styles.heading}>공개 대기 가격 · {verifiedPriceRows.length}건</Text><Pressable onPress={()=>setSelectedPriceIds(verifiedPriceRows.filter(item=>!publishedCandidateIds.includes(item.id)).map(item=>item.id))}><Text style={styles.refresh}>전체 선택</Text></Pressable><Pressable onPress={()=>setSelectedPriceIds([])}><Text style={styles.refresh}>해제</Text></Pressable><Pressable onPress={loadEvidence}><Text style={styles.refresh}>새로고침</Text></Pressable></View><Pressable style={styles.button} disabled={evidenceBusy||!selectedPriceIds.length} onPress={publishPriceBatch}><Text style={styles.buttonText}>선택 {selectedPriceIds.length}개 공개</Text></Pressable><View style={styles.compactTableHeader}><Text style={styles.compactNumber}>#</Text><Text style={styles.compactMain}>학원 · 가격</Text><Text style={styles.compactAction}>선택</Text></View>{verifiedPriceRows.slice(0,100).map((item,index)=><View key={"verified-price-"+item.id} style={styles.compactTableRow}><Text style={styles.compactNumber}>{index+1}</Text><Pressable style={styles.compactMain} onPress={()=>Linking.openURL(item.source_url)}><Text style={styles.compactPrimary} numberOfLines={1}>{item.studio_name}</Text><Text style={styles.compactSecondary} numberOfLines={1}>{Number(item.normalized_value||0).toLocaleString("ko-KR")}원 · {item.price_period||"기간 미확인"}</Text></Pressable><Pressable onPress={()=>setSelectedPriceIds(ids=>ids.includes(item.id)?ids.filter(id=>id!==item.id):[...ids,item.id])}><Text style={styles.compactAction}>{selectedPriceIds.includes(item.id)?"☑":"□"}</Text></Pressable></View>)}{!verifiedPriceRows.length&&!evidenceBusy&&<Text style={styles.hint}>공개 대기 가격이 없습니다.</Text>}</View>
        </>}
    {adminTab==="review"&&<View style={{gap:12}}>
<View style={styles.panel}><View style={styles.listHead}><Text style={styles.heading}>자료 검토 · 최근 {evidenceRows.length}건</Text><Pressable onPress={()=>setSelectedEvidenceIds(evidenceRows.map(row=>row.id))}><Text style={styles.refresh}>전체 선택</Text></Pressable><Pressable onPress={()=>setSelectedEvidenceIds([])}><Text style={styles.refresh}>해제</Text></Pressable><Pressable onPress={loadEvidence}><Text style={styles.refresh}>새로고침</Text></Pressable></View><View style={styles.ocrStatusRow}><Text style={styles.ocrStatus}>이미지 OCR 모듈: {ocrAvailability==="available"?"연결 가능":ocrAvailability==="unavailable"?"미지원":"확인 전"}</Text><Pressable onPress={checkOcrAvailability} disabled={ocrBusy}><Text style={styles.refresh}>{ocrBusy?"확인 중…":"상태 확인"}</Text></Pressable></View><View style={styles.buttons}><Pressable style={styles.secondary} disabled={evidenceBusy||!selectedEvidenceIds.length} onPress={()=>reviewEvidenceBatch("rejected")}><Text style={styles.secondaryText}>선택 {selectedEvidenceIds.length}개 제외</Text></Pressable><Pressable style={styles.button} disabled={evidenceBusy||!selectedEvidenceIds.length} onPress={()=>reviewEvidenceBatch("verified")}><Text style={styles.buttonText}>선택 {selectedEvidenceIds.length}개 근거 확인</Text></Pressable></View><View style={styles.compactTableHeader}><Text style={styles.compactNumber}>#</Text><Text style={styles.compactMain}>학원 · 유형 · 요약</Text><Text style={styles.compactAction}>선택</Text></View>{evidenceBusy&&<ActivityIndicator color={c.purple}/>}{evidenceRows.slice(0,100).map((item,index)=><View key={item.id} style={styles.compactTableRow}><Text style={styles.compactNumber}>{index+1}</Text><View style={styles.compactMain}><Text style={styles.compactPrimary} numberOfLines={1}>{item.studio_name}</Text><Text style={styles.compactSecondary} numberOfLines={1}>{item.candidate_type==="price"?"가격":"시간표"} · {item.candidate_type==="price"&&item.normalized_value?Number(item.normalized_value).toLocaleString("ko-KR")+"원 · "+(item.price_period||"기간 미확인"):(item.normalized_value||item.candidate_value||item.evidence_text||"내용 없음")}</Text><Text style={styles.compactSecondary} numberOfLines={1}>게시일 {item.source_post_date||"미확인"} · 신뢰도 {Math.round(item.confidence*100)}%</Text></View><Pressable onPress={()=>setSelectedEvidenceIds(ids=>ids.includes(item.id)?ids.filter(id=>id!==item.id):[...ids,item.id])}><Text style={styles.compactAction}>{selectedEvidenceIds.includes(item.id)?"☑":"□"}</Text></Pressable></View>)}{!evidenceRows.length&&!evidenceBusy&&<Text style={styles.hint}>검토 대기 자료가 없습니다.</Text>}</View>
<View style={styles.panel}><View style={styles.listHead}><Text style={styles.heading}>이미지 OCR 결과 · {ocrRows.length}건</Text><Pressable onPress={()=>setSelectedOcrIds(ocrRows.map(row=>row.id))}><Text style={styles.refresh}>전체 선택</Text></Pressable><Pressable onPress={()=>setSelectedOcrIds([])}><Text style={styles.refresh}>해제</Text></Pressable><Pressable onPress={loadOcr}><Text style={styles.refresh}>새로고침</Text></Pressable></View><View style={styles.buttons}><Pressable style={styles.secondary} disabled={!selectedOcrIds.length||ocrBusy} onPress={()=>reviewOcrBatch("rejected")}><Text style={styles.secondaryText}>선택 {selectedOcrIds.length}개 제외</Text></Pressable><Pressable style={styles.button} disabled={!selectedOcrIds.length||ocrBusy} onPress={()=>reviewOcrBatch("verified")}><Text style={styles.buttonText}>선택 {selectedOcrIds.length}개 확인</Text></Pressable></View><View style={styles.compactTableHeader}><Text style={styles.compactNumber}>#</Text><Text style={styles.compactMain}>학원 · 유형 · 인식 내용</Text><Text style={styles.compactAction}>선택</Text></View>{ocrRows.slice(0,100).map((row,index)=><View key={"ocr-"+row.id} style={styles.compactTableRow}><Text style={styles.compactNumber}>{index+1}</Text><View style={styles.compactMain}><Text style={styles.compactPrimary} numberOfLines={1}>{row.studio_name}</Text><Text style={styles.compactSecondary} numberOfLines={1}>{row.detected_kind==="price"?"가격":row.detected_kind==="schedule"?"시간표":"분류 미확인"} · {row.image_label||"이미지"}</Text><Text style={styles.compactSecondary} numberOfLines={1}>{row.extracted_text}</Text></View><Pressable onPress={()=>setSelectedOcrIds(ids=>ids.includes(row.id)?ids.filter(id=>id!==row.id):[...ids,row.id])}><Text style={styles.compactAction}>{selectedOcrIds.includes(row.id)?"☑":"□"}</Text></Pressable></View>)}{!ocrRows.length&&!ocrBusy&&<Text style={styles.hint}>대기 중인 OCR 결과가 없습니다. 학원 관리에서 기기 사진 OCR 또는 블로그 OCR을 실행하세요.</Text>}</View>    </View>}
    {adminTab==="studios"&&<>
<View style={styles.panel}><Text style={styles.heading}>{editing?"학원 정보 수정":"학원 등록"}</Text>{field("학원명 *","name")}{field("위도 *","latitude","decimal-pad")}{field("경도 *","longitude","decimal-pad")}{field("지역/구","district")}{field("주소","address")}{field("전화번호","phone","phone-pad")}{field("공식 홈페이지 URL (https://)","website_url")}{field("정보 출처 URL (https://)","source_url")}{field("정보 출처명","source_name")}{field("정보 확인일 (YYYY-MM-DD)","verified_at")}{field("사진 URL (최대 10개, 줄바꿈 구분)","image_urls")}{field("사진 출처명 (예: 관리자 직접 등록)","image_source_name")}{field("사진 사용 허가/출처 메모","image_usage_note")}{field("1회 수업 가격 (원)","price_per_class","numeric")}
      <View style={styles.toggles}>{toggle("성인 수업","adult_classes")}{toggle("키즈 수업","kids_classes")}{toggle("앱에 공개","is_active")}</View>
      <View style={styles.buttons}>{editing&&<Pressable style={styles.secondary} onPress={reset}><Text style={styles.secondaryText}>취소</Text></Pressable>}<Pressable style={styles.button} onPress={save} disabled={busy}><Text style={styles.buttonText}>{busy?"저장 중…":editing?"수정 저장":"학원 등록"}</Text></Pressable></View>
    </View>
    {officialBlogStudio&&<View style={styles.panel}>
      <View style={styles.listHead}><Text style={styles.heading}>{officialBlogStudio.name} · 공식 블로그</Text><Pressable onPress={()=>{setOfficialBlogStudio(null);setOfficialBlogUrls("");}}><Text style={styles.refresh}>닫기</Text></Pressable></View>
      <Text style={styles.hint}>학원에서 직접 운영하는 네이버 블로그 프로필 주소만 등록하세요. 게시글 URL이 아니라 블로그 홈 주소를 입력합니다. 등록된 계정의 게시물만 앱의 공개 소식에 표시됩니다. 최대 5개, 한 줄에 하나씩 입력하세요.</Text>
      <TextInput style={[styles.input,{minHeight:100,textAlignVertical:"top"}]} multiline autoCapitalize="none" autoCorrect={false} value={officialBlogUrls} onChangeText={setOfficialBlogUrls} placeholder={"https://blog.naver.com/blogid\nhttps://blog.naver.com/anotherid"}/>
      <View style={styles.buttons}><Pressable style={styles.secondary} onPress={()=>{setOfficialBlogStudio(null);setOfficialBlogUrls("");}}><Text style={styles.secondaryText}>취소</Text></Pressable><Pressable style={styles.button} disabled={officialBlogBusy} onPress={saveOfficialBlogAccounts}><Text style={styles.buttonText}>{officialBlogBusy?"처리 중…":"공식 계정 저장"}</Text></Pressable></View>
    </View>}
    {classStudio&&<View style={styles.panel}>
      <View style={styles.listHead}><Text style={styles.heading}>{classStudio.name} · 수업 관리</Text><Pressable onPress={()=>{setClassStudio(null);resetClass();}}><Text style={styles.refresh}>닫기</Text></Pressable></View>
      {classField("수업명 *","title")}
      <Text style={styles.label}>대상 (adult / kids / all)</Text>
      <View style={styles.toggles}>{(["adult","kids","all"] as const).map(v=><Pressable key={v} style={styles.toggle} onPress={()=>setClassForm(x=>({...x,audience:v}))}><Text style={[styles.toggleText,classForm.audience===v&&styles.toggleOn]}>{classForm.audience===v?"✓ ":"○ "}{v==="adult"?"성인":v==="kids"?"키즈":"전체"}</Text></Pressable>)}</View>
      {classField("수준 (입문/초급/중급/고급)","level")}
      {classField("수업 유형 (기초/포인트/발레핏 등)","class_type")}
      {classField("수업 시간(분)","duration_minutes","numeric")}
      {classField("1회 수강료(원)","price","numeric")}
      {classField("시간표 (요일,시작,종료,메모 / 한 줄씩)","sessions")}
      <Text style={styles.hint}>요일 번호: 0 일요일 · 1 월요일 · 2 화요일 · 3 수요일 · 4 목요일 · 5 금요일 · 6 토요일. 예: 1,19:00,20:00,성인 초급</Text>
      <View style={styles.buttons}>{classEditing&&<Pressable style={styles.secondary} onPress={resetClass}><Text style={styles.secondaryText}>취소</Text></Pressable>}<Pressable style={styles.button} disabled={classBusy||busy} onPress={saveClass}><Text style={styles.buttonText}>{classBusy?"저장 중…":classEditing?"수업 수정 저장":"수업 등록"}</Text></Pressable></View>
      <View style={styles.listHead}><Text style={styles.heading}>등록된 수업 ({classRows.length})</Text><Pressable onPress={()=>loadClasses(classStudio.id)}><Text style={styles.refresh}>새로고침</Text></Pressable></View>
      {classBusy&&<ActivityIndicator color={c.purple}/>}
      {classRows.map(row=><View key={row.id} style={styles.row}><View style={{flex:1,minWidth:120}}><Text style={styles.rowName}>{row.title}</Text><Text style={styles.rowMeta}>{row.audience==="kids"?"키즈":row.audience==="all"?"전체":"성인"} · {row.level||"수준 미입력"} · {(row.class_sessions||[]).filter((x:any)=>x.is_active!==false).length}개 시간표</Text></View><Pressable onPress={()=>editClass(row)}><Text style={styles.action}>수정</Text></Pressable><Pressable onPress={()=>deleteClass(row.id,row.title)}><Text style={[styles.action,{color:"#B95764"}]}>삭제</Text></Pressable></View>)}
      {!classRows.length&&!classBusy&&<Text style={styles.hint}>등록된 수업이 없습니다.</Text>}
    </View>}
    <View style={styles.panel}><Text style={styles.heading}>학원 일괄 등록 (CSV)</Text><Text style={styles.hint}>필수 열: name, latitude, longitude · 선택 열: district,address,phone,website_url,source_url,source_name,price_per_class,adult_classes,kids_classes,is_active,image_urls,image_usage_note · 최대 50개</Text><TextInput style={[styles.input,{minHeight:120,textAlignVertical:"top"}]} multiline value={csvText} onChangeText={setCsvText} placeholder={"name,latitude,longitude,district,address,phone,website_url,source_url,source_name,price_per_class,adult_classes,kids_classes,is_active\n발레학원,37.56,126.97,중구,서울 중구,02-000-0000,https://example.com,https://example.com,공식 홈페이지,25000,true,false,false"} /><Pressable style={styles.button} onPress={importCsv} disabled={importing||busy}><Text style={styles.buttonText}>{importing?"등록 중…":"CSV 데이터 등록"}</Text></Pressable></View>
    <View style={styles.panel}><View style={styles.listHead}><Text style={styles.heading}>등록 학원 · {visibleStudioRows.length}/{rows.length} (최대 100개)</Text><Pressable onPress={load}><Text style={styles.refresh}>새로고침</Text></Pressable></View>
      <TextInput style={styles.input} value={studioSearch} onChangeText={setStudioSearch} placeholder="학원명·지역·주소·전화 검색" autoCapitalize="none"/>
      <View style={styles.toggles}>{([{key:"all",label:"전체"},{key:"missing_photo",label:"사진 없음"},{key:"missing_website",label:"홈페이지 없음"},{key:"website_candidate",label:"홈페이지 후보"},{key:"active",label:"공개"},{key:"inactive",label:"비공개"}] as const).map(option=><Pressable key={option.key} style={[styles.toggle,studioListFilter===option.key&&{borderColor:c.purple,backgroundColor:c.pale}]} onPress={()=>setStudioListFilter(option.key)}><Text style={[styles.toggleText,studioListFilter===option.key&&styles.toggleOn]}>{option.label}</Text></Pressable>)}</View>{busy&&<ActivityIndicator color={c.purple}/>}
      {visibleStudioRows.map(r=><View key={r.id} style={styles.row}><View style={{flex:1}}><Text style={styles.rowName}>{r.name}</Text><Text style={styles.rowMeta}>{r.district||"지역 미입력"} · 사진 {(r.image_urls||[]).length}장 · {r.is_active?"공개":"비공개"}{String(r.source_name||"").includes("홈페이지 검색 후보")?" · 홈페이지 후보(미검증)":""}</Text>{String(r.source_name||"").includes("홈페이지 검색 후보")&&!!r.website_url&&<Pressable onPress={()=>Linking.openURL(r.website_url!).catch(()=>Alert.alert("홈페이지 연결","주소를 열 수 없습니다."))}><Text style={styles.action}>후보 홈페이지 확인 ↗</Text></Pressable>}</View><Pressable style={styles.manageButton} onPress={()=>setStudioActionId(current=>current===r.id?null:r.id)}><Text style={styles.manageButtonText}>{studioActionId===r.id?"닫기":"관리"}</Text></Pressable>{studioActionId===r.id&&<View style={styles.studioActionMenu}><Pressable style={styles.manageAction} onPress={()=>{setStudioActionId(null);startEdit(r);}}><Text style={styles.manageButtonText}>정보 수정</Text></Pressable><Pressable style={styles.manageAction} onPress={()=>{setStudioActionId(null);setClassStudio(r);resetClass();}}><Text style={styles.manageButtonText}>수업 관리</Text></Pressable><Pressable style={styles.manageAction} onPress={()=>{setStudioActionId(null);openOfficialBlogManager(r);}}><Text style={styles.manageButtonText}>공식 블로그 등록</Text></Pressable><Pressable style={styles.manageAction} onPress={()=>{setStudioActionId(null);uploadPhotos(r.id,r.name);}}><Text style={styles.manageButtonText}>사진 업로드</Text></Pressable><Pressable style={styles.manageAction} onPress={()=>{setStudioActionId(null);runLocalOcr(r.id,r.name);}}><Text style={styles.manageButtonText}>기기 사진 OCR</Text></Pressable><Pressable style={styles.manageAction} onPress={()=>{setStudioActionId(null);runBlogImageOcr(r.id,r.name);}}><Text style={styles.manageButtonText}>블로그 OCR</Text></Pressable><Pressable style={styles.manageAction} onPress={()=>{setStudioActionId(null);requeueStudioBlogSearch(r);}}><Text style={styles.manageButtonText}>블로그 검색</Text></Pressable><Pressable style={styles.manageAction} onPress={()=>{setStudioActionId(null);if(r.website_url)crawlImages(r.id,r.name);else Alert.alert("홈페이지 필요","사진 자동 수집을 위해 홈페이지 주소를 먼저 등록해 주세요.");}}><Text style={styles.manageButtonText}>사진 수집</Text></Pressable><Pressable style={styles.manageAction} onPress={()=>{setStudioActionId(null);remove(r.id,r.name);}}><Text style={[styles.manageButtonText,{color:"#B95764"}]}>삭제</Text></Pressable></View>}</View>)}
      {!rows.length&&!busy&&<Text style={styles.hint}>등록된 학원이 없습니다.</Text>}{rows.length>0&&!visibleStudioRows.length&&<Text style={styles.hint}>검색/필터 조건에 맞는 학원이 없습니다.</Text>}
    </View>
    </>}
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
export function ErrorBoundary({error,retry}:{error:any;retry:()=>void}){
  const detail=String(error?.stack||error?.message||error||"알 수 없는 오류");
  return <SafeAreaView style={styles.safe}><View style={styles.login}><Text style={styles.brand}>관리자 화면 오류</Text><Text style={styles.hint}>오류 위치를 확인할 수 있도록 상세 내용을 표시합니다.</Text><ScrollView style={{maxHeight:320}}><Text selectable style={styles.errorHint}>{detail}</Text></ScrollView><Pressable style={[styles.button,styles.loginButton]} onPress={retry}><Text style={styles.buttonText}>다시 시도</Text></Pressable></View></SafeAreaView>;
}
const styles=StyleSheet.create({safe:{flex:1,backgroundColor:c.bg},login:{flex:1,justifyContent:"center",paddingHorizontal:22,paddingVertical:20,gap:10,width:"100%",maxWidth:460,alignSelf:"center"},loginButton:{flex:0,alignSelf:"stretch",minHeight:46},content:{paddingHorizontal:14,paddingTop:12,paddingBottom:24,gap:12},adminTabs:{flexDirection:"row",gap:7,marginBottom:2},adminTab:{flex:1,paddingVertical:11,borderRadius:11,backgroundColor:"#F0EDF5",alignItems:"center"},adminTabActive:{backgroundColor:c.purple},adminTabText:{fontSize:12,fontWeight:"700",color:c.muted},adminTabTextActive:{color:"#fff"},manageButton:{paddingHorizontal:13,paddingVertical:8,borderRadius:9,backgroundColor:c.pale},manageButtonText:{fontSize:12,fontWeight:"800",color:c.purple},studioActionMenu:{width:"100%",flexDirection:"row",flexWrap:"wrap",gap:7,paddingTop:5},manageAction:{paddingHorizontal:10,paddingVertical:7,borderRadius:8,backgroundColor:c.bg,borderWidth:1,borderColor:c.line},compactTableHeader:{flexDirection:"row",alignItems:"center",paddingVertical:6,borderBottomWidth:1,borderBottomColor:c.line},compactTableRow:{flexDirection:"row",alignItems:"center",gap:8,minHeight:44,paddingVertical:6,borderBottomWidth:1,borderBottomColor:c.line},compactNumber:{width:24,fontSize:11,color:c.muted,textAlign:"center",fontVariant:["tabular-nums"]},compactMain:{flex:1,minWidth:0},compactPrimary:{fontSize:12,fontWeight:"800",color:c.ink},compactSecondary:{fontSize:10,color:c.muted,marginTop:2},compactAction:{width:40,textAlign:"center",fontSize:11,fontWeight:"800",color:c.purple},compactExpanded:{padding:10,backgroundColor:c.bg,borderRadius:10,gap:7},ocrStatusRow:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",backgroundColor:"#FFF7E8",padding:9,borderRadius:9},ocrStatus:{fontSize:11,color:"#9A6A2A",lineHeight:16},header:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},brand:{fontSize:21,fontWeight:"900",color:c.ink},hint:{fontSize:12,color:c.muted,marginTop:5},logout:{color:c.purple,fontWeight:"700"},panel:{backgroundColor:"#fff",padding:14,borderRadius:16,borderWidth:1,borderColor:c.line,gap:10},statsGrid:{flexDirection:"row",flexWrap:"wrap",gap:8},statCard:{width:"31%",flexGrow:1,minWidth:90,backgroundColor:c.bg,borderRadius:12,padding:10,borderWidth:1,borderColor:c.line},statLabel:{fontSize:11,color:c.muted,fontWeight:"700"},statValue:{fontSize:22,fontWeight:"900",color:c.ink,marginTop:4},statCaption:{fontSize:10,color:c.muted,marginTop:3},errorHint:{fontSize:11,color:"#B95764",marginTop:3},heading:{fontSize:16,fontWeight:"800",color:c.ink},field:{gap:5},label:{fontSize:12,color:c.muted},input:{minHeight:44,borderWidth:1,borderColor:c.line,borderRadius:10,paddingHorizontal:11,paddingVertical:9,color:c.ink,backgroundColor:"#fff",fontSize:13},toggles:{flexDirection:"row",flexWrap:"wrap",gap:8},toggle:{borderWidth:1,borderColor:c.line,borderRadius:10,padding:9},toggleText:{fontSize:12,color:c.muted},toggleOn:{color:c.purple,fontWeight:"800"},buttons:{flexDirection:"row",gap:8},button:{backgroundColor:c.purple,minHeight:44,paddingHorizontal:12,paddingVertical:11,borderRadius:11,alignItems:"center",flex:1},buttonText:{color:"#fff",fontWeight:"800"},secondary:{minHeight:44,paddingHorizontal:12,paddingVertical:11,borderWidth:1,borderColor:c.line,borderRadius:12,alignItems:"center"},secondaryText:{color:c.ink},listHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},refresh:{color:c.purple,fontWeight:"700"},row:{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:10,paddingVertical:12,borderBottomWidth:1,borderBottomColor:c.line},rowName:{fontSize:13,fontWeight:"800",color:c.ink},rowMeta:{fontSize:11,color:c.muted,marginTop:3},action:{fontSize:12,color:c.purple,fontWeight:"700"},evidenceCard:{backgroundColor:c.bg,borderWidth:1,borderColor:c.line,borderRadius:13,padding:12,gap:7},evidenceStudio:{fontSize:13,fontWeight:"900",color:c.ink,flex:1},evidenceType:{fontSize:10,fontWeight:"800",color:c.purple,backgroundColor:c.pale,paddingHorizontal:8,paddingVertical:5,borderRadius:8},evidenceValue:{fontSize:13,lineHeight:20,color:c.ink},evidenceText:{fontSize:12,lineHeight:19,color:c.ink},rowActions:{flexDirection:"row",flexWrap:"wrap",gap:14,paddingTop:5},reject:{fontSize:12,color:"#B95764",fontWeight:"700"}});

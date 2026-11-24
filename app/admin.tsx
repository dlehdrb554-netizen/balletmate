import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Alert, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";

import { parseScheduleEvidence } from "../lib/schedule-structure";
import AdminCommunityReports from "../components/AdminCommunityReports";


type StudioRow = {
  id:string; name:string; latitude:number; longitude:number; district:string|null;
  address:string|null; phone:string|null; price_per_class:number|null; website_url:string|null;
  source_url:string|null; source_name:string|null; verified_at:string|null; image_urls:string[]|null; image_source_name:string|null; image_usage_note:string|null;
  adult_classes:boolean; kids_classes:boolean; is_active:boolean;
};

const blank = {name:"",latitude:"",longitude:"",district:"",address:"",phone:"",website_url:"",source_url:"",source_name:"",verified_at:"",image_urls:"",image_source_name:"",image_usage_note:"",price_per_class:"",adult_classes:true,kids_classes:false,is_active:false};
const STUDIO_PAGE_SIZE = 20;
const STUDIO_GALLERY_LIMIT = 30;
const parseStudioImageSlots=(value:string)=>String(value||"").includes("\n")?String(value||"").split(/\r?\n/):String(value||"").split(",");
const parseStudioImageUrls=(value:string)=>parseStudioImageSlots(value).map(v=>v.trim()).filter(Boolean);
const isSchool24PhotoSource=(item:any)=>{try{const url=new URL(String(item?.source_page_url||""));return url.hostname.toLowerCase().replace(/^www\./,"")==="school24.kr"&&url.pathname.toLowerCase().replace(/\/$/,"")==="/academy/a/j10-3000069628";}catch{return false;}};
const isNeisPhotoSource=(item:any)=>{const host=String(item?.source_host||(()=>{try{return new URL(item?.source_page_url||"").hostname}catch{return ""}})()).toLowerCase();return host==="neis.go.kr"||host.endsWith(".neis.go.kr")||host==="schoolinfo.go.kr"||host.endsWith(".schoolinfo.go.kr");};
const c = {ink:"#252238",muted:"#8B879A",purple:"#653BB7",pale:"#F2ECFF",line:"#E9E2F2",white:"#FFFFFF",bg:"#FBF9FF"};
const normalizeScheduleKey=(value:string)=>String(value||"").toLowerCase().replace(/[\s·,，、|/]+/g,"").trim();
const isValidStudioHomepageUrl=(value:string):boolean=>{
  if(!value.trim())return true;
  try{
    const url=new URL(value.trim());
    if(url.protocol!=="https:")return false;
    const host=url.hostname.toLowerCase().replace(/^www\./,"");
    return !["neis.go.kr","schoolinfo.go.kr","place.map.kakao.com","kakao.com"].some(domain=>host===domain||host.endsWith("."+domain));
  }catch{return false;}
};
const normalizeNaverBlogProfileUrl=(value:string):string|null=>{
  const input=String(value||"").trim();
  const match=input.match(/^https?:\/\/(?:www\.)?(?:m\.)?blog\.naver\.com\/([A-Za-z0-9._-]+)\/?(?:[?#].*)?$/i);
  return match?"https://blog.naver.com/"+match[1]:null;
};

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

const dedupeStudioRows=(input:any[])=>{
  const normalize=(value:any)=>String(value||"").toLocaleLowerCase("ko-KR").replace(/[^0-9a-z가-힣]/g,"");
  const unique:any[]=[];
  const byName=new Map<string,any[]>();
  for(const row of input){
    const nameKey=normalize(row.name),addressKey=normalize(row.address);
    const sameName=byName.get(nameKey)||[];
    const duplicate=sameName.some(prior=>{
      const priorAddress=normalize(prior.address);
      if(addressKey&&priorAddress)return addressKey===priorAddress;
      const lat1=Number(prior.latitude),lng1=Number(prior.longitude),lat2=Number(row.latitude),lng2=Number(row.longitude);
      if([lat1,lng1,lat2,lng2].every(Number.isFinite)){
        const dx=(lat1-lat2)*111,dy=(lng1-lng2)*111*Math.cos(lat1*Math.PI/180);
        return Math.sqrt(dx*dx+dy*dy)<=0.035;
      }
      return false;
    });
    if(!duplicate){unique.push(row);sameName.push(row);byName.set(nameKey,sameName);}
  }
  return {rows:unique,duplicates:input.length-unique.length};
};

export default function Admin() {
  const [adminTab,setAdminTab]=useState<"overview"|"review"|"publish"|"studios"|"owners"|"community">("overview");
  const [adminScrollRef]=useState<{current:ScrollView|null}>({current:null});
  const [studioEditPanelY]=useState<{current:number}>({current:0});
  const [studioActionId,setStudioActionId]=useState<string|null>(null);
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");
  const [session,setSession]=useState<any>(null);
  const [authorized,setAuthorized]=useState(false);
  const [checking,setChecking]=useState(true);
  const [busy,setBusy]=useState(false);
  const [rows,setRows]=useState<StudioRow[]>([]);
  const [ownerApplications,setOwnerApplications]=useState<any[]>([]);
  const [ownerReviewBusy,setOwnerReviewBusy]=useState(false);
  const [failedStudioThumbIds,setFailedStudioThumbIds]=useState<string[]>([]);
  const [studioSearch,setStudioSearch]=useState("");
  const [studioAppliedSearch,setStudioAppliedSearch]=useState("");
  const [studioVisibleLimit,setStudioVisibleLimit]=useState(100);
  const [studioDbOffset,setStudioDbOffset]=useState(0);
  const [studioHasMore,setStudioHasMore]=useState(false);
  const [studioListFilter,setStudioListFilter]=useState<"all"|"missing_website"|"active"|"inactive">("all");
  const [form,setForm]=useState({...blank});
  const [studioPhotoSlotCount,setStudioPhotoSlotCount]=useState(2);
  const [editing,setEditing]=useState<string|null>(null);
  const [csvText,setCsvText]=useState("");
  const [importing,setImporting]=useState(false);
  const [classStudio,setClassStudio]=useState<StudioRow|null>(null);
  const [classRows,setClassRows]=useState<any[]>([]);
  const [classEditing,setClassEditing]=useState<string|null>(null);
  const [classBusy,setClassBusy]=useState(false);
  const [classForm,setClassForm]=useState({title:"",audience:"adult" as "adult"|"kids"|"all",level:"",class_type:"",duration_minutes:"60",price:"",sessions:""});
  const [evidenceRows,setEvidenceRows]=useState<EvidenceCandidate[]>([]);
  const [totalEvidencePending,setTotalEvidencePending]=useState(0);
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
  const [verifiedPriceTotal,setVerifiedPriceTotal]=useState(0);
  const [verifiedScheduleTotal,setVerifiedScheduleTotal]=useState(0);
  const [publicPriceTotal,setPublicPriceTotal]=useState(0);
  const [publicScheduleTotal,setPublicScheduleTotal]=useState(0);
  const [verifiedPriceOffset,setVerifiedPriceOffset]=useState(0);
  const [verifiedScheduleOffset,setVerifiedScheduleOffset]=useState(0);
  const [publicPriceOffset,setPublicPriceOffset]=useState(0);
  const [publicScheduleOffset,setPublicScheduleOffset]=useState(0);
  const [evidenceBusy,setEvidenceBusy]=useState(false);
  const [scheduleClassCandidates,setScheduleClassCandidates]=useState<any[]>([]);
  const [scheduleClassCandidateTotal,setScheduleClassCandidateTotal]=useState(0);
  const [scheduleClassCandidateOffset,setScheduleClassCandidateOffset]=useState(0);
  const [candidateTitles,setCandidateTitles]=useState<Record<number,string>>({});
  const [candidateSessions,setCandidateSessions]=useState<Record<number,string>>({});
  const [dashboard,setDashboard]=useState<any>(null);
  const [dashboardBusy,setDashboardBusy]=useState(false);
  const [dashboardError,setDashboardError]=useState<string|null>(null);
  const [discoveryErrorRows,setDiscoveryErrorRows]=useState<any[]>([]);
  const [discoveryDuplicateTotal,setDiscoveryDuplicateTotal]=useState(0);
  const [retryBusy,setRetryBusy]=useState(false);
  const [duplicatePublicScheduleCount,setDuplicatePublicScheduleCount]=useState(0);
  const [reportRows,setReportRows]=useState<any[]>([]);
  const [reportsBusy,setReportsBusy]=useState(false);
  const [reportsError,setReportsError]=useState<string|null>(null);
  const [reportEditingId,setReportEditingId]=useState<number|null>(null);
  const publicPendingScheduleRows=useMemo(()=>{
    const seen=new Set<string>();
    return verifiedScheduleRows.filter(item=>!publishedScheduleCandidateIds.includes(item.id)).filter(item=>{
      const key=normalizeScheduleKey(item.normalized_value||item.candidate_value||"");
      const identity=key?item.studio_id+"|"+key:"id|"+item.id;
      if(seen.has(identity))return false;
      seen.add(identity);return true;
    });
  },[verifiedScheduleRows,publishedScheduleCandidateIds]);
  const publicPendingPriceRows=useMemo(
    ()=>verifiedPriceRows.filter(item=>!publishedCandidateIds.includes(item.id)),
    [verifiedPriceRows,publishedCandidateIds]
  );


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

 const loadDashboard=useCallback(async()=>{
    if(!supabase||!authorized)return;
    setDashboardBusy(true);setDashboardError(null);
    const [stats,logs]=await Promise.all([
      supabase.rpc("balletmate_admin_dashboard_stats"),
      supabase.from("studio_discovery_runs").select("id,region_name,queried_at,result_count,inserted_count,duplicate_count,error")
        .order("queried_at",{ascending:false}).limit(40)
    ]);
    if(stats.error){setDashboardError(stats.error.message);setDashboard(null);}
    else setDashboard(stats.data);
    if(!logs.error){
      setDiscoveryDuplicateTotal((logs.data||[]).reduce((sum:any,row:any)=>sum+Number(row.duplicate_count||0),0));
      const grouped=new Map<string,any>();
      for(const row of logs.data||[]){
        const key=String(row.error||"").trim();
        if(!key)continue;
        const prior=grouped.get(key);
        if(prior){prior.count++;continue;}
        grouped.set(key,{...row,count:1});
      }
      setDiscoveryErrorRows([...grouped.values()].slice(0,8));
    }else {setDiscoveryErrorRows([]);setDiscoveryDuplicateTotal(0);}
    setDashboardBusy(false);
  },[authorized]);

  const studioColumns="id,name,latitude,longitude,district,address,phone,website_url,source_url,source_name,verified_at,image_urls,image_source_name,image_usage_note,price_per_class,adult_classes,kids_classes,is_active,created_at";
  const load=useCallback(async()=>{
    if(!supabase||!authorized)return;
    setStudioAppliedSearch("");setStudioSearch("");
    setBusy(true);
    try{
      // Load one page only; do not block the UI with 10 sequential network requests.
      const {data,error}=await supabase.from("studios").select(studioColumns).order("name").order("id").range(0,STUDIO_PAGE_SIZE-1);
      if(error)throw error;
      const page=data||[];
      const deduped=dedupeStudioRows(page);
      setRows(deduped.rows as StudioRow[]);
      setStudioDbOffset(page.length);
      setStudioHasMore(page.length===STUDIO_PAGE_SIZE);
      setStudioVisibleLimit(100);
    }catch(error:any){Alert.alert("조회 실패",error?.message||"학원 목록을 불러오지 못했습니다.");}
    finally{setBusy(false);}
  },[authorized]);

  const loadMoreStudios=async()=>{
    if(!supabase||busy||!studioHasMore)return;
    setBusy(true);
    try{
      const start=studioDbOffset;
      const baseQuery=supabase.from("studios").select(studioColumns);
      const query=studioAppliedSearch
        ? baseQuery.or(`name.ilike.%${studioAppliedSearch}%,district.ilike.%${studioAppliedSearch}%,address.ilike.%${studioAppliedSearch}%,phone.ilike.%${studioAppliedSearch}%`)
        : baseQuery;
      const {data,error}=await query.order("name").order("id").range(start,start+STUDIO_PAGE_SIZE-1);
      if(error)throw error;
      const page=data||[];
      const deduped=dedupeStudioRows([...rows,...page]);
      setRows(deduped.rows as StudioRow[]);
      setStudioDbOffset(start+page.length);
      setStudioHasMore(page.length===STUDIO_PAGE_SIZE);
    }catch(error:any){Alert.alert("추가 조회 실패",error?.message||"다음 학원 목록을 불러오지 못했습니다.");}
    finally{setBusy(false);}
  };

  const searchStudiosServer=async()=>{
    const client=supabase;
    if(!client||busy)return;
    const term=studioSearch.trim().replace(/[%,_(),]/g," ").replace(/\\s+/g," ").trim();
    const compact=term.replace(/\\s+/g,"");
    setStudioAppliedSearch(term);setStudioSearch(term);
    setBusy(true);
    try{
      const baseQuery=()=>client.from("studios").select(studioColumns);
      // 이름/지역/주소의 일부 단어 및 띄어쓰기 없는 검색도 지원. 2글자 조각으로도 검색.
      const searchTerms=[...new Set([term,...term.split(" ").filter(Boolean),...(compact.length>2?compact.match(/.{1,2}/g)||[]:[])].filter(v=>v.length>=1))];
      let combined:any[]=[];
      if(!term){const {data,error}=await baseQuery().order("name").order("id").range(0,STUDIO_PAGE_SIZE-1);if(error)throw error;combined=data||[];}
      else for(const fragment of searchTerms){
        const {data,error}=await baseQuery().or(`name.ilike.%${fragment}%,district.ilike.%${fragment}%,address.ilike.%${fragment}%,phone.ilike.%${fragment}%`).order("name").order("id").range(0,STUDIO_PAGE_SIZE-1);
        if(error)throw error;combined.push(...(data||[]));
      }
      const deduped=dedupeStudioRows(combined);
      setRows(deduped.rows as StudioRow[]);
      setStudioDbOffset(combined.length);
      setStudioHasMore(combined.length>=STUDIO_PAGE_SIZE);
      setStudioVisibleLimit(100);
    }catch(error:any){Alert.alert("학원 검색 실패",error?.message||"전체 학원 검색을 완료하지 못했습니다.");}
    finally{setBusy(false);}
  };

  const readAllRows=async(makeQuery:()=>any)=>{
    const all:any[]=[];
    for(let offset=0;offset<10000;offset+=500){
      const {data,error}=await makeQuery().range(offset,offset+499);
      if(error)return {data:null,error};
      const page=data||[];all.push(...page);if(page.length<500)break;
    }
    return {data:all,error:null};
  };

  const loadOwnerApplications=useCallback(async()=>{
    if(!supabase||!authorized)return;
    setOwnerReviewBusy(true);
    const {data,error}=await supabase.from("studio_owner_applications")
      .select("id,user_id,studio_id,verification_method,verification_url,verification_code,status,review_note,created_at")
      .in("status",["pending","needs_info"]).order("created_at",{ascending:true}).limit(100);
    if(error){Alert.alert("원장 신청 조회 실패",error.message);setOwnerApplications([]);}
    else{
      const applications=data||[];const ids=[...new Set(applications.map((item:any)=>item.studio_id))];
      const studios=ids.length?await supabase.from("studios").select("id,name,phone").in("id",ids):{data:[],error:null};
      const names=new Map((studios.data||[]).map((row:any)=>[row.id,row.name]));
      const phones=new Map((studios.data||[]).map((row:any)=>[row.id,row.phone]));
      setOwnerApplications(applications.map((item:any)=>({...item,studio_name:names.get(item.studio_id)||"학원 정보 없음",public_phone:phones.get(item.studio_id)||null})));
    }
    setOwnerReviewBusy(false);
  },[authorized]);
  const openOwnerApplicationBlog=async(item:any)=>{if(!item.verification_url)return;Linking.openURL(item.verification_url).catch(()=>Alert.alert("공식 채널 열기 실패","채널을 열 수 없습니다."));};
  const reviewOwnerApplication=(item:any,decision:"approved"|"rejected"|"needs_info")=>{
    const label=decision==="approved"?"승인":decision==="rejected"?"반려":"추가 확인";
    Alert.alert("원장님 신청 "+label,item.studio_name+" · "+label+" 처리할까요?"+(decision==="approved"?"\n이 계정에 학원 관리 권한을 추가합니다.":""),[
      {text:"취소",style:"cancel"},
      {text:label,style:decision==="rejected"?"destructive":"default",onPress:async()=>{
        if(!supabase)return;setOwnerReviewBusy(true);
        const method=item.verification_method==="blog"?"네이버 블로그 인증":item.verification_method==="instagram"?"인스타그램 인증":item.verification_method==="phone"?"공개 전화 확인":"운영자 직접 확인";
        const note=decision==="approved"?method+" 확인 완료":decision==="rejected"?"운영 관계 확인 불가":"추가 확인 요청";
        const {error}=await supabase.rpc("admin_review_studio_owner_application",{p_application_id:item.id,p_decision:decision,p_note:note});
        if(error)Alert.alert("심사 처리 실패",error.message);else Alert.alert("심사 완료",label+" 처리했습니다.");
        await loadOwnerApplications();setOwnerReviewBusy(false);
      }}
    ]);
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
    const imageUrls=r.image_urls||[];
    setEditing(r.id);setStudioPhotoSlotCount(Math.min(STUDIO_GALLERY_LIMIT,Math.max(2,imageUrls.length+2)));setForm({name:r.name,latitude:String(r.latitude),longitude:String(r.longitude),district:r.district||"",address:r.address||"",phone:r.phone||"",website_url:r.website_url||"",source_url:r.source_url||"",source_name:r.source_name||"",verified_at:r.verified_at?r.verified_at.slice(0,10):"",image_urls:imageUrls.join("\n"),image_source_name:r.image_source_name||"",image_usage_note:r.image_usage_note||"",price_per_class:r.price_per_class==null?"":String(r.price_per_class),adult_classes:r.adult_classes,kids_classes:r.kids_classes,is_active:r.is_active});
  };
  useEffect(()=>{
    if(!editing||adminTab!=="studios")return;
    setTimeout(()=>adminScrollRef.current?.scrollTo({y:Math.max(0,studioEditPanelY.current-12),animated:true}),80);
  },[editing,adminTab]);
  const openReportStudioEdit=async(report:any)=>{
    if(!supabase||busy)return;
    setBusy(true);
    try{
      const {data,error}=await supabase.from("studios").select(studioColumns).eq("id",report.studio_id).maybeSingle();
      if(error)throw error;
      if(!data)throw new Error("제보 대상 학원을 찾을 수 없습니다.");
      setAdminTab("studios");
      setReportEditingId(Number(report.id));
      startEdit(data as StudioRow);
      setStudioActionId(null);
    }catch(error:any){Alert.alert("학원 정보 조회 실패",error?.message||"수정할 학원 정보를 불러오지 못했습니다.");}
    finally{setBusy(false);}
  };
  const showStudioChangeHistory=async(report:any)=>{
    if(!supabase)return;
    const {data,error}=await supabase.rpc("admin_list_studio_information_change_logs",{p_studio_id:report.studio_id});
    if(error){Alert.alert("변경 이력 조회 실패",error.message);return;}
    const logs=Array.isArray(data)?data:[];
    if(!logs.length){Alert.alert("변경 이력","이 학원의 관리자 정보 수정 이력이 아직 없습니다.");return;}
    const summary=logs.slice(0,8).map((log:any)=>new Date(log.changed_at).toLocaleString("ko-KR")+"\n"+Object.keys(log.changed_fields||{}).join(", ")).join("\n\n");
    Alert.alert("학원 정보 변경 이력",summary);
  };
  const filteredStudioRows=useMemo(()=>rows.filter(row=>{
    const q=studioSearch.trim().toLowerCase().replace(/\\s+/g,"");
    const initials=(value:string)=>value.split("").map(char=>{const code=char.charCodeAt(0)-44032;if(code<0||code>11171)return char;return "ㄱㄲㄴㄷㄸㄹㅁㅂㅃㅅㅆㅇㅈㅉㅊㅋㅌㅍㅎ"[Math.floor(code/588)]||char;}).join("");
    const fields=[row.name,row.district||"",row.address||"",row.phone||""];
    if(q&&!fields.some(value=>value.toLowerCase().replace(/\\s+/g,"").includes(q)||initials(value.replace(/\\s+/g,"")).includes(q)))return false;
    if(studioListFilter==="missing_website"&&!!row.website_url)return false;
    if(studioListFilter==="active"&&!row.is_active)return false;
    if(studioListFilter==="inactive"&&row.is_active)return false;
    return true;
  }),[rows,studioSearch,studioListFilter]);
  const visibleStudioRows=filteredStudioRows.slice(0,studioVisibleLimit);
  const reset=()=>{setEditing(null);setReportEditingId(null);setForm({...blank});setStudioPhotoSlotCount(2);};
  const save=async()=>{
    if(!supabase)return;
    if(!form.name.trim()||!form.latitude.trim()||!form.longitude.trim()){Alert.alert("필수 정보","학원명과 위도/경도를 입력하세요.");return;}
    if(!isValidStudioHomepageUrl(form.website_url)){Alert.alert("대표 홈페이지 주소","HTTPS 주소를 입력하세요. 일반 홈페이지, 네이버 블로그, 인스타그램만 등록할 수 있으며 NEIS·카카오 장소 주소는 사용할 수 없습니다.");return;}
    if(form.source_url.trim()&&!/^https?:\/\//i.test(form.source_url.trim())){Alert.alert("출처 주소","출처 URL은 http:// 또는 https:// 주소로 입력하세요.");return;}
    const verifiedAt=form.verified_at.trim()?new Date(form.verified_at.trim()):null;
    if(verifiedAt&&!Number.isFinite(verifiedAt.getTime())){Alert.alert("확인 날짜","확인 날짜는 YYYY-MM-DD 형식으로 입력하세요.");return;}
    const lat=Number(form.latitude),lng=Number(form.longitude),price=form.price_per_class.trim()?Number(form.price_per_class):null;
    if(!Number.isFinite(lat)||lat < -90||lat > 90||!Number.isFinite(lng)||lng < -180||lng > 180|| (price!==null&&(!Number.isFinite(price)||price<0))){Alert.alert("입력 확인","좌표 또는 가격이 올바르지 않습니다.");return;}
    const payload={name:form.name.trim(),latitude:lat,longitude:lng,district:form.district.trim()||null,address:form.address.trim()||null,phone:form.phone.trim()||null,website_url:form.website_url.trim()||null,source_url:form.source_url.trim()||null,source_name:form.source_name.trim()||null,verified_at:verifiedAt?verifiedAt.toISOString():null,image_urls:[],image_source_name:null,image_usage_note:null,price_per_class:price,adult_classes:form.adult_classes,kids_classes:form.kids_classes,is_active:form.is_active,updated_at:new Date().toISOString()};
    setBusy(true);
    const completedReportId=reportEditingId;
    const q=editing?supabase.from("studios").update(payload).eq("id",editing):supabase.from("studios").insert(payload);
    const {error}=await q;
    if(error)Alert.alert("저장 실패",error.message);
    else{
      let reportStatusError:any=null;
      if(completedReportId!==null){
        const result=await supabase.rpc("admin_update_studio_user_report",{p_report_id:completedReportId,p_status:"resolved"});
        reportStatusError=result.error;
      }
      reset();
      await load();
      if(completedReportId!==null)await loadReports();
      if(reportStatusError)Alert.alert("정보 수정 완료","학원 정보는 저장했지만 제보 상태 변경에 실패했습니다. 제보 목록에서 다시 처리해 주세요.\n"+reportStatusError.message);
      else Alert.alert("저장 완료",completedReportId!==null?"학원 정보 수정 및 제보 처리를 완료했습니다.":form.is_active?"앱 공개 목록에 반영됩니다.":"비공개 상태로 저장했습니다.");
    }
    setBusy(false);
  };
  const deleteHomepageCandidate=async(studio:StudioRow)=>{
    if(!supabase)return;
    Alert.alert("후보 홈페이지 삭제",studio.name+"에 저장된 미검증 홈페이지 주소를 삭제할까요? 학원 정보와 카카오맵 출처는 유지됩니다.",[
      {text:"취소",style:"cancel"},
      {text:"삭제",style:"destructive",onPress:async()=>{
        setBusy(true);
        const {error}=await supabase!.from("studios").update({
          website_url:null,
          source_name:studio.source_name?.includes("홈페이지 검색 후보")?null:studio.source_name,
          verified_at:studio.source_name?.includes("홈페이지 검색 후보")?null:studio.verified_at,
          updated_at:new Date().toISOString()
        }).eq("id",studio.id);
        if(error)Alert.alert("홈페이지 후보 삭제 실패",error.message);
        else{
          setRows(current=>current.map(row=>row.id===studio.id?{...row,website_url:null,source_name:studio.source_name?.includes("홈페이지 검색 후보")?null:row.source_name,verified_at:studio.source_name?.includes("홈페이지 검색 후보")?null:row.verified_at}:row));
          Alert.alert("삭제 완료","미검증 홈페이지 주소를 삭제했습니다.");
        }
        setBusy(false);
      }}
    ]);
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
      if(!isValidStudioHomepageUrl(website)||(source&&!/^https:\/\//i.test(source))){skipped++;continue;}
      const imgs:string[]=[];
      
      const price=get(row,"price_per_class"),verifiedRaw=get(row,"verified_at"),verifiedDate=verifiedRaw?new Date(verifiedRaw):null;
      if((price&&(!Number.isFinite(Number(price))||Number(price)<0))||(verifiedDate&&!Number.isFinite(verifiedDate.getTime()))){skipped++;continue;}
      payload.push({name,latitude,longitude,district:get(row,"district")||null,address:address||null,phone:phone||null,website_url:website||null,source_url:source||null,source_name:get(row,"source_name")||null,verified_at:verifiedDate?verifiedDate.toISOString():null,image_urls:[],image_source_name:null,image_usage_note:null,price_per_class:price?Number(price):null,adult_classes:/^(1|true|yes|y)$/i.test(get(row,"adult_classes")),kids_classes:/^(1|true|yes|y)$/i.test(get(row,"kids_classes")),is_active:/^(1|true|yes|y)$/i.test(get(row,"is_active"))});
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
  const cleanupUnrelatedStudios=()=>Alert.alert("발레 무관 업체 자동 삭제","병원·의원·약국·헬스장·미용실 등 명백히 무관한 업체만 삭제합니다. 원장 소유권이 연결된 학원은 보호됩니다. 삭제 전 데이터는 복구용 이력으로 보관합니다.",[{text:"취소",style:"cancel"},{text:"자동 삭제 실행",style:"destructive",onPress:async()=>{if(!supabase||busy)return;setBusy(true);try{const {data,error}=await supabase.rpc("admin_cleanup_unrelated_studios");if(error)throw error;const deleted=Number(data?.deleted_count)||0;const deletedIds=Array.isArray(data?.deleted_ids)?data.deleted_ids.map(String):[];setRows(current=>current.filter(row=>!deletedIds.includes(row.id)));Alert.alert("자동 정리 완료",deleted+"개 업체를 삭제했습니다. 삭제 전 데이터는 복구용 이력에 보관했습니다.");}catch(error:any){Alert.alert("자동 정리 실패",error?.message||"자동 정리를 실행하지 못했습니다. SQL 설정을 확인해 주세요.");}finally{setBusy(false);}}}]);
  const remove=(id:string,name:string)=>Alert.alert("학원 삭제",name+" 정보를 삭제할까요?",[{text:"취소",style:"cancel"},{text:"삭제",style:"destructive",onPress:async()=>{setBusy(true);try{const {error}=await supabase!.from("studios").delete().eq("id",id);if(error)throw error;setRows(current=>current.filter(row=>row.id!==id));setStudioActionId(null);Alert.alert("삭제 완료",name+" 학원을 삭제했습니다.");}catch(error:any){Alert.alert("삭제 실패",error?.message||"학원 삭제 중 오류가 발생했습니다.");}finally{setBusy(false);}}}]);
  const field=(label:string,key:keyof typeof blank,keyboard:any="default")=><View style={styles.field}><Text style={styles.label}>{label}</Text><TextInput style={[styles.input,(key==="image_urls"||key==="image_usage_note")&&{minHeight:72,textAlignVertical:"top"}]} multiline={key==="image_urls"||key==="image_usage_note"} value={String(form[key])} onChangeText={v=>setForm(f=>({...f,[key]:v}))} keyboardType={keyboard} placeholder={label}/></View>;
  const toggle=(label:string,key:"adult_classes"|"kids_classes"|"is_active")=><Pressable onPress={()=>setForm(f=>({...f,[key]:!f[key]}))} style={styles.toggle}><Text style={[styles.toggleText,form[key]&&styles.toggleOn]}>{form[key]?"✓ ":"○ "}{label}</Text></Pressable>;

  if(checking)return <SafeAreaView style={styles.safe}><ActivityIndicator style={{marginTop:50}} color={c.purple}/></SafeAreaView>;
  if(!session)return <SafeAreaView style={styles.safe}><KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==="ios"?"padding":"height"}><ScrollView contentContainerStyle={{flexGrow:1,justifyContent:"center"}} keyboardShouldPersistTaps="handled"><View style={styles.login}><Ionicons name="shield-checkmark-outline" size={38} color={c.purple} style={{alignSelf:"center",marginBottom:4}} /><Text style={[styles.brand,{textAlign:"center"}]}>Balletmate 관리자</Text><Text style={styles.hint}>관리자 계정으로 로그인하세요.</Text><TextInput style={styles.input} value={username} onChangeText={setUsername} placeholder="관리자 아이디" autoCapitalize="none"/><TextInput style={styles.input} value={password} onChangeText={setPassword} placeholder="비밀번호" secureTextEntry/><Pressable style={[styles.button,styles.loginButton]} onPress={login} disabled={busy}><Text style={styles.buttonText}>{busy?"처리 중…":"로그인"}</Text></Pressable></View></ScrollView></KeyboardAvoidingView></SafeAreaView>;
  if(!authorized)return <SafeAreaView style={styles.safe}><View style={styles.login}><Text style={styles.brand}>관리자 권한 없음</Text><Text style={styles.hint}>이 계정은 Balletmate 관리자 목록에 등록되지 않았습니다.</Text><Pressable style={[styles.button,styles.loginButton]} onPress={logout}><Text style={styles.buttonText}>로그아웃</Text></Pressable></View></SafeAreaView>;

  return <SafeAreaView style={styles.safe}><KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==="ios"?"padding":"height"}><ScrollView ref={node=>{adminScrollRef.current=node;}} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
    <View style={styles.header}><View><Text style={styles.brand}>Balletmate 관리자</Text><Text style={styles.hint}>학원 데이터 관리 · {rows.length.toLocaleString("ko-KR")}개</Text></View><Pressable onPress={logout}><Text style={styles.logout}>로그아웃</Text></Pressable></View>
    <View style={styles.adminTabs}>{([{key:"overview",label:"현황"},{key:"studios",label:"학원 관리"},{key:"owners",label:"원장 심사"},{key:"community",label:"커뮤니티 신고"}] as const).map(item=><Pressable key={item.key} onPress={()=>setAdminTab(item.key)} style={[styles.adminTab,adminTab===item.key&&styles.adminTabActive]}><Text style={[styles.adminTabText,adminTab===item.key&&styles.adminTabTextActive]}>{item.label}</Text></Pressable>)}</View>
        {adminTab==="community"&&<View style={styles.panel}><AdminCommunityReports /></View>}
        {adminTab==="owners"&&<View style={styles.panel}>
          <View style={styles.listHead}><Text style={styles.heading}>학원 관리자 권한 신청</Text><Pressable onPress={loadOwnerApplications} disabled={ownerReviewBusy}><Text style={styles.refresh}>{ownerReviewBusy?"조회 중…":"새로고침"}</Text></Pressable></View>
          <Text style={styles.hint}>공개 전화번호 확인, 대표 홈페이지·인스타그램 인증 코드 또는 직접 확인으로 운영 관계를 확인한 후 승인하세요. 사업자번호·대표자·주소·등록증은 수집하지 않습니다.</Text>
          {ownerApplications.length?ownerApplications.map(item=><View key={item.id} style={{borderTopWidth:1,borderTopColor:"#E9E2F2",paddingTop:12,marginTop:12}}>
            <Text style={{fontSize:14,fontWeight:"900",color:"#252238"}}>{item.studio_name}</Text>
            <Text style={styles.hint}>확인 방법: {item.verification_method==="blog"?"네이버 블로그 인증":item.verification_method==="instagram"?"인스타그램 인증":item.verification_method==="phone"?"공개 전화 확인":"운영자 직접 확인"}</Text>
            {item.verification_method==="phone"&&<Text style={styles.hint}>학원 공개 전화번호: {item.public_phone||"전화번호 미등록 — 다른 방법으로 확인"}</Text>}
            {(item.verification_method==="blog"||item.verification_method==="instagram")&&<Text style={styles.hint}>인증 코드: {item.verification_code||"-"} · 공식 채널: {item.verification_url||"-"}</Text>}
            <Text style={styles.hint}>신청 시각: {new Date(item.created_at).toLocaleString("ko-KR")}</Text>
            <View style={{flexDirection:"row",flexWrap:"wrap",gap:7,marginTop:9}}>
              {(item.verification_method==="blog"||item.verification_method==="instagram")&&<Pressable onPress={()=>openOwnerApplicationBlog(item)} style={{backgroundColor:"#F2ECFF",padding:10,borderRadius:9}}><Text style={{fontSize:11,fontWeight:"800",color:"#653BB7"}}>공식 채널 열기</Text></Pressable>}
              <Pressable disabled={ownerReviewBusy} onPress={()=>reviewOwnerApplication(item,"approved")} style={{backgroundColor:"#EAF6EF",padding:10,borderRadius:9}}><Text style={{fontSize:11,fontWeight:"800",color:"#18794E"}}>승인</Text></Pressable>
              <Pressable disabled={ownerReviewBusy} onPress={()=>reviewOwnerApplication(item,"needs_info")} style={{backgroundColor:"#FFF7E8",padding:10,borderRadius:9}}><Text style={{fontSize:11,fontWeight:"800",color:"#8A641C"}}>추가 확인</Text></Pressable>
              <Pressable disabled={ownerReviewBusy} onPress={()=>reviewOwnerApplication(item,"rejected")} style={{backgroundColor:"#FFF1F1",padding:10,borderRadius:9}}><Text style={{fontSize:11,fontWeight:"800",color:"#A33342"}}>반려</Text></Pressable>
            </View>
          </View>):<Text style={styles.hint}>현재 심사 대기 중인 원장님 신청이 없습니다.</Text>}
        </View>}
        {adminTab==="overview"&&<>
<View style={styles.panel}><View style={styles.listHead}><Text style={styles.heading}>학원 데이터 운영 현황</Text><Pressable onPress={loadDashboard} disabled={dashboardBusy}><Text style={styles.refresh}>{dashboardBusy?"조회 중…":"새로고침"}</Text></Pressable></View>{dashboardError?<Text style={styles.hint}>대시보드 SQL 적용 필요 또는 조회 오류: {dashboardError}</Text>:dashboard?<><View style={styles.statsGrid}>{[
      ["학원",dashboard.studios?.total??0,"공개 "+(dashboard.studios?.active??0)],
      ["사용자 제보",dashboard.reports?.pending??0,"학원 정보 검토 요청"],
      ["지역 발견",dashboard.discovery?.last_inserted??0,"최근 실행 신규 발견"]
    ].map(([label,value,caption])=><View key={String(label)} style={styles.statCard}><Text style={styles.statLabel}>{label}</Text><Text style={styles.statValue}>{Number(value).toLocaleString("ko-KR")}</Text><Text style={styles.statCaption}>{caption}</Text></View>)}</View><Text style={styles.hint}>최근 지역 탐색: {dashboard.discovery?.last_region||"실행 기록 없음"} · {dashboard.discovery?.last_run_at?new Date(dashboard.discovery.last_run_at).toLocaleString("ko-KR"):"기록 없음"}</Text>{dashboard.discovery?.last_error&&<Text style={styles.errorHint}>최근 탐색 오류: {[...new Set(String(dashboard.discovery.last_error).split(" | ").map((x:string)=>x.trim()).filter(Boolean))].join(" · ")}</Text>}</>:<Text style={styles.hint}>통계를 불러오는 중입니다.</Text>}</View>
    <View style={styles.panel}><View style={styles.listHead}><View style={{flex:1,minWidth:0}}><Text style={styles.heading}>탐색 오류 기록</Text><Text style={styles.hint}>최근 40회 중복 제외 {discoveryDuplicateTotal.toLocaleString("ko-KR")}건 · 오류 {discoveryErrorRows.length}종</Text></View><View style={{flexDirection:"row",gap:12}}><Pressable onPress={loadDashboard}><Text style={styles.refresh}>새로고침</Text></Pressable><Pressable onPress={clearDiscoveryHistory} disabled={dashboardBusy}><Text style={[styles.refresh,{color:"#B95764"}]}>기록 초기화</Text></Pressable></View></View>{discoveryErrorRows.map((item:any,index:number)=><View key={"discovery-error-"+index} style={styles.evidenceCard}><Text style={styles.evidenceStudio}>{item.region_name} · {new Date(item.queried_at).toLocaleString("ko-KR")} · 최근 40건 중 {item.count}회</Text><Text style={styles.errorHint}>{item.error}</Text></View>)}{!discoveryErrorRows.length&&!dashboardBusy&&<Text style={styles.hint}>최근 탐색 오류가 없습니다.</Text>}</View><View style={styles.panel}><View style={styles.listHead}><Text style={styles.heading}>학원 정보 사용자 제보 ({reportRows.filter(r=>r.status==="pending"||r.status==="in_review").length})</Text><Pressable onPress={loadReports}><Text style={styles.refresh}>{reportsBusy?"조회 중…":"새로고침"}</Text></Pressable></View>{reportsError?<View><Text style={styles.hint}>제보 조회 오류: {reportsError}</Text><Pressable onPress={loadReports}><Text style={styles.action}>다시 시도</Text></Pressable></View>:reportRows.length?reportRows.map(report=><View key={"report-"+report.id} style={styles.evidenceCard}><Text style={styles.evidenceStudio}>{report.studio_name||"학원"} · {report.category} · {new Date(report.created_at).toLocaleDateString("ko-KR")}</Text><Text style={styles.evidenceText}>{report.description}</Text><Text style={styles.rowMeta}>상태: {report.status==="pending"?"대기":report.status==="in_review"?"검토 중":report.status==="resolved"?"처리 완료":"기각"}</Text><View style={styles.rowActions}><Pressable onPress={()=>openReportStudioEdit(report)}><Text style={styles.action}>학원 정보 수정</Text></Pressable><Pressable onPress={()=>showStudioChangeHistory(report)}><Text style={styles.action}>변경 이력</Text></Pressable>{(report.status==="pending"||report.status==="in_review")&&<><Pressable onPress={()=>updateReportStatus(report.id,"in_review")}><Text style={styles.action}>검토 중</Text></Pressable><Pressable onPress={()=>updateReportStatus(report.id,"resolved")}><Text style={styles.action}>처리 완료</Text></Pressable><Pressable onPress={()=>updateReportStatus(report.id,"rejected")}><Text style={styles.reject}>기각</Text></Pressable></>}</View></View>):<Text style={styles.hint}>접수된 제보가 없습니다.</Text>}</View>
        </>}
    {adminTab==="studios"&&<>
<View style={styles.panel} onLayout={event=>{studioEditPanelY.current=event.nativeEvent.layout.y;}}><Text style={styles.heading}>{reportEditingId!==null?"제보 기반 학원 정보 수정":editing?"학원 정보 수정":"학원 등록"}</Text>{reportEditingId!==null&&<Text style={styles.hint}>제보 내용을 확인해 학원 정보를 수정하고 저장하면 해당 제보가 처리 완료로 변경됩니다. 폐업·이전이 확인된 경우 앱에 공개 토글을 끄세요.</Text>}{field("학원명 *","name")}{field("위도 *","latitude","decimal-pad")}{field("경도 *","longitude","decimal-pad")}{field("지역/구","district")}{field("주소","address")}{field("전화번호","phone","phone-pad")}{field("대표 홈페이지 URL (일반 홈페이지 · 네이버 블로그 · 인스타그램)","website_url")}{field("정보 출처 URL (https://)","source_url")}{field("정보 출처명","source_name")}{field("정보 확인일 (YYYY-MM-DD)","verified_at")}<Text style={styles.hint}>대표 홈페이지 URL에는 일반 홈페이지, 네이버 블로그 또는 인스타그램 주소를 입력하세요. NEIS 등록 정보는 홈페이지로 사용하지 않습니다.</Text>{field("1회 수업 가격 (원)","price_per_class","numeric")}
      <View style={styles.toggles}>{toggle("성인 수업","adult_classes")}{toggle("키즈 수업","kids_classes")}{toggle("앱에 공개","is_active")}</View>
      <View style={styles.buttons}>{editing&&<Pressable style={styles.secondary} onPress={reset}><Text style={styles.secondaryText}>취소</Text></Pressable>}<Pressable style={styles.button} onPress={save} disabled={busy}><Text style={styles.buttonText}>{busy?"저장 중…":editing?"수정 저장":"학원 등록"}</Text></Pressable></View>
    </View>
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
    <View style={styles.panel}><Text style={styles.heading}>학원 일괄 등록 (CSV)</Text><Text style={styles.hint}>필수 열: name, latitude, longitude · 선택 열: district,address,phone,website_url,source_url,source_name,price_per_class,adult_classes,kids_classes,is_active · 최대 50개</Text><TextInput style={[styles.input,{minHeight:120,textAlignVertical:"top"}]} multiline value={csvText} onChangeText={setCsvText} placeholder={"name,latitude,longitude,district,address,phone,website_url,source_url,source_name,price_per_class,adult_classes,kids_classes,is_active\n발레학원,37.56,126.97,중구,서울 중구,02-000-0000,https://example.com,https://example.com,공식 홈페이지,25000,true,false,false"} /><Pressable style={styles.button} onPress={importCsv} disabled={importing||busy}><Text style={styles.buttonText}>{importing?"등록 중…":"CSV 데이터 등록"}</Text></Pressable></View>
    <View style={styles.panel}><View style={styles.listHead}><Text style={styles.heading}>등록 학원 · 화면 {visibleStudioRows.length}/{filteredStudioRows.length} · 조회 {rows.length}개</Text><Pressable onPress={load}><Text style={styles.refresh}>새로고침</Text></Pressable></View><Pressable style={[styles.secondary,{marginBottom:10}]} disabled={busy} onPress={cleanupUnrelatedStudios}><Text style={styles.secondaryText}>발레 무관 업체 자동 삭제</Text></Pressable>
      <TextInput style={styles.input} value={studioSearch} onChangeText={value=>{setStudioSearch(value);setStudioVisibleLimit(100);}} placeholder="학원명·지역·주소·전화 검색" autoCapitalize="none"/><View style={styles.buttons}><Pressable style={styles.button} disabled={busy} onPress={searchStudiosServer}><Text style={styles.buttonText}>전체 학원 검색</Text></Pressable><Pressable style={styles.secondary} disabled={busy} onPress={()=>{setStudioSearch("");setStudioAppliedSearch("");load();}}><Text style={styles.secondaryText}>초기화</Text></Pressable></View>
      <View style={styles.toggles}>{([{key:"all",label:"전체"},{key:"missing_website",label:"홈페이지 없음"},{key:"active",label:"공개"},{key:"inactive",label:"비공개"}] as const).map(option=><Pressable key={option.key} style={[styles.toggle,studioListFilter===option.key&&{borderColor:c.purple,backgroundColor:c.pale}]} onPress={()=>{setStudioListFilter(option.key);setStudioVisibleLimit(100);}}><Text style={[styles.toggleText,studioListFilter===option.key&&styles.toggleOn]}>{option.label}</Text></Pressable>)}</View>{busy&&<ActivityIndicator color={c.purple}/>}
            {visibleStudioRows.map(r=><View key={r.id} style={styles.row}><View style={{flex:1,minWidth:0}}><Text style={styles.rowName} numberOfLines={1}>{r.name}</Text><Text style={styles.rowMeta}>{r.district||"지역 미입력"} · {r.is_active?"공개":"비공개"}</Text></View><View style={{flexDirection:"row",flexWrap:"wrap",gap:6,alignItems:"center"}}><Pressable style={styles.manageButton} onPress={()=>setStudioActionId(current=>current===r.id?null:r.id)}><Text style={styles.manageButtonText}>{studioActionId===r.id?"닫기":"관리"}</Text></Pressable></View>{studioActionId===r.id&&<View style={styles.studioActionMenu}><Pressable style={styles.manageAction} onPress={()=>{setStudioActionId(null);startEdit(r);}}><Text style={styles.manageButtonText}>정보 수정</Text></Pressable><Pressable style={styles.manageAction} onPress={()=>{setStudioActionId(null);setClassStudio(r);resetClass();}}><Text style={styles.manageButtonText}>수업 관리</Text></Pressable>{String(r.source_name||"").includes("홈페이지 검색 후보")&&<Pressable style={styles.manageAction} onPress={()=>{setStudioActionId(null);deleteHomepageCandidate(r);}}><Text style={[styles.manageButtonText,{color:"#B95764"}]}>후보 홈페이지 삭제</Text></Pressable>}<Pressable style={styles.manageAction} onPress={()=>{setStudioActionId(null);remove(r.id,r.name);}}><Text style={[styles.manageButtonText,{color:"#B95764"}]}>삭제</Text></Pressable></View>}</View>)}
      {visibleStudioRows.length<filteredStudioRows.length&&<Pressable style={styles.secondary} onPress={()=>setStudioVisibleLimit(limit=>limit+100)}><Text style={styles.secondaryText}>학원 100개 더 보기 ({visibleStudioRows.length}/{filteredStudioRows.length})</Text></Pressable>}
      {studioHasMore&&<Pressable style={styles.secondary} disabled={busy} onPress={loadMoreStudios}><Text style={styles.secondaryText}>{busy?"조회 중…":"다음 학원 20개 불러오기"}</Text></Pressable>}
      {!rows.length&&!busy&&<Text style={styles.hint}>등록된 학원이 없습니다.</Text>}{rows.length>0&&!visibleStudioRows.length&&<Text style={styles.hint}>검색/필터 조건에 맞는 학원이 없습니다.</Text>}
    </View>
    </>}
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
export function ErrorBoundary({error,retry}:{error:any;retry:()=>void}){
  const detail=String(error?.stack||error?.message||error||"알 수 없는 오류");
  return <SafeAreaView style={styles.safe}><View style={styles.login}><Text style={styles.brand}>관리자 화면 오류</Text><Text style={styles.hint}>오류 위치를 확인할 수 있도록 상세 내용을 표시합니다.</Text><ScrollView style={{maxHeight:320}}><Text selectable style={styles.errorHint}>{detail}</Text></ScrollView><Pressable style={[styles.button,styles.loginButton]} onPress={retry}><Text style={styles.buttonText}>다시 시도</Text></Pressable></View></SafeAreaView>;
}
const styles=StyleSheet.create({safe:{flex:1,backgroundColor:c.bg},login:{flex:1,justifyContent:"center",paddingHorizontal:22,paddingVertical:20,gap:10,width:"100%",maxWidth:460,alignSelf:"center"},loginButton:{flex:0,alignSelf:"stretch",minHeight:46},content:{paddingHorizontal:14,paddingTop:12,paddingBottom:24,gap:12},adminTabs:{flexDirection:"row",gap:7,marginBottom:2,flexWrap:"wrap"},adminTab:{flex:1,minWidth:58,paddingVertical:11,borderRadius:11,backgroundColor:"#F0EDF5",alignItems:"center"},adminTabActive:{backgroundColor:c.purple},adminTabText:{fontSize:12,fontWeight:"700",color:c.muted},adminTabTextActive:{color:"#fff"},manageButton:{paddingHorizontal:13,paddingVertical:8,borderRadius:9,backgroundColor:c.pale},studioListThumb:{width:76,height:76,borderRadius:11,backgroundColor:c.bg,borderWidth:1,borderColor:c.line,alignItems:"center",justifyContent:"center",overflow:"hidden"},studioListImage:{width:76,height:76,borderRadius:11,backgroundColor:c.bg},photoSlot:{width:"48%",minWidth:145,flexGrow:1,padding:9,borderWidth:1,borderColor:c.line,borderRadius:12,backgroundColor:c.bg,gap:7},photoSlotImage:{width:"100%",height:116,borderRadius:9,backgroundColor:"#EEEAF4"},photoSlotEmpty:{width:"100%",height:116,borderRadius:9,backgroundColor:"#F4F1F8",alignItems:"center",justifyContent:"center",gap:5},photoSlotInput:{minHeight:38,borderWidth:1,borderColor:c.line,borderRadius:8,paddingHorizontal:8,paddingVertical:7,color:c.ink,backgroundColor:"#fff",fontSize:10},manageButtonText:{fontSize:12,fontWeight:"800",color:c.purple},studioActionMenu:{width:"100%",flexDirection:"row",flexWrap:"wrap",gap:7,paddingTop:5},manageAction:{paddingHorizontal:10,paddingVertical:7,borderRadius:8,backgroundColor:c.bg,borderWidth:1,borderColor:c.line},compactButton:{flex:0,alignSelf:"flex-start",minHeight:34,paddingHorizontal:9,paddingVertical:7,borderRadius:8,backgroundColor:c.bg,borderWidth:1,borderColor:c.line,alignItems:"center",justifyContent:"center"},compactButtonText:{fontSize:11,fontWeight:"800",color:c.ink},reviewToolbar:{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:7},toolbarButton:{minHeight:38,paddingHorizontal:12,paddingVertical:8,borderRadius:9,borderWidth:1,borderColor:c.line,backgroundColor:c.bg,alignItems:"center",justifyContent:"center"},compactTableHeader:{flexDirection:"row",alignItems:"center",paddingVertical:6,borderBottomWidth:1,borderBottomColor:c.line},compactTableRow:{flexDirection:"row",alignItems:"center",gap:8,minHeight:44,paddingVertical:6,borderBottomWidth:1,borderBottomColor:c.line},evidenceSelectButton:{minWidth:38,minHeight:40,alignItems:"center",justifyContent:"center",paddingHorizontal:5},scheduleReviewCard:{padding:11,borderRadius:12,borderWidth:1,borderColor:c.line,backgroundColor:c.bg,gap:9},scheduleReviewHeader:{flexDirection:"row",alignItems:"flex-start",gap:9},scheduleReviewIndex:{width:26,fontSize:11,color:c.muted,fontWeight:"800",paddingTop:2},scheduleReviewActions:{flexDirection:"row",flexWrap:"wrap",gap:7,justifyContent:"flex-end"},scheduleReviewButton:{minHeight:34,paddingHorizontal:12,paddingVertical:7,borderRadius:8,borderWidth:1,borderColor:c.line,backgroundColor:"#fff",alignItems:"center",justifyContent:"center"},scheduleReviewButtonText:{fontSize:11,fontWeight:"800",color:c.purple},compactNumber:{width:24,fontSize:11,color:c.muted,textAlign:"center",fontVariant:["tabular-nums"]},compactMain:{flex:1,minWidth:0},compactPrimary:{fontSize:12,fontWeight:"800",color:c.ink},compactSecondary:{fontSize:10,color:c.muted,marginTop:2},compactAction:{width:40,textAlign:"center",fontSize:11,fontWeight:"800",color:c.purple},compactExpanded:{padding:10,backgroundColor:c.bg,borderRadius:10,gap:7},photoReviewCard:{width:"100%",flexDirection:"column",alignItems:"stretch",gap:10,padding:12,borderWidth:1,borderColor:c.line,borderRadius:13,backgroundColor:"#fff"},photoReviewSelect:{alignSelf:"flex-end",padding:2},photoReviewBody:{width:"100%",flexDirection:"row",alignItems:"flex-start",gap:12},photoFilterRow:{flexDirection:"row",gap:6,flexWrap:"wrap"},photoFilterButton:{paddingVertical:7,paddingHorizontal:12,borderRadius:18,borderWidth:1,borderColor:c.line,backgroundColor:"#fff"},photoFilterButtonActive:{backgroundColor:"#653BB7",borderColor:"#653BB7"},photoFilterText:{fontSize:12,fontWeight:"700",color:c.muted},photoFilterTextActive:{color:"#fff"},photoSuspectLabel:{fontSize:10,fontWeight:"700",color:"#A56A18",backgroundColor:"#FFF6E7",paddingHorizontal:6,paddingVertical:3,borderRadius:5,alignSelf:"flex-start"},photoFaceStatus:{fontSize:10,fontWeight:"700",color:"#653BB7",paddingVertical:2},photoReviewImage:{width:156,height:156,borderRadius:10,backgroundColor:c.bg},photoReviewImageFallback:{width:112,height:112,borderRadius:10,backgroundColor:c.bg,alignItems:"center",justifyContent:"center",padding:4},photoReviewInfo:{flex:1,minWidth:0,gap:5},photoReviewLinks:{flexDirection:"row",flexWrap:"wrap",gap:10},photoReviewLink:{fontSize:11,fontWeight:"700",color:"#653BB7"},photoReviewActions:{width:"100%",flexDirection:"row",flexWrap:"wrap",gap:7,marginTop:2},photoReviewReject:{flex:1,minWidth:90,minHeight:38,paddingHorizontal:8,paddingVertical:7,borderRadius:8,borderWidth:1,borderColor:"#D9D4E8",backgroundColor:"#F7F5FB",alignItems:"center",justifyContent:"center"},photoReviewRejectText:{fontSize:12,fontWeight:"800",color:"#653BB7"},photoReviewDelete:{flex:1,minHeight:34,paddingHorizontal:8,paddingVertical:6,borderRadius:8,borderWidth:1,borderColor:"#E6C5C9",backgroundColor:"#FFF5F5",alignItems:"center",justifyContent:"center"},photoReviewDeleteText:{fontSize:12,fontWeight:"800",color:"#A33342"},photoReviewApprove:{flex:1,minWidth:110,minHeight:38,paddingHorizontal:8,paddingVertical:7,borderRadius:8,backgroundColor:"#653BB7",alignItems:"center",justifyContent:"center"},photoReviewApproveText:{fontSize:12,fontWeight:"900",color:"#FFFFFF"},header:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},brand:{fontSize:21,fontWeight:"900",color:c.ink},hint:{fontSize:12,color:c.muted,marginTop:5},logout:{color:c.purple,fontWeight:"700"},panel:{backgroundColor:"#fff",padding:14,borderRadius:16,borderWidth:1,borderColor:c.line,gap:10},statsGrid:{flexDirection:"row",flexWrap:"wrap",gap:8},statCard:{width:"31%",flexGrow:1,minWidth:90,backgroundColor:c.bg,borderRadius:12,padding:10,borderWidth:1,borderColor:c.line},statLabel:{fontSize:11,color:c.muted,fontWeight:"700"},statValue:{fontSize:22,fontWeight:"900",color:c.ink,marginTop:4},statCaption:{fontSize:10,color:c.muted,marginTop:3},errorHint:{fontSize:11,color:"#B95764",marginTop:3},heading:{fontSize:16,fontWeight:"800",color:c.ink},field:{gap:5},label:{fontSize:12,color:c.muted},input:{minHeight:44,borderWidth:1,borderColor:c.line,borderRadius:10,paddingHorizontal:11,paddingVertical:9,color:c.ink,backgroundColor:"#fff",fontSize:13},toggles:{flexDirection:"row",flexWrap:"wrap",gap:8},toggle:{borderWidth:1,borderColor:c.line,borderRadius:10,padding:9},toggleText:{fontSize:12,color:c.muted},toggleOn:{color:c.purple,fontWeight:"800"},buttons:{flexDirection:"row",gap:8},button:{backgroundColor:c.purple,minHeight:44,paddingHorizontal:12,paddingVertical:11,borderRadius:11,alignItems:"center",flex:1},buttonText:{color:"#fff",fontWeight:"800"},secondary:{minHeight:44,paddingHorizontal:12,paddingVertical:11,borderWidth:1,borderColor:c.line,borderRadius:12,alignItems:"center"},secondaryText:{color:c.ink},listHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},refresh:{color:c.purple,fontWeight:"700"},row:{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:10,paddingVertical:12,borderBottomWidth:1,borderBottomColor:c.line},rowName:{fontSize:13,fontWeight:"800",color:c.ink},rowMeta:{fontSize:11,color:c.muted,marginTop:3},action:{fontSize:12,color:c.purple,fontWeight:"700"},evidenceCard:{backgroundColor:c.bg,borderWidth:1,borderColor:c.line,borderRadius:13,padding:12,gap:7},evidenceStudio:{fontSize:13,fontWeight:"900",color:c.ink,flex:1},evidenceType:{fontSize:10,fontWeight:"800",color:c.purple,backgroundColor:c.pale,paddingHorizontal:8,paddingVertical:5,borderRadius:8},evidenceValue:{fontSize:13,lineHeight:20,color:c.ink},evidenceText:{fontSize:12,lineHeight:19,color:c.ink},rowActions:{flexDirection:"row",flexWrap:"wrap",gap:14,paddingTop:5},reject:{fontSize:12,color:"#B95764",fontWeight:"700"}});

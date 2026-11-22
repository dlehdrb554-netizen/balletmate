import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Linking, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { supabase } from "../lib/supabase";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";

import * as FileSystem from "expo-file-system/legacy";
import { parseScheduleEvidence } from "../lib/schedule-structure";

type EvidenceCandidate = {id:number;studio_id:string;studio_name:string;source_id:number;source_title:string|null;source_url:string;source_post_date?:string|null;candidate_type:"price"|"schedule";candidate_value:string;normalized_value:string|null;price_period?:string|null;price_frequency_per_week?:number|null;evidence_text:string;confidence:number;review_status:"pending"|"verified"|"rejected";created_at:string};

type StudioRow = {
  id:string; name:string; latitude:number; longitude:number; district:string|null;
  address:string|null; phone:string|null; price_per_class:number|null; website_url:string|null;
  source_url:string|null; source_name:string|null; verified_at:string|null; image_urls:string[]|null; image_source_name:string|null; image_usage_note:string|null;
  adult_classes:boolean; kids_classes:boolean; is_active:boolean;
};

const blank = {name:"",latitude:"",longitude:"",district:"",address:"",phone:"",website_url:"",source_url:"",source_name:"",verified_at:"",image_urls:"",image_source_name:"",image_usage_note:"",price_per_class:"",adult_classes:true,kids_classes:false,is_active:false};
const STUDIO_PAGE_SIZE = 50;
const c = {ink:"#252238",muted:"#8B879A",purple:"#7661D8",pale:"#F3F0FF",line:"#EAE7F0",white:"#FFFFFF",bg:"#FAF9FC"};
const normalizeScheduleKey=(value:string)=>String(value||"").toLowerCase().replace(/[\s·,，、|/]+/g,"").trim();

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
  const [adminTab,setAdminTab]=useState<"overview"|"review"|"publish"|"studios">("overview");
  const [studioActionId,setStudioActionId]=useState<string|null>(null);
  const [username,setUsername]=useState("");
  const [password,setPassword]=useState("");
  const [session,setSession]=useState<any>(null);
  const [authorized,setAuthorized]=useState(false);
  const [checking,setChecking]=useState(true);
  const [busy,setBusy]=useState(false);
  const [rows,setRows]=useState<StudioRow[]>([]);
  const [failedStudioThumbIds,setFailedStudioThumbIds]=useState<string[]>([]);
  const [photoCandidateRows,setPhotoCandidateRows]=useState<any[]>([]);
  const [photoReviewBusy,setPhotoReviewBusy]=useState(false);
  const [photoCandidateTotal,setPhotoCandidateTotal]=useState(0);
  const [photoCandidateOffset,setPhotoCandidateOffset]=useState(0);
  const [studioSearch,setStudioSearch]=useState("");
  const [studioAppliedSearch,setStudioAppliedSearch]=useState("");
  const [studioVisibleLimit,setStudioVisibleLimit]=useState(100);
  const [studioDbOffset,setStudioDbOffset]=useState(0);
  const [studioHasMore,setStudioHasMore]=useState(false);
  const [studioListFilter,setStudioListFilter]=useState<"all"|"missing_photo"|"missing_website"|"website_candidate"|"active"|"inactive">("all");
  const [form,setForm]=useState({...blank});
  const [editing,setEditing]=useState<string|null>(null);
  const [csvText,setCsvText]=useState("");
  const [importing,setImporting]=useState(false);
  const [classStudio,setClassStudio]=useState<StudioRow|null>(null);
  const [officialBlogStudio,setOfficialBlogStudio]=useState<StudioRow|null>(null);
  const [officialBlogUrls,setOfficialBlogUrls]=useState("");
  const [officialBlogBusy,setOfficialBlogBusy]=useState(false);
  const [officialBlogCandidates,setOfficialBlogCandidates]=useState<any[]>([]);
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

  const openOfficialBlogManager=async(studio:StudioRow)=>{
    if(!supabase)return;
    setOfficialBlogStudio(studio);
    setOfficialBlogUrls("");
    setOfficialBlogBusy(true);
    const {data,error}=await supabase.rpc("admin_get_studio_official_blog_accounts",{p_studio_id:studio.id});
    if(error)Alert.alert("공식 블로그 조회 실패",error.message);
    else setOfficialBlogUrls((Array.isArray(data)?data:[]).map((row:any)=>row.blogger_url).filter(Boolean).join("\n"));
    const candidates=await supabase.rpc("admin_list_studio_blog_account_candidates",{p_studio_id:studio.id});
    if(candidates.error)Alert.alert("후보 계정 조회 실패",candidates.error.message);
    else setOfficialBlogCandidates(Array.isArray(candidates.data)?candidates.data:[]);
    setOfficialBlogBusy(false);
  };
  const reviewOfficialBlogCandidate=async(candidateId:number,status:"approved"|"rejected")=>{
    if(!supabase||!officialBlogStudio)return;
    setOfficialBlogBusy(true);
    const {error}=await supabase.rpc("admin_review_studio_blog_account_candidate",{p_candidate_id:candidateId,p_status:status});
    if(error)Alert.alert("후보 처리 실패",error.message);
    else {
      const refreshed=await supabase.rpc("admin_list_studio_blog_account_candidates",{p_studio_id:officialBlogStudio.id});
      if(!refreshed.error)setOfficialBlogCandidates(Array.isArray(refreshed.data)?refreshed.data:[]);
      if(status==="approved"){
        const active=await supabase.rpc("admin_get_studio_official_blog_accounts",{p_studio_id:officialBlogStudio.id});
        if(!active.error)setOfficialBlogUrls((Array.isArray(active.data)?active.data:[]).map((row:any)=>row.blogger_url).filter(Boolean).join("\n"));
        Alert.alert("공식 계정 승인","승인한 블로그를 공식 계정으로 등록했습니다. 이후 수집된 게시물부터 공개 소식에 반영됩니다.");
      }
    }
    setOfficialBlogBusy(false);
  };
  const saveOfficialBlogAccounts=async()=>{
    if(!supabase||!officialBlogStudio)return;
    const urls=[...new Set(officialBlogUrls.split(/[\r\n,]+/).map(value=>value.trim()).filter(Boolean))];
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

  const clearDiscoveryHistory=()=>{
    if(!supabase)return;
    Alert.alert("탐색 기록 초기화","최근 탐색 오류와 중복 통합 실행 기록만 삭제합니다. 실제 학원 정보와 중복 통합 결과는 변경하지 않습니다.",[
      {text:"취소",style:"cancel"},
      {text:"기록 초기화",style:"destructive",onPress:async()=>{
        setDashboardBusy(true);
        const {data,error}=await supabase!.rpc("admin_clear_discovery_runs");
        if(error)Alert.alert("초기화 실패",error.message+"\nadmin_management_scaling.sql 적용 여부를 확인해 주세요.");
        else {setDiscoveryErrorRows([]);setDiscoveryDuplicateTotal(0);Alert.alert("초기화 완료",Number(data||0).toLocaleString("ko-KR")+"건의 실행 기록을 삭제했습니다.");await loadDashboard();}
        setDashboardBusy(false);
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
      setStudioHasMore(page.length===500);
    }catch(error:any){Alert.alert("추가 조회 실패",error?.message||"다음 학원 목록을 불러오지 못했습니다.");}
    finally{setBusy(false);}
  };

  const searchStudiosServer=async()=>{
    if(!supabase||busy)return;
    const term=studioSearch.trim().replace(/[%,_(),]/g," ").replace(/\s+/g," ").trim();
    setStudioAppliedSearch(term);setStudioSearch(term);
    setBusy(true);
    try{
      const baseQuery=supabase.from("studios").select(studioColumns);
      const query=term
        ? baseQuery.or(`name.ilike.%${term}%,district.ilike.%${term}%,address.ilike.%${term}%,phone.ilike.%${term}%`)
        : baseQuery;
      const {data,error}=await query.order("name").order("id").range(0,499);
      if(error)throw error;
      const page=data||[];
      const deduped=dedupeStudioRows(page);
      setRows(deduped.rows as StudioRow[]);
      setStudioDbOffset(page.length);
      setStudioHasMore(page.length===500);
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

  const loadPhotoCandidates=useCallback(async()=>{
    if(!supabase||!authorized)return;
    setPhotoReviewBusy(true);
    const {data,error,count}=await supabase.from("studio_photo_candidates")
      .select("id,studio_id,studio_name,image_url,source_page_url,source_host,created_at",{count:"exact"})
      .eq("review_status","pending").order("created_at",{ascending:false}).order("id",{ascending:false}).range(0,39);
    if(error){
      Alert.alert("사진 검토 자료 조회 실패",error.message+"\n사진 검토 SQL이 적용됐는지 확인해 주세요.");
      setPhotoCandidateRows([]);
    }else {setPhotoCandidateRows(data||[]);setPhotoCandidateTotal(count??(data||[]).length);setPhotoCandidateOffset((data||[]).length);}
    setPhotoReviewBusy(false);
  },[authorized]);

  const loadMorePhotoCandidates=async()=>{
    if(!supabase||photoReviewBusy||photoCandidateOffset>=photoCandidateTotal)return;
    setPhotoReviewBusy(true);
    const start=photoCandidateOffset;
    const {data,error}=await supabase.from("studio_photo_candidates")
      .select("id,studio_id,studio_name,image_url,source_page_url,source_host,created_at")
      .eq("review_status","pending").order("created_at",{ascending:false}).order("id",{ascending:false}).range(start,start+39);
    if(error)Alert.alert("추가 사진 조회 실패",error.message);
    else {setPhotoCandidateRows(data||[]);setPhotoCandidateOffset(start+(data||[]).length);}
    setPhotoReviewBusy(false);
  };
  const reviewPhotoCandidate=async(item:any,status:"approved"|"rejected")=>{
    if(!supabase)return;
    setPhotoReviewBusy(true);
    const {error}=await supabase.rpc("admin_review_studio_photo_candidate",{
      p_candidate_id:item.id,p_status:status
    });
    if(error)Alert.alert(status==="approved"?"사진 승인 실패":"사진 제외 실패",error.message);
    else {
      setPhotoCandidateRows(current=>current.filter(row=>row.id!==item.id));setPhotoCandidateTotal(value=>Math.max(0,value-1));setPhotoCandidateOffset(value=>Math.max(0,value-1));
      if(status==="approved"){
        setRows(current=>current.map(row=>row.id===item.studio_id
          ?{...row,image_urls:[...(row.image_urls||[]),item.image_url].slice(0,10),
            image_source_name:row.image_source_name||item.source_host}
          :row));
      }
    }
    setPhotoReviewBusy(false);
  };

  const deletePhotoCandidate=async(item:any)=>{
    if(!supabase)return;
    Alert.alert("사진 후보 삭제","이 사진 후보를 검토 대기열에서 영구 삭제할까요?",[
      {text:"취소",style:"cancel"},
      {text:"삭제",style:"destructive",onPress:async()=>{
        setPhotoReviewBusy(true);
        const {error}=await supabase!.rpc("admin_delete_studio_photo_candidate",{p_candidate_id:item.id});
        if(error)Alert.alert("사진 삭제 실패",error.message);
        else {setPhotoCandidateRows(current=>current.filter(row=>row.id!==item.id));setPhotoCandidateTotal(value=>Math.max(0,value-1));}
        setPhotoReviewBusy(false);
      }}
    ]);
  };
  const removeStudioGalleryPhoto=async(studioId:string,imageUrl:string)=>{
    if(!supabase)return;
    Alert.alert("학원 사진 삭제","이 사진을 학원 상세 갤러리에서 영구 제거할까요?",[
      {text:"취소",style:"cancel"},
      {text:"사진 삭제",style:"destructive",onPress:async()=>{
        setBusy(true);
        const {error}=await supabase!.rpc("admin_remove_studio_gallery_photo",{p_studio_id:studioId,p_image_url:imageUrl});
        if(error)Alert.alert("사진 삭제 실패",error.message);
        else {
          let storageDeleteWarning="";
          const marker="/storage/v1/object/public/studio-photos/";
          const markerIndex=imageUrl.indexOf(marker);
          if(markerIndex>=0){
            const objectPath=decodeURIComponent(imageUrl.slice(markerIndex+marker.length).split("?")[0]);
            if(objectPath){
              const {error:storageError}=await supabase!.storage.from("studio-photos").remove([objectPath]);
              if(storageError)storageDeleteWarning=" 갤러리에서는 제거했지만 저장소 파일 삭제는 실패했습니다: "+storageError.message;
            }
          }
          setRows(current=>current.map(row=>row.id===studioId?{...row,image_urls:(row.image_urls||[]).filter(url=>url!==imageUrl)}:row));
          setForm(current=>({...current,image_urls:current.image_urls.split(/[\\n,]+/).map(value=>value.trim()).filter(value=>value&&value!==imageUrl).join("\\n")}));
          Alert.alert("삭제 완료","학원 갤러리에서 사진을 제거했습니다."+storageDeleteWarning);
        }
        setBusy(false);
      }}
    ]);
  };

  const loadEvidence=useCallback(async()=>{
    if(!supabase||!authorized)return;
    setEvidenceBusy(true);
    const columns="id,studio_id,studio_name,source_id,source_title,source_url,source_post_date,candidate_type,candidate_value,normalized_value,price_period,price_frequency_per_week,evidence_text,confidence,review_status,created_at";
    const priceColumns="id,candidate_id,studio_id,amount_krw,price_period,frequency_per_week,source_url,source_post_date,published_at,expires_at,is_active,image_urls";
    const scheduleColumns="id,candidate_id,studio_id,schedule_text,source_url,source_post_date,published_at,expires_at,is_active,image_urls";
    const [pending,verified,verifiedSchedules,published,publishedSchedules,publishedIds]=await Promise.all([
      supabase.from("studio_blog_evidence_candidates").select(columns,{count:"exact"}).eq("review_status","pending").order("created_at",{ascending:false}).limit(100),
      supabase.from("studio_blog_evidence_candidates").select(columns,{count:"exact"}).eq("review_status","verified").eq("candidate_type","price").order("reviewed_at",{ascending:false}).order("id",{ascending:false}).range(0,99),
      supabase.from("studio_blog_evidence_candidates").select(columns,{count:"exact"}).eq("review_status","verified").eq("candidate_type","schedule").order("reviewed_at",{ascending:false}).order("id",{ascending:false}).range(0,99),
      supabase.from("studio_public_prices").select(priceColumns,{count:"exact"}).eq("is_active",true).order("published_at",{ascending:false}).order("id",{ascending:false}).range(0,99),
      supabase.from("studio_public_schedules").select(scheduleColumns,{count:"exact"}).order("published_at",{ascending:false}).order("id",{ascending:false}).range(0,99),
      supabase.rpc("admin_published_candidate_ids"),
    ]);
    if(pending.error)Alert.alert("자동 수집 자료 조회 실패",pending.error.message);
    else {setEvidenceRows((pending.data||[]) as EvidenceCandidate[]);setTotalEvidencePending(pending.count??(pending.data||[]).length);setSelectedEvidenceIds(ids=>ids.filter(id=>(pending.data||[]).some((row:any)=>row.id===id)));}
    if(verified.error)Alert.alert("검증 가격 조회 실패",verified.error.message);
    else {setVerifiedPriceRows((verified.data||[]) as EvidenceCandidate[]);setVerifiedPriceTotal(verified.count??(verified.data||[]).length);setVerifiedPriceOffset((verified.data||[]).length);setSelectedPriceIds(ids=>ids.filter(id=>(verified.data||[]).some((row:any)=>row.id===id)));}
    if(verifiedSchedules.error)Alert.alert("검증 시간표 조회 실패",verifiedSchedules.error.message);
    else {setVerifiedScheduleRows((verifiedSchedules.data||[]) as EvidenceCandidate[]);setVerifiedScheduleTotal(verifiedSchedules.count??(verifiedSchedules.data||[]).length);setVerifiedScheduleOffset((verifiedSchedules.data||[]).length);setSelectedScheduleIds(ids=>ids.filter(id=>(verifiedSchedules.data||[]).some((row:any)=>row.id===id)));}
    const publishedRows=published.data||[];
    const scheduleRows=publishedSchedules.data||[];
    setPublicPriceTotal(published.count??publishedRows.length);
    setPublicScheduleTotal(publishedSchedules.count??scheduleRows.length);
    setPublicPriceOffset(publishedRows.length);
    setPublicScheduleOffset(scheduleRows.length);
    const studioIds=[...new Set([...publishedRows,...scheduleRows].map((row:any)=>row.studio_id).filter(Boolean))];
    const studioNames=new Map<string,string>();
    if(studioIds.length){
      const {data:names,error:namesError}=await supabase.from("studios").select("id,name").in("id",studioIds);
      if(!namesError)for(const item of names||[])studioNames.set(item.id,item.name);
    }
    if(published.error)Alert.alert("공개 가격 조회 실패",published.error.message);
    else if(publishedIds.error)Alert.alert("공개 후보 연결 조회 실패",publishedIds.error.message+"\nadmin_management_scaling.sql 적용 여부를 확인해 주세요.");
    else {
      setPublishedCandidateIds(Array.isArray(publishedIds.data?.prices)?publishedIds.data.prices.map((id:any)=>Number(id)):[]);
      setActivePublicPrices(publishedRows.filter((row:any)=>row.is_active).map((row:any)=>({...row,studio_name:studioNames.get(row.studio_id)||"학원명 미확인"})));
    }
    if(publishedSchedules.error)Alert.alert("공개 시간표 조회 실패",publishedSchedules.error.message);
    else {
      setPublishedScheduleCandidateIds(Array.isArray(publishedIds.data?.schedules)?publishedIds.data.schedules.map((id:any)=>Number(id)):[]);
      const seen=new Set<string>();const uniqueScheduleRows:any[]=[];let duplicates=0;
      for(const row of scheduleRows){
        const key=normalizeScheduleKey(row.schedule_text||"");
        const identity=key?row.studio_id+"|"+key:"id|"+row.id;
        if(seen.has(identity)){duplicates++;continue;}
        seen.add(identity);uniqueScheduleRows.push(row);
      }
      setDuplicatePublicScheduleCount(duplicates);
      setActivePublicSchedules(uniqueScheduleRows.map((row:any)=>({...row,studio_name:studioNames.get(row.studio_id)||"학원명 미확인"})));
    }
    setEvidenceBusy(false);
  },[authorized]);
  const loadMorePublicPage=async(kind:"price"|"schedule")=>{
    if(!supabase||evidenceBusy)return;
    setEvidenceBusy(true);
    try{
      const isPrice=kind==="price";
      const offset=isPrice?publicPriceOffset:publicScheduleOffset;
      const result:any=isPrice
        ? await supabase.from("studio_public_prices").select("id,candidate_id,studio_id,amount_krw,price_period,frequency_per_week,source_url,source_post_date,published_at,expires_at,is_active,image_urls").eq("is_active",true).order("published_at",{ascending:false}).order("id",{ascending:false}).range(offset,offset+99)
        : await supabase.from("studio_public_schedules").select("id,candidate_id,studio_id,schedule_text,source_url,source_post_date,published_at,expires_at,is_active,image_urls").order("published_at",{ascending:false}).order("id",{ascending:false}).range(offset,offset+99);
      const {data,error}=result;
      if(error)throw error;
      const page=data||[];
      const ids=[...new Set(page.map((row:any)=>row.studio_id).filter(Boolean))];
      const names=new Map<string,string>();
      if(ids.length){const result=await supabase.from("studios").select("id,name").in("id",ids);for(const row of result.data||[])names.set(row.id,row.name);}
      if(isPrice){
        setActivePublicPrices(page.filter((row:any)=>row.is_active).map((row:any)=>({...row,studio_name:names.get(row.studio_id)||"학원명 미확인"})));
        setPublicPriceOffset(offset+page.length);
      }else{
        setPublishedScheduleCandidateIds(current=>[...current,...page.map((row:any)=>Number(row.candidate_id))]);
        setActivePublicSchedules(()=>{
          const seen=new Set<string>();
          const next:any[]=[];let duplicates=0;
          for(const row of page){const key=normalizeScheduleKey(row.schedule_text||"");const identity=key?row.studio_id+"|"+key:"id|"+row.id;if(seen.has(identity)){duplicates++;continue;}seen.add(identity);next.push({...row,studio_name:names.get(row.studio_id)||"학원명 미확인"});}
          setDuplicatePublicScheduleCount(duplicates);
          return next;
        });
        setPublicScheduleOffset(offset+page.length);
      }
    }catch(error:any){Alert.alert("추가 조회 실패",error?.message||"공개 자료를 더 불러오지 못했습니다.");}
    finally{setEvidenceBusy(false);}
  };
  const loadMoreVerifiedPage=async(kind:"price"|"schedule")=>{
    if(!supabase||evidenceBusy)return;
    setEvidenceBusy(true);
    try{
      const isPrice=kind==="price";
      const offset=isPrice?verifiedPriceOffset:verifiedScheduleOffset;
      const {data,error}=await supabase.from("studio_blog_evidence_candidates")
        .select("id,studio_id,studio_name,source_id,source_title,source_url,source_post_date,candidate_type,candidate_value,normalized_value,price_period,price_frequency_per_week,evidence_text,confidence,review_status,created_at")
        .eq("review_status","verified").eq("candidate_type",kind)
        .order("reviewed_at",{ascending:false}).order("id",{ascending:false}).range(offset,offset+99);
      if(error)throw error;
      const page=(data||[]) as EvidenceCandidate[];
      if(isPrice){setVerifiedPriceRows(page);setVerifiedPriceOffset(offset+page.length);setSelectedPriceIds([]);}
      else {setVerifiedScheduleRows(page);setVerifiedScheduleOffset(offset+page.length);setSelectedScheduleIds([]);}
    }catch(error:any){Alert.alert("추가 조회 실패",error?.message||"검증 자료를 더 불러오지 못했습니다.");}
    finally{setEvidenceBusy(false);}
  };

  const loadScheduleClassCandidates=useCallback(async()=>{
    if(!supabase||!authorized)return;
    const {data,error,count}=await supabase.from("studio_schedule_class_candidates").select("*",{count:"exact"}).eq("status","pending").order("created_at",{ascending:false}).order("id",{ascending:false}).range(0,99);
    if(error)Alert.alert("시간표 후보 조회 실패",error.message);
    else {const rows=data||[];setScheduleClassCandidates(rows);setScheduleClassCandidateTotal(count??rows.length);setScheduleClassCandidateOffset(rows.length);setCandidateTitles(Object.fromEntries(rows.map((row:any)=>[row.id,row.proposed_title])));setCandidateSessions(Object.fromEntries(rows.map((row:any)=>[row.id,(Array.isArray(row.sessions)?row.sessions:[]).map((x:any)=>[x.weekday,x.start_time,(x.end_time||""),x.note||""].join(",")).join("\n")])));}
  },[authorized]);
  const loadMoreScheduleClassCandidates=async()=>{
    if(!supabase||evidenceBusy||scheduleClassCandidateOffset>=scheduleClassCandidateTotal)return;
    setEvidenceBusy(true);
    const start=scheduleClassCandidateOffset;
    const {data,error}=await supabase.from("studio_schedule_class_candidates").select("*").eq("status","pending").order("created_at",{ascending:false}).order("id",{ascending:false}).range(start,start+99);
    if(error)Alert.alert("추가 시간표 후보 조회 실패",error.message);
    else {const rows=data||[];setScheduleClassCandidates(rows);setScheduleClassCandidateOffset(start+rows.length);setCandidateTitles(Object.fromEntries(rows.map((row:any)=>[row.id,row.proposed_title])));setCandidateSessions(Object.fromEntries(rows.map((row:any)=>[row.id,(Array.isArray(row.sessions)?row.sessions:[]).map((x:any)=>[x.weekday,x.start_time,(x.end_time||""),x.note||""].join(",")).join("\n")])));}
    setEvidenceBusy(false);
  };

  useEffect(()=>{
    if(adminTab==="overview"){loadDashboard();loadReports();}
    else if(adminTab==="review"||adminTab==="publish"){loadEvidence();if(adminTab==="review")loadPhotoCandidates();if(adminTab==="publish")loadScheduleClassCandidates();}
    else if(adminTab==="studios")load();
  },[adminTab,loadDashboard,loadReports,loadEvidence,loadPhotoCandidates,loadScheduleClassCandidates,load]);

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

  const uploadMaterialPhotos=async(kind:"price"|"schedule",record:any)=>{
    if(!supabase)return;
    const existing=Array.isArray(record.image_urls)?record.image_urls:[];
    if(existing.length>=8){Alert.alert("사진 등록 한도","가격·시간표 자료는 한 묶음에 최대 8장까지 등록할 수 있습니다.");return;}
    const permission=await ImagePicker.requestMediaLibraryPermissionsAsync();
    if(!permission.granted){Alert.alert("사진 권한","사진 보관함 접근 권한을 허용해 주세요.");return;}
    const picked=await ImagePicker.launchImageLibraryAsync({mediaTypes:["images"],allowsMultipleSelection:true,selectionLimit:8-existing.length,quality:1});
    if(picked.canceled||!picked.assets?.length)return;
    setEvidenceBusy(true);
    const uploadedPaths:string[]=[];
    try{
      const urls:string[]=[];
      for(let i=0;i<picked.assets.length;i++){
        const asset=picked.assets[i];
        if((asset.fileSize||0)>15*1024*1024)throw new Error("원본 사진은 한 장당 15MB 이하여야 합니다.");
        const sourceWidth=asset.width||2000,sourceHeight=asset.height||2400;
        const scale=Math.min(1,2000/sourceWidth,2400/sourceHeight);
        const targetWidth=Math.max(1,Math.round(sourceWidth*scale)),targetHeight=Math.max(1,Math.round(sourceHeight*scale));
        const resized=await ImageManipulator.manipulateAsync(asset.uri,[{resize:{width:targetWidth,height:targetHeight}}],{compress:0.88,format:ImageManipulator.SaveFormat.JPEG});
        try{
          let response=await fetch(resized.uri);
          if(!response.ok)throw new Error("최적화 사진을 읽지 못했습니다.");
          let bytes=await response.arrayBuffer();
          if(bytes.byteLength>1500*1024){
            const compact=await ImageManipulator.manipulateAsync(resized.uri,[],{compress:0.72,format:ImageManipulator.SaveFormat.JPEG});
            try{response=await fetch(compact.uri);if(!response.ok)throw new Error("압축 사진을 읽지 못했습니다.");bytes=await response.arrayBuffer();}
            finally{await FileSystem.deleteAsync(compact.uri,{idempotent:true}).catch(()=>{});}
          }
          if(bytes.byteLength>1800*1024)throw new Error("최적화 후에도 사진이 1.8MB를 초과합니다. 해상도가 더 낮은 사진을 선택해 주세요.");
          const path="materials/"+record.studio_id+"/"+kind+"/"+record.id+"/"+Date.now()+"_"+i+".jpg";
          const {error:uploadError}=await supabase.storage.from("studio-photos").upload(path,bytes,{contentType:"image/jpeg",cacheControl:"31536000",upsert:false});
          if(uploadError)throw uploadError;
          uploadedPaths.push(path);
          urls.push(supabase.storage.from("studio-photos").getPublicUrl(path).data.publicUrl);
        }finally{await FileSystem.deleteAsync(resized.uri,{idempotent:true}).catch(()=>{});}
      }
      const next=[...existing,...urls];
      const result=kind==="price"
        ? await supabase.from("studio_public_prices").update({image_urls:next}).eq("id",record.id)
        : await supabase.from("studio_public_schedules").update({image_urls:next}).eq("id",record.id);
      if(result.error)throw result.error;
      if(kind==="price")setActivePublicPrices(rows=>rows.map(row=>row.id===record.id?{...row,image_urls:next}:row));
      else setActivePublicSchedules(rows=>rows.map(row=>row.id===record.id?{...row,image_urls:next}:row));
      Alert.alert("사진 등록 완료","최적화한 사진 "+urls.length+"장을 자료에 연결했습니다.");
    }catch(error:any){
      if(uploadedPaths.length)await supabase.storage.from("studio-photos").remove(uploadedPaths);
      Alert.alert("사진 등록 실패",error?.message||"사진을 저장하지 못했습니다.");
    }finally{setEvidenceBusy(false);}
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
        else {setActivePublicSchedules(current=>current.map(row=>row.id===schedule.id?{...row,is_active:false}:row));Alert.alert("처리 완료","해당 시간표를 공개 중단 이력으로 이동했습니다.");}
        setEvidenceBusy(false);
      }}
    ]);
  };
  const deletePublicSchedule=async(schedule:any)=>{
    if(!supabase)return;
    Alert.alert("공개 시간표 삭제","이 공개 시간표 자료를 데이터베이스에서 영구 삭제할까요? 앱 공개도 즉시 중단됩니다.",[
      {text:"취소",style:"cancel"},
      {text:"영구 삭제",style:"destructive",onPress:async()=>{
        setEvidenceBusy(true);
        const {error}=await supabase!.from("studio_public_schedules").delete().eq("id",schedule.id);
        if(error)Alert.alert("삭제 실패",error.message);
        else {setActivePublicSchedules(current=>current.filter(row=>row.id!==schedule.id));Alert.alert("삭제 완료","공개 시간표 자료를 삭제했습니다.");}
        setEvidenceBusy(false);
      }}
    ]);
  };
  const deletePriceCandidate=async(item:EvidenceCandidate)=>{
    if(!supabase)return;
    Alert.alert("공개 대기 가격 삭제","이 검증 가격 후보를 영구 삭제할까요? 공개된 가격 이력에는 영향을 주지 않습니다.",[
      {text:"취소",style:"cancel"},
      {text:"영구 삭제",style:"destructive",onPress:async()=>{
        setEvidenceBusy(true);
        const {error}=await supabase!.rpc("admin_delete_verified_evidence_candidate",{p_candidate_id:item.id,p_candidate_type:"price"});
        if(error)Alert.alert("가격 후보 삭제 실패",error.message);
        else {setVerifiedPriceRows(current=>current.filter(row=>row.id!==item.id));setSelectedPriceIds(current=>current.filter(id=>id!==item.id));setVerifiedPriceTotal(value=>Math.max(0,value-1));Alert.alert("삭제 완료","공개 대기 가격 후보를 삭제했습니다.");}
        setEvidenceBusy(false);
      }}
    ]);
  };

  const deleteScheduleCandidate=async(item:EvidenceCandidate)=>{
    if(!supabase)return;
    Alert.alert("시간표 후보 삭제","검증된 시간표 후보를 영구 삭제할까요? 공개된 자료는 별도 공개 이력에서 삭제해야 합니다.",[
      {text:"취소",style:"cancel"},
      {text:"영구 삭제",style:"destructive",onPress:async()=>{
        setEvidenceBusy(true);
        const {error}=await supabase!.rpc("admin_delete_verified_evidence_candidate",{p_candidate_id:item.id,p_candidate_type:"schedule"});
        if(error)Alert.alert("후보 삭제 실패",error.message);
        else {setVerifiedScheduleRows(current=>current.filter(row=>row.id!==item.id));setSelectedScheduleIds(current=>current.filter(id=>id!==item.id));Alert.alert("삭제 완료","검증된 시간표 후보를 삭제했습니다.");}
        setEvidenceBusy(false);
      }}
    ]);
  };

  const publishSchedule=async(item:EvidenceCandidate)=>{
    if(!supabase||item.candidate_type!=="schedule")return;
    if(item.review_status!=="verified"){Alert.alert("검증 필요","관리자가 근거를 확인한 시간표만 공개할 수 있습니다.");return;}
    const scheduleText=(item.normalized_value||item.candidate_value||"").trim();
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
    if(!supabase)return;
    const eligible=verifiedScheduleRows.filter(row=>!publishedScheduleCandidateIds.includes(row.id));
    const selected=eligible.filter(row=>selectedScheduleIds.includes(row.id));
    if(!selected.length){
      Alert.alert("선택된 시간표 없음","공개 대기 시간표에서 공개할 자료를 선택해 주세요. 전체 선택 버튼으로 한 번에 선택할 수도 있습니다.");
      return;
    }
    const today=seoulDate();
    const old=selected.filter(row=>row.source_post_date&&datePlusDays(row.source_post_date,45)!==null&&datePlusDays(row.source_post_date,45)!<today);
    const invalid=selected.filter(row=>{
      const value=(row.normalized_value||row.candidate_value||"").trim();
      return value.length<2||!row.source_url||!row.evidence_text;
    });
    const valid=selected.filter(row=>!old.includes(row)&&!invalid.includes(row));
    if(!valid.length){
      const reasons:string[]=[];
      if(old.length)reasons.push("게시일 기준 45일 초과: "+old.length+"건");
      if(invalid.length)reasons.push("시간표 내용 또는 원문 근거 누락: "+invalid.length+"건");
      Alert.alert("공개 가능한 시간표 없음",reasons.length?reasons.join("\\n"):"선택한 자료의 공개 조건을 확인할 수 없습니다.");
      return;
    }
    const noDate=valid.filter(row=>!row.source_post_date).length;
    Alert.alert("시간표 일괄 공개","선택 "+selected.length+"개 중 공개 대상 "+valid.length+"개"+(old.length?"\\n45일 초과 제외 "+old.length+"개":"")+(invalid.length?"\\n내용/원문 근거 누락 제외 "+invalid.length+"개":"")+(noDate?"\\n게시일 미확인 "+noDate+"개 (원문 직접 확인 전제, 30일 만료)":"")+"\\n일괄 공개할까요?",[{text:"취소",style:"cancel"},{text:"공개",onPress:async()=>{
      setEvidenceBusy(true);let ok=0,failed=0;
      for(const item of valid){
        const sourcePostDate=item.source_post_date||null;
        const expiry=datePlusDays(sourcePostDate||today,sourcePostDate?45:30);
        const textValue=(item.normalized_value||item.candidate_value||"").trim();
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
  const filteredStudioRows=useMemo(()=>rows.filter(row=>{
    const q=studioSearch.trim().toLowerCase();
    if(q&&!([row.name,row.district||"",row.address||"",row.phone||""].some(value=>value.toLowerCase().includes(q))))return false;
    if(studioListFilter==="missing_photo"&&(row.image_urls||[]).length>0)return false;
    if(studioListFilter==="missing_website"&&!!row.website_url)return false;
    if(studioListFilter==="website_candidate"&&!String(row.source_name||"").includes("홈페이지 검색 후보"))return false;
    if(studioListFilter==="active"&&!row.is_active)return false;
    if(studioListFilter==="inactive"&&row.is_active)return false;
    return true;
  }),[rows,studioSearch,studioListFilter]);
  const visibleStudioRows=filteredStudioRows.slice(0,studioVisibleLimit);
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
  const verifyHomepageCandidate=(studio:StudioRow)=>{
    if(!supabase||!studio.website_url)return;
    Alert.alert("공식 홈페이지 후보 확인",
      studio.name+"\n"+studio.website_url+"\n\n해당 주소가 이 학원의 공식 홈페이지인지 확인해 주세요. 홈페이지를 열어 확인한 뒤 승인하면 사진·가격·시간표 수집 대기열에 등록됩니다.",
      [
        {text:"취소",style:"cancel"},
        {text:"홈페이지 열기",onPress:()=>Linking.openURL(studio.website_url!).catch(()=>Alert.alert("홈페이지 연결","주소를 열 수 없습니다."))},
        {text:"공식 홈페이지로 승인",onPress:async()=>{
          setBusy(true);
          const checkedAt=new Date().toISOString();
          const {error}=await supabase!.from("studios").update({
            source_name:"관리자 확인 공식 홈페이지",verified_at:checkedAt
          }).eq("id",studio.id);
          if(error)Alert.alert("홈페이지 승인 실패",error.message);
          else {
            const {error:queueError}=await supabase!.from("studio_image_crawl_queue").upsert({
              studio_id:studio.id,status:"pending",attempts:0,next_attempt_at:checkedAt,last_error:null,updated_at:checkedAt
            },{onConflict:"studio_id"});
            if(queueError)Alert.alert("수집 대기열 등록 실패",queueError.message);
            else {
              setRows(current=>current.map(row=>row.id===studio.id?{...row,source_name:"관리자 확인 공식 홈페이지",verified_at:checkedAt}:row));
              Alert.alert("공식 홈페이지 승인 완료","이제 자동 수집 대기열에서 처리할 수 있습니다.");
            }
          }
          setBusy(false);
        }}
      ]
    );
  };

  const crawlImages=async(id:string,name:string)=>{
    if(!supabase)return;
    const studio=rows.find(row=>row.id===id);
    if(studio?.source_name?.includes("홈페이지 검색 후보")&&studio.source_name.includes("미검증")){
      Alert.alert("홈페이지 확인 필요","검색으로 발견한 홈페이지 후보입니다. 주소를 확인한 뒤 '홈페이지 후보 확인'을 먼저 눌러 주세요.");return;
    }
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
    if(existing.length>=10){Alert.alert("사진 등록 한도","학원별 소개 사진은 최대 10장까지 등록할 수 있습니다.");return;}
    const permission=await ImagePicker.requestMediaLibraryPermissionsAsync();
    if(!permission.granted){Alert.alert("사진 권한","사진 보관함 접근 권한을 허용해 주세요.");return;}
    const picked=await ImagePicker.launchImageLibraryAsync({mediaTypes:["images"],allowsMultipleSelection:true,selectionLimit:Math.min(10,10-existing.length),quality:1});
    if(picked.canceled||!picked.assets?.length)return;
    const assets=picked.assets.slice(0,10-existing.length);
    const uploadedPaths:string[]=[];
    setBusy(true);
    try{
      const urls:string[]=[];
      for(let i=0;i<assets.length;i++){
        const asset=assets[i];
        if(!["image/jpeg","image/png","image/webp"].includes(asset.mimeType||"image/jpeg"))throw new Error("JPG, PNG, WEBP 사진만 등록할 수 있습니다.");
        if((asset.fileSize||0)>15*1024*1024)throw new Error("원본 사진은 한 장당 15MB 이하여야 합니다.");
        const maxWidth=2000;
        const sourceWidth=asset.width||maxWidth;
        const sourceHeight=asset.height||maxWidth;
        const scale=Math.min(1,maxWidth/sourceWidth,1800/sourceHeight);
        const targetWidth=Math.max(1,Math.round(sourceWidth*scale));
        const targetHeight=Math.max(1,Math.round(sourceHeight*scale));
        const resized=await ImageManipulator.manipulateAsync(asset.uri,[{resize:{width:targetWidth,height:targetHeight}}],{compress:0.84,format:ImageManipulator.SaveFormat.JPEG});
        try{
          let response=await fetch(resized.uri);
          if(!response.ok)throw new Error("최적화된 사진 파일을 읽지 못했습니다.");
          let bytes=await response.arrayBuffer();
          if(bytes.byteLength>1500*1024){
            const compact=await ImageManipulator.manipulateAsync(resized.uri,[],{compress:0.68,format:ImageManipulator.SaveFormat.JPEG});
            try{
              response=await fetch(compact.uri);
              if(!response.ok)throw new Error("압축된 사진 파일을 읽지 못했습니다.");
              bytes=await response.arrayBuffer();
            }finally{await FileSystem.deleteAsync(compact.uri,{idempotent:true}).catch(()=>{});}
          }
          if(bytes.byteLength>1800*1024)throw new Error("사진을 최적화한 뒤에도 1.8MB를 초과합니다. 다른 사진을 선택해 주세요.");
          const path=id+"/"+Date.now()+"_"+i+".jpg";
          const {error:uploadError}=await supabase.storage.from("studio-photos").upload(path,bytes,{contentType:"image/jpeg",cacheControl:"31536000",upsert:false});
          if(uploadError)throw uploadError;
          uploadedPaths.push(path);
          urls.push(supabase.storage.from("studio-photos").getPublicUrl(path).data.publicUrl);
        }finally{await FileSystem.deleteAsync(resized.uri,{idempotent:true}).catch(()=>{});}
      }
      const {error:updateError}=await supabase.from("studios").update({
        image_urls:[...existing,...urls],
        image_source_name:"관리자 직접 등록",
        image_usage_note:current?.image_usage_note||"관리자가 직접 업로드한 최적화 사진",
        updated_at:new Date().toISOString()
      }).eq("id",id);
      if(updateError)throw updateError;
      Alert.alert("사진 등록 완료",name+" · "+urls.length+"장 최적화 후 업로드 완료");
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
    <View style={styles.header}><View><Text style={styles.brand}>Balletmate 관리자</Text><Text style={styles.hint}>학원 데이터 관리 · {rows.length.toLocaleString("ko-KR")}개</Text></View><Pressable onPress={logout}><Text style={styles.logout}>로그아웃</Text></Pressable></View>
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
      ["근거 검수",dashboard.evidence?.pending??0,"가격 "+(dashboard.evidence?.pending_price??0)+" · 시간표 "+(dashboard.evidence?.pending_schedule??0)],
      ["본문 수집",dashboard.blog_posts?.pending??0,"대기 · 처리 "+(dashboard.blog_posts?.processing??0)+" · 완료 "+(dashboard.blog_posts?.completed??0)],
      ["수집 본문 근거",dashboard.post_contents?.total??0,"가격 포함 "+(dashboard.post_contents?.with_price_evidence??0)+" · 시간표 포함 "+(dashboard.post_contents?.with_schedule_evidence??0)],
      ["시간표 후보",dashboard.schedule_candidates?.pending??0,"등록 대기"],
      ["공개 가격",dashboard.public_prices?.active??0,"활성 자료"],
      ["공개 시간표",dashboard.public_schedules?.active??0,"활성 자료"],
      ["지역 발견",dashboard.discovery?.last_inserted??0,"최근 실행 신규 발견"]
    ].map(([label,value,caption])=><View key={String(label)} style={styles.statCard}><Text style={styles.statLabel}>{label}</Text><Text style={styles.statValue}>{Number(value).toLocaleString("ko-KR")}</Text><Text style={styles.statCaption}>{caption}</Text></View>)}</View><Text style={styles.hint}>최근 지역 탐색: {dashboard.discovery?.last_region||"실행 기록 없음"} · {dashboard.discovery?.last_run_at?new Date(dashboard.discovery.last_run_at).toLocaleString("ko-KR"):"기록 없음"}</Text>{dashboard.discovery?.last_error&&<Text style={styles.errorHint}>최근 탐색 오류: {[...new Set(String(dashboard.discovery.last_error).split(" | ").map((x:string)=>x.trim()).filter(Boolean))].join(" · ")}</Text>}<Pressable style={styles.secondary} disabled={retryBusy} onPress={retryFailedQueues}><Text style={styles.secondaryText}>{retryBusy?"재처리 요청 중…":"실패한 수집 작업 재처리"}</Text></Pressable></>:<Text style={styles.hint}>통계를 불러오는 중입니다.</Text>}</View>
    <View style={styles.panel}><View style={styles.listHead}><View style={{flex:1,minWidth:0}}><Text style={styles.heading}>탐색 오류 기록</Text><Text style={styles.hint}>최근 40회 중복 제외 {discoveryDuplicateTotal.toLocaleString("ko-KR")}건 · 오류 {discoveryErrorRows.length}종</Text></View><View style={{flexDirection:"row",gap:12}}><Pressable onPress={loadDashboard}><Text style={styles.refresh}>새로고침</Text></Pressable><Pressable onPress={clearDiscoveryHistory} disabled={dashboardBusy}><Text style={[styles.refresh,{color:"#B95764"}]}>기록 초기화</Text></Pressable></View></View>{discoveryErrorRows.map((item:any,index:number)=><View key={"discovery-error-"+index} style={styles.evidenceCard}><Text style={styles.evidenceStudio}>{item.region_name} · {new Date(item.queried_at).toLocaleString("ko-KR")} · 최근 40건 중 {item.count}회</Text><Text style={styles.errorHint}>{item.error}</Text></View>)}{!discoveryErrorRows.length&&!dashboardBusy&&<Text style={styles.hint}>최근 탐색 오류가 없습니다.</Text>}</View><View style={styles.panel}><View style={styles.listHead}><Text style={styles.heading}>학원 정보 사용자 제보 ({reportRows.filter(r=>r.status==="pending"||r.status==="in_review").length})</Text><Pressable onPress={loadReports}><Text style={styles.refresh}>{reportsBusy?"조회 중…":"새로고침"}</Text></Pressable></View>{reportsError?<View><Text style={styles.hint}>제보 조회 오류: {reportsError}</Text><Pressable onPress={loadReports}><Text style={styles.action}>다시 시도</Text></Pressable></View>:reportRows.length?reportRows.map(report=><View key={"report-"+report.id} style={styles.evidenceCard}><Text style={styles.evidenceStudio}>{report.studio_name||"학원"} · {report.category} · {new Date(report.created_at).toLocaleDateString("ko-KR")}</Text><Text style={styles.evidenceText}>{report.description}</Text><Text style={styles.rowMeta}>상태: {report.status==="pending"?"대기":report.status==="in_review"?"검토 중":report.status==="resolved"?"처리 완료":"기각"}</Text>{(report.status==="pending"||report.status==="in_review")&&<View style={styles.rowActions}><Pressable onPress={()=>updateReportStatus(report.id,"in_review")}><Text style={styles.action}>검토 중</Text></Pressable><Pressable onPress={()=>updateReportStatus(report.id,"resolved")}><Text style={styles.action}>처리 완료</Text></Pressable><Pressable onPress={()=>updateReportStatus(report.id,"rejected")}><Text style={styles.reject}>기각</Text></Pressable></View>}</View>):<Text style={styles.hint}>접수된 제보가 없습니다.</Text>}</View>
        </>}
    {adminTab==="publish"&&<>
<View style={styles.panel}><View style={styles.listHead}><Text style={styles.heading}>공개 가격</Text><Pressable onPress={loadEvidence}><Text style={styles.refresh}>새로고침</Text></Pressable></View><View style={styles.compactTableHeader}><Text style={styles.compactNumber}>#</Text><Text style={styles.compactMain}>학원 · 가격</Text><Text style={styles.compactAction}>관리</Text></View>{activePublicPrices.map((price,index)=><View key={"active-price-"+price.id} style={styles.compactTableRow}><Text style={styles.compactNumber}>{index+1}</Text><View style={styles.compactMain}><Text style={styles.compactPrimary} numberOfLines={1}>{price.studio_name}</Text><Text style={styles.compactSecondary} numberOfLines={1}>{Number(price.amount_krw).toLocaleString("ko-KR")}원 · {price.price_period}{price.frequency_per_week?" · 주 "+price.frequency_per_week+"회":""}</Text><Pressable onPress={()=>uploadMaterialPhotos("price",price)} disabled={evidenceBusy}><Text style={styles.compactAction}>사진 추가 · {Array.isArray(price.image_urls)?price.image_urls.length:0}/8장</Text></Pressable></View><Pressable onPress={()=>deactivatePublicPrice(price)} disabled={evidenceBusy}><Text style={styles.compactAction}>중단</Text></Pressable></View>)}{!activePublicPrices.length&&!evidenceBusy&&<Text style={styles.hint}>현재 공개 중인 가격이 없습니다.</Text>}{publicPriceOffset<publicPriceTotal&&<Pressable style={styles.secondary} disabled={evidenceBusy} onPress={()=>loadMorePublicPage("price")}><Text style={styles.secondaryText}>다음 가격 이력 100개</Text></Pressable>}</View>
<View style={styles.panel}><View style={styles.listHead}><Text style={styles.heading}>공개 시간표 이력</Text><Pressable onPress={loadEvidence}><Text style={styles.refresh}>새로고침</Text></Pressable></View><Text style={styles.hint}>전체 이력 {publicScheduleTotal.toLocaleString("ko-KR")}건 · 현재 표시 {activePublicSchedules.length}건 · 중복 숨김 {duplicatePublicScheduleCount}건</Text><Text style={styles.hint}>공개 완료·중단·만료 자료를 관리합니다.</Text><View style={styles.compactTableHeader}><Text style={styles.compactNumber}>#</Text><Text style={styles.compactMain}>학원명 · 등록 시간표 수</Text><Text style={styles.compactAction}>상세</Text></View>{[...new Map(activePublicSchedules.map((item:any)=>[item.studio_id,{studio_id:item.studio_id,studio_name:item.studio_name}])).values()].map((studio:any,index)=><View key={"active-schedule-studio-"+studio.studio_id}><View style={styles.compactTableRow}><Text style={styles.compactNumber}>{index+1}</Text><View style={styles.compactMain}><Text style={styles.compactPrimary}>{studio.studio_name||"학원명 미확인"}</Text><Text style={styles.compactSecondary}>{activePublicSchedules.filter((x:any)=>x.studio_id===studio.studio_id).length}개 이력</Text></View><Pressable onPress={()=>setExpandedPublicScheduleStudioId(id=>id===studio.studio_id?null:studio.studio_id)}><Text style={styles.compactAction}>{expandedPublicScheduleStudioId===studio.studio_id?"접기":"상세 보기"}</Text></Pressable></View>{expandedPublicScheduleStudioId===studio.studio_id&&<View style={styles.compactExpanded}>{activePublicSchedules.filter((x:any)=>x.studio_id===studio.studio_id).map((item:any)=><View key={"public-schedule-detail-"+item.id} style={styles.compactTableRow}><View style={styles.compactMain}><Text style={styles.compactPrimary}>{String(item.schedule_text||"내용 없음")}</Text><Text style={styles.compactSecondary}>게시일 {item.source_post_date||"미확인"} · 사진 {Array.isArray(item.image_urls)?item.image_urls.length:0}/8 · {item.is_active&&(!item.expires_at||item.expires_at>=seoulDate())?"공개 중":item.is_active?"만료":"공개 중단"}</Text><Pressable onPress={()=>uploadMaterialPhotos("schedule",item)} disabled={evidenceBusy}><Text style={styles.compactAction}>사진 추가</Text></Pressable></View>{item.is_active&&(!item.expires_at||item.expires_at>=seoulDate())&&<Pressable onPress={()=>deactivatePublicSchedule(item)} disabled={evidenceBusy}><Text style={[styles.compactAction,{color:"#B95764"}]}>중단</Text></Pressable>}<Pressable onPress={()=>deletePublicSchedule(item)} disabled={evidenceBusy}><Text style={[styles.compactAction,{color:"#B95764"}]}>삭제</Text></Pressable></View>)}</View>}</View>)}{!activePublicSchedules.length&&!evidenceBusy&&<Text style={styles.hint}>공개 이력이 없습니다.</Text>}{publicScheduleOffset<publicScheduleTotal&&<Pressable style={styles.secondary} disabled={evidenceBusy} onPress={()=>loadMorePublicPage("schedule")}><Text style={styles.secondaryText}>다음 시간표 이력 100개</Text></Pressable>}</View>
<View style={styles.panel}><View style={{gap:8}}><View style={styles.listHead}><Text style={styles.heading}>공개 대기 시간표</Text><Pressable onPress={loadEvidence} disabled={evidenceBusy}><Text style={styles.refresh}>새로고침</Text></Pressable></View><Text style={styles.hint}>공개 이력이 없는 검증 후보만 표시합니다. 동일 학원·동일 시간표 내용은 한 건으로 묶어 중복 노출을 줄였습니다.</Text><View style={styles.reviewToolbar}><Pressable style={styles.toolbarButton} disabled={evidenceBusy||!verifiedScheduleRows.some(item=>!publishedScheduleCandidateIds.includes(item.id))} onPress={()=>setSelectedScheduleIds(publicPendingScheduleRows.map(item=>item.id))}><Text style={styles.secondaryText}>전체 선택</Text></Pressable><Pressable style={styles.toolbarButton} disabled={evidenceBusy||!selectedScheduleIds.length} onPress={()=>setSelectedScheduleIds([])}><Text style={styles.secondaryText}>선택 해제</Text></Pressable><Pressable style={[styles.toolbarButton,{backgroundColor:c.purple,borderColor:c.purple}]} disabled={evidenceBusy||!selectedScheduleIds.length} onPress={publishScheduleBatch}><Text style={{color:"#fff",fontWeight:"800"}}>선택 {selectedScheduleIds.length}개 공개</Text></Pressable></View><Text style={styles.hint}>전체 {Math.max(0,verifiedScheduleTotal-publishedScheduleCandidateIds.length).toLocaleString("ko-KR")}건 · 현재 {publicPendingScheduleRows.length}건 · 선택 {selectedScheduleIds.length}건</Text></View>{publicPendingScheduleRows.map((item,index)=><View key={"verified-schedule-"+item.id} style={styles.scheduleReviewCard}><View style={styles.scheduleReviewHeader}><Text style={styles.scheduleReviewIndex}>#{index+1}</Text><View style={{flex:1,minWidth:0}}><Text style={styles.compactPrimary} numberOfLines={2}>{item.studio_name}</Text><Text style={styles.compactSecondary} numberOfLines={3}>{String(item.normalized_value||item.candidate_value||item.evidence_text||"내용 없음")}</Text><Text style={styles.compactSecondary}>{item.source_post_date?"게시일 "+item.source_post_date:"게시일 미확인"}</Text></View></View><View style={styles.scheduleReviewActions}><Pressable style={styles.scheduleReviewButton} disabled={evidenceBusy} onPress={()=>setSelectedScheduleIds(ids=>ids.includes(item.id)?ids.filter(id=>id!==item.id):[...ids,item.id])}><Text style={styles.scheduleReviewButtonText}>{selectedScheduleIds.includes(item.id)?"선택됨":"선택"}</Text></Pressable><Pressable style={styles.scheduleReviewButton} disabled={!item.source_url} onPress={()=>item.source_url&&Linking.openURL(item.source_url).catch(()=>Alert.alert("원문 확인","주소를 열 수 없습니다."))}><Text style={styles.scheduleReviewButtonText}>원문 확인</Text></Pressable><Pressable style={[styles.scheduleReviewButton,{borderColor:"#E8C9CE"}]} disabled={evidenceBusy} onPress={()=>deleteScheduleCandidate(item)}><Text style={[styles.scheduleReviewButtonText,{color:"#B95764"}]}>삭제</Text></Pressable></View></View>)}{!verifiedScheduleRows.filter(item=>!publishedScheduleCandidateIds.includes(item.id)).length&&!evidenceBusy&&<Text style={styles.hint}>공개 대기 시간표가 없습니다.</Text>}{verifiedScheduleOffset<verifiedScheduleTotal&&<Pressable style={styles.secondary} disabled={evidenceBusy} onPress={()=>loadMoreVerifiedPage("schedule")}><Text style={styles.secondaryText}>다음 시간표 후보 100개</Text></Pressable>}</View>
<View style={styles.panel}><View style={styles.listHead}><Text style={styles.heading}>시간표 후보</Text><Pressable onPress={loadScheduleClassCandidates}><Text style={styles.refresh}>새로고침</Text></Pressable></View><Text style={styles.hint}>대기 {scheduleClassCandidateTotal.toLocaleString("ko-KR")}건 · 현재 표시 {scheduleClassCandidates.length}건</Text><View style={styles.compactTableHeader}><Text style={styles.compactNumber}>#</Text><Text style={styles.compactMain}>학원 · 수업</Text><Text style={styles.compactAction}>상세</Text></View>{scheduleClassCandidates.slice(0,100).map((candidate,index)=><View key={"class-candidate-"+candidate.id}><View style={styles.compactTableRow}><Text style={styles.compactNumber}>{index+1}</Text><View style={styles.compactMain}><Text style={styles.compactPrimary} numberOfLines={1}>{candidate.studio_name}</Text><Text style={styles.compactSecondary} numberOfLines={1}>{candidateTitles[candidate.id]||candidate.proposed_title} · {(candidate.sessions||[]).length}개 세션</Text></View><Pressable onPress={()=>setExpandedScheduleCandidateId(id=>id===candidate.id?null:candidate.id)}><Text style={styles.compactAction}>{expandedScheduleCandidateId===candidate.id?"접기":"상세"}</Text></Pressable></View>{expandedScheduleCandidateId===candidate.id&&<View style={styles.compactExpanded}><TextInput style={styles.input} value={candidateTitles[candidate.id]??candidate.proposed_title} onChangeText={value=>setCandidateTitles(current=>({...current,[candidate.id]:value}))} placeholder="수업명"/><TextInput style={[styles.input,{minHeight:84,textAlignVertical:"top"}]} multiline value={candidateSessions[candidate.id]??(candidate.sessions||[]).map((x:any)=>[x.weekday,x.start_time,x.end_time||"",x.note||""].join(",")).join("\n")} onChangeText={value=>setCandidateSessions(current=>({...current,[candidate.id]:value}))} placeholder="요일번호,시작,종료,메모"/><Pressable onPress={()=>Linking.openURL(candidate.source_url)}><Text style={styles.action}>원문 확인</Text></Pressable><View style={styles.buttons}><Pressable style={styles.secondary} disabled={evidenceBusy} onPress={()=>rejectScheduleClassCandidate(candidate)}><Text style={styles.secondaryText}>제외</Text></Pressable><Pressable style={styles.button} disabled={evidenceBusy} onPress={()=>createClassFromScheduleCandidate(candidate)}><Text style={styles.buttonText}>확인 후 수업 등록</Text></Pressable></View></View>}</View>)}{!scheduleClassCandidates.length&&!evidenceBusy&&<Text style={styles.hint}>등록 후보가 없습니다.</Text>}{scheduleClassCandidateOffset<scheduleClassCandidateTotal&&<Pressable style={styles.secondary} disabled={evidenceBusy} onPress={loadMoreScheduleClassCandidates}><Text style={styles.secondaryText}>다음 시간표 후보 100개</Text></Pressable>}</View>
<View style={styles.panel}><View style={styles.listHead}><Text style={styles.heading}>공개 대기 가격</Text><Pressable onPress={()=>setSelectedPriceIds(publicPendingPriceRows.map(item=>item.id))}><Text style={styles.refresh}>전체 선택</Text></Pressable><Pressable onPress={()=>setSelectedPriceIds([])}><Text style={styles.refresh}>해제</Text></Pressable><Pressable onPress={loadEvidence}><Text style={styles.refresh}>새로고침</Text></Pressable></View><Text style={styles.hint}>전체 {Math.max(0,verifiedPriceTotal-publishedCandidateIds.length).toLocaleString("ko-KR")}건 · 현재 {publicPendingPriceRows.length}건 · 선택 {selectedPriceIds.length}건</Text><Pressable style={styles.button} disabled={evidenceBusy||!selectedPriceIds.length} onPress={publishPriceBatch}><Text style={styles.buttonText}>선택 {selectedPriceIds.length}개 공개</Text></Pressable><View style={styles.compactTableHeader}><Text style={styles.compactNumber}>#</Text><Text style={styles.compactMain}>학원 · 가격</Text><Text style={styles.compactAction}>선택</Text></View>{publicPendingPriceRows.map((item,index)=><View key={"verified-price-"+item.id} style={styles.compactTableRow}><Text style={styles.compactNumber}>{index+1}</Text><Pressable style={styles.compactMain} onPress={()=>Linking.openURL(item.source_url)}><Text style={styles.compactPrimary} numberOfLines={1}>{item.studio_name}</Text><Text style={styles.compactSecondary} numberOfLines={1}>{Number(item.normalized_value||0).toLocaleString("ko-KR")}원 · {item.price_period||"기간 미확인"}</Text></Pressable><View style={{gap:8,alignItems:"center"}}><Pressable onPress={()=>setSelectedPriceIds(ids=>ids.includes(item.id)?ids.filter(id=>id!==item.id):[...ids,item.id])}><Text style={styles.compactAction}>{selectedPriceIds.includes(item.id)?"☑":"□"}</Text></Pressable><Pressable onPress={()=>deletePriceCandidate(item)} disabled={evidenceBusy}><Text style={[styles.compactAction,{color:"#B95764"}]}>삭제</Text></Pressable></View></View>)}{!verifiedPriceRows.length&&!evidenceBusy&&<Text style={styles.hint}>공개 대기 가격이 없습니다.</Text>}{verifiedPriceOffset<verifiedPriceTotal&&<Pressable style={styles.secondary} disabled={evidenceBusy} onPress={()=>loadMoreVerifiedPage("price")}><Text style={styles.secondaryText}>다음 가격 후보 100개</Text></Pressable>}</View>
        </>}
    {adminTab==="review"&&<View style={{gap:12}}>
<View style={styles.panel}><View style={{gap:8}}><Text style={styles.heading}>자료 검토</Text><Text style={styles.hint}>최근 {evidenceRows.length}건 표시 · 전체 대기 {totalEvidencePending}건</Text><View style={styles.reviewToolbar}><Pressable style={styles.toolbarButton} onPress={()=>setSelectedEvidenceIds(evidenceRows.map(row=>row.id))}><Text style={styles.secondaryText}>전체 선택</Text></Pressable><Pressable style={styles.toolbarButton} onPress={()=>setSelectedEvidenceIds([])}><Text style={styles.secondaryText}>선택 해제</Text></Pressable><Pressable style={styles.toolbarButton} onPress={loadEvidence}><Text style={styles.secondaryText}>새로고침</Text></Pressable></View></View><View style={styles.buttons}><Pressable style={styles.secondary} disabled={evidenceBusy||!selectedEvidenceIds.length} onPress={()=>reviewEvidenceBatch("rejected")}><Text style={styles.secondaryText}>선택 {selectedEvidenceIds.length}개 제외</Text></Pressable><Pressable style={styles.button} disabled={evidenceBusy||!selectedEvidenceIds.length} onPress={()=>reviewEvidenceBatch("verified")}><Text style={styles.buttonText}>선택 {selectedEvidenceIds.length}개 근거 확인</Text></Pressable></View><View style={styles.compactTableHeader}><Text style={styles.compactNumber}>#</Text><Text style={styles.compactMain}>학원 · 유형 · 요약</Text><Text style={styles.compactAction}>선택</Text></View>{evidenceBusy&&<ActivityIndicator color={c.purple}/>}{evidenceRows.slice(0,100).map((item,index)=><View key={item.id} style={styles.compactTableRow}><Text style={styles.compactNumber}>{index+1}</Text><View style={styles.compactMain}><Text style={styles.compactPrimary} numberOfLines={1}>{item.studio_name}</Text><Text style={styles.compactSecondary} numberOfLines={1}>{item.candidate_type==="price"?"가격":"시간표"} · {item.candidate_type==="price"&&item.normalized_value?Number(item.normalized_value).toLocaleString("ko-KR")+"원 · "+(item.price_period||"기간 미확인"):(item.normalized_value||item.candidate_value||item.evidence_text||"내용 없음")}</Text><Text style={styles.compactSecondary} numberOfLines={1}>게시일 {item.source_post_date||"미확인"} · 신뢰도 {Math.round(item.confidence*100)}%</Text></View><Pressable onPress={()=>setSelectedEvidenceIds(ids=>ids.includes(item.id)?ids.filter(id=>id!==item.id):[...ids,item.id])}><Text style={styles.compactAction}>{selectedEvidenceIds.includes(item.id)?"☑":"□"}</Text></Pressable></View>)}{!evidenceRows.length&&!evidenceBusy&&<Text style={styles.hint}>검토 대기 자료가 없습니다.</Text>}</View>
<View style={styles.panel}>
  <View style={styles.listHead}>
    <Text style={styles.heading}>학원 사진 검토</Text>
    <Pressable onPress={loadPhotoCandidates} disabled={photoReviewBusy}><Text style={styles.refresh}>{photoReviewBusy?"조회 중…":"새로고침"}</Text></Pressable>
  </View>
  <Text style={styles.hint}>대기 {photoCandidateTotal.toLocaleString("ko-KR")}건 · 현재 표시 {photoCandidateRows.length}건</Text>\n  <Text style={styles.hint}>공식 홈페이지에서 수집한 사진 후보입니다. 사진과 원본을 확인하고, 학원 소유 또는 사용 허가가 확인된 경우에만 승인해 주세요. 승인된 사진만 학원 갤러리에 추가됩니다.</Text>
  {photoReviewBusy&&<ActivityIndicator color={c.purple}/>}
  {photoCandidateRows.map(item=><View key={"photo-candidate-"+item.id} style={[styles.evidenceCard,{flexDirection:"row",alignItems:"flex-start"}]}>
    <Image source={{uri:item.image_url}} style={{width:92,height:76,borderRadius:9,backgroundColor:c.bg}} resizeMode="cover"/>
    <View style={{flex:1,minWidth:0,gap:5}}>
      <Text style={styles.evidenceStudio}>{item.studio_name}</Text>
      <Text style={styles.compactSecondary} numberOfLines={1}>{item.source_host||"출처 미확인"} · {new Date(item.created_at).toLocaleDateString("ko-KR")}</Text>
      <Pressable onPress={()=>Linking.openURL(item.source_page_url).catch(()=>Alert.alert("출처 확인","원본 페이지를 열 수 없습니다."))}><Text style={styles.action}>원본 홈페이지 확인 ↗</Text></Pressable>
      <View style={styles.buttons}>
        <Pressable style={styles.secondary} disabled={photoReviewBusy} onPress={()=>reviewPhotoCandidate(item,"rejected")}><Text style={styles.secondaryText}>제외</Text></Pressable><Pressable style={styles.secondary} disabled={photoReviewBusy} onPress={()=>deletePhotoCandidate(item)}><Text style={styles.secondaryText}>영구 삭제</Text></Pressable>
        <Pressable style={styles.button} disabled={photoReviewBusy} onPress={()=>reviewPhotoCandidate(item,"approved")}><Text style={styles.buttonText}>사진 승인</Text></Pressable>
      </View>
    </View>
  </View>)}
  {!photoCandidateRows.length&&!photoReviewBusy&&<Text style={styles.hint}>검토 대기 사진이 없습니다. 학원 관리에서 공식 홈페이지 사진 수집을 실행하면 후보가 여기에 표시됩니다.</Text>}{photoCandidateOffset<photoCandidateTotal&&<Pressable style={styles.secondary} disabled={photoReviewBusy} onPress={loadMorePhotoCandidates}><Text style={styles.secondaryText}>다음 사진 40장</Text></Pressable>}
</View>

    </View>}
    {adminTab==="studios"&&<>
<View style={styles.panel}><Text style={styles.heading}>{editing?"학원 정보 수정":"학원 등록"}</Text>{field("학원명 *","name")}{field("위도 *","latitude","decimal-pad")}{field("경도 *","longitude","decimal-pad")}{field("지역/구","district")}{field("주소","address")}{field("전화번호","phone","phone-pad")}{field("공식 홈페이지 URL (https://)","website_url")}{field("정보 출처 URL (https://)","source_url")}{field("정보 출처명","source_name")}{field("정보 확인일 (YYYY-MM-DD)","verified_at")}{field("사진 URL (최대 10개, 줄바꿈 구분)","image_urls")}{editing&&form.image_urls.split(/[\\n,]+/).map(value=>value.trim()).filter(Boolean).map((url,index)=><View key={"edit-photo-"+index} style={styles.row}><Image source={{uri:url}} style={{width:62,height:52,borderRadius:8,backgroundColor:c.bg}} resizeMode="cover"/><Text style={[styles.compactSecondary,{flex:1}]} numberOfLines={1}>사진 {index+1}</Text><Pressable onPress={()=>removeStudioGalleryPhoto(editing,url)}><Text style={[styles.action,{color:"#B95764"}]}>삭제</Text></Pressable></View>)}{field("사진 출처명 (예: 관리자 직접 등록)","image_source_name")}{field("사진 사용 허가/출처 메모","image_usage_note")}{field("1회 수업 가격 (원)","price_per_class","numeric")}
      <View style={styles.toggles}>{toggle("성인 수업","adult_classes")}{toggle("키즈 수업","kids_classes")}{toggle("앱에 공개","is_active")}</View>
      <View style={styles.buttons}>{editing&&<Pressable style={styles.secondary} onPress={reset}><Text style={styles.secondaryText}>취소</Text></Pressable>}<Pressable style={styles.button} onPress={save} disabled={busy}><Text style={styles.buttonText}>{busy?"저장 중…":editing?"수정 저장":"학원 등록"}</Text></Pressable></View>
    </View>
    {officialBlogStudio&&<View style={styles.panel}>
      <View style={styles.listHead}><Text style={styles.heading}>{officialBlogStudio.name} · 공식 블로그</Text><Pressable onPress={()=>{setOfficialBlogStudio(null);setOfficialBlogUrls("");}}><Text style={styles.refresh}>닫기</Text></Pressable></View>
      <Text style={styles.hint}>학원에서 직접 운영하는 네이버 블로그 프로필 주소만 등록하세요. 게시글 URL이 아니라 블로그 홈 주소를 입력합니다. 등록된 계정의 게시물만 앱의 공개 소식에 표시됩니다. 최대 5개, 한 줄에 하나씩 입력하세요.</Text>
      <TextInput style={[styles.input,{minHeight:100,textAlignVertical:"top"}]} multiline autoCapitalize="none" autoCorrect={false} value={officialBlogUrls} onChangeText={setOfficialBlogUrls} placeholder={"https://blog.naver.com/blogid\nhttps://blog.naver.com/anotherid"}/>
      <View style={styles.buttons}><Pressable style={styles.secondary} onPress={()=>{setOfficialBlogStudio(null);setOfficialBlogUrls("");setOfficialBlogCandidates([]);}}><Text style={styles.secondaryText}>취소</Text></Pressable><Pressable style={styles.button} disabled={officialBlogBusy} onPress={saveOfficialBlogAccounts}><Text style={styles.buttonText}>{officialBlogBusy?"처리 중…":"공식 계정 저장"}</Text></Pressable></View>
      <View style={styles.listHead}><Text style={styles.heading}>자동 발견된 계정 후보 ({officialBlogCandidates.filter((x:any)=>x.review_status==="pending").length})</Text><Pressable onPress={async()=>{setOfficialBlogBusy(true);const result=await supabase!.rpc("admin_list_studio_blog_account_candidates",{p_studio_id:officialBlogStudio.id});if(result.error)Alert.alert("후보 조회 실패",result.error.message);else setOfficialBlogCandidates(Array.isArray(result.data)?result.data:[]);setOfficialBlogBusy(false);}}><Text style={styles.refresh}>새로고침</Text></Pressable></View>
      <Text style={styles.hint}>학원명 검색 결과에서 계정명·게시글 내용·영문 블로그 ID·반복 노출을 종합해 후보를 찾습니다. 일치도가 낮은 후보도 확인할 수 있으며, 공식 여부를 확인한 뒤 승인하세요. 승인 전에는 공개되지 않습니다.</Text>
      {officialBlogCandidates.map((candidate:any)=><View key={String(candidate.id)} style={styles.evidenceCard}>
        <View style={styles.listHead}><Text style={styles.rowName}>{candidate.blogger_name||"블로그 이름 미확인"}</Text><Text style={styles.evidenceType}>{candidate.review_status==="pending"?"승인 대기":candidate.review_status==="approved"?"승인됨":"거절됨"}</Text></View>
        <Text selectable style={styles.rowMeta}>{candidate.blogger_url}</Text>
        <Text style={styles.rowMeta}>학원명 일치 게시물 {candidate.matched_post_count}건 · 일치도 {candidate.match_score}/100</Text>
        {(Array.isArray(candidate.sample_posts)?candidate.sample_posts:[]).slice(0,3).map((post:any,index:number)=><Pressable key={String(post.post_url||index)} onPress={()=>post.post_url&&Linking.openURL(post.post_url).catch(()=>Alert.alert("게시물 연결","주소를 열 수 없습니다."))}><Text style={styles.action} numberOfLines={2}>· {post.title||"검색 게시물 확인"} ↗</Text></Pressable>)}
        {candidate.review_status==="pending"&&<View style={styles.buttons}><Pressable style={styles.button} disabled={officialBlogBusy} onPress={()=>reviewOfficialBlogCandidate(Number(candidate.id),"approved")}><Text style={styles.buttonText}>공식 계정 승인</Text></Pressable><Pressable style={styles.secondary} disabled={officialBlogBusy} onPress={()=>reviewOfficialBlogCandidate(Number(candidate.id),"rejected")}><Text style={styles.secondaryText}>공식 아님</Text></Pressable></View>}
      </View>)}
      {!officialBlogCandidates.length&&!officialBlogBusy&&<Text style={styles.hint}>아직 후보가 없습니다. 해당 학원의 블로그 검색 작업이 완료되면 후보가 자동으로 쌓입니다.</Text>}
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
    <View style={styles.panel}><View style={styles.listHead}><Text style={styles.heading}>등록 학원 · 화면 {visibleStudioRows.length}/{filteredStudioRows.length} · 조회 {rows.length}개</Text><Pressable onPress={load}><Text style={styles.refresh}>새로고침</Text></Pressable></View>
      <TextInput style={styles.input} value={studioSearch} onChangeText={value=>{setStudioSearch(value);setStudioVisibleLimit(100);}} placeholder="학원명·지역·주소·전화 검색" autoCapitalize="none"/><View style={styles.buttons}><Pressable style={styles.button} disabled={busy} onPress={searchStudiosServer}><Text style={styles.buttonText}>전체 학원 검색</Text></Pressable><Pressable style={styles.secondary} disabled={busy} onPress={()=>{setStudioSearch("");setStudioAppliedSearch("");load();}}><Text style={styles.secondaryText}>초기화</Text></Pressable></View>
      <View style={styles.toggles}>{([{key:"all",label:"전체"},{key:"missing_photo",label:"사진 없음"},{key:"missing_website",label:"홈페이지 없음"},{key:"website_candidate",label:"홈페이지 후보"},{key:"active",label:"공개"},{key:"inactive",label:"비공개"}] as const).map(option=><Pressable key={option.key} style={[styles.toggle,studioListFilter===option.key&&{borderColor:c.purple,backgroundColor:c.pale}]} onPress={()=>{setStudioListFilter(option.key);setStudioVisibleLimit(100);}}><Text style={[styles.toggleText,studioListFilter===option.key&&styles.toggleOn]}>{option.label}</Text></Pressable>)}</View>{busy&&<ActivityIndicator color={c.purple}/>}
      {visibleStudioRows.map(r=><View key={r.id} style={styles.row}>{(r.image_urls||[]).length>0&&!failedStudioThumbIds.includes(r.id)?<Image source={{uri:r.image_urls![0]}} style={styles.studioListImage} resizeMode="cover" onError={()=>setFailedStudioThumbIds(ids=>ids.includes(r.id)?ids:[...ids,r.id])}/>:<View style={styles.studioListThumb}><Ionicons name="image-outline" size={22} color={c.muted}/></View>}<View style={{flex:1,minWidth:0}}><Text style={styles.rowName} numberOfLines={1}>{r.name}</Text><Text style={styles.rowMeta}>{r.district||"지역 미입력"} · 사진 {(r.image_urls||[]).length}장 · {r.is_active?"공개":"비공개"}{String(r.source_name||"").includes("홈페이지 검색 후보")?" · 홈페이지 후보(미검증)":""}</Text>{String(r.source_name||"").includes("홈페이지 검색 후보")&&!!r.website_url&&<Pressable onPress={()=>Linking.openURL(r.website_url!).catch(()=>Alert.alert("홈페이지 연결","주소를 열 수 없습니다."))}><Text style={styles.action}>후보 홈페이지 확인 ↗</Text></Pressable>}</View><Pressable style={styles.manageButton} onPress={()=>setStudioActionId(current=>current===r.id?null:r.id)}><Text style={styles.manageButtonText}>{studioActionId===r.id?"닫기":"관리"}</Text></Pressable>{studioActionId===r.id&&<View style={styles.studioActionMenu}><Pressable style={styles.manageAction} onPress={()=>{setStudioActionId(null);startEdit(r);}}><Text style={styles.manageButtonText}>정보 수정</Text></Pressable><Pressable style={styles.manageAction} onPress={()=>{setStudioActionId(null);setClassStudio(r);resetClass();}}><Text style={styles.manageButtonText}>수업 관리</Text></Pressable><Pressable style={styles.manageAction} onPress={()=>{setStudioActionId(null);openOfficialBlogManager(r);}}><Text style={styles.manageButtonText}>공식 블로그 등록</Text></Pressable><Pressable style={styles.manageAction} onPress={()=>{setStudioActionId(null);uploadPhotos(r.id,r.name);}}><Text style={styles.manageButtonText}>사진 업로드</Text></Pressable><Pressable style={styles.manageAction} onPress={()=>{setStudioActionId(null);requeueStudioBlogSearch(r);}}><Text style={styles.manageButtonText}>블로그 검색</Text></Pressable><Pressable style={styles.manageAction} onPress={()=>{setStudioActionId(null);if(r.source_name?.includes("홈페이지 검색 후보")&&r.source_name.includes("미검증"))verifyHomepageCandidate(r);else if(r.website_url)crawlImages(r.id,r.name);else Alert.alert("홈페이지 필요","사진 자동 수집을 위해 홈페이지 주소를 먼저 등록해 주세요.");}}><Text style={styles.manageButtonText}>{r.source_name?.includes("홈페이지 검색 후보")&&r.source_name.includes("미검증")?"홈페이지 후보 확인":"사진 수집"}</Text></Pressable><Pressable style={styles.manageAction} onPress={()=>{setStudioActionId(null);remove(r.id,r.name);}}><Text style={[styles.manageButtonText,{color:"#B95764"}]}>삭제</Text></Pressable></View>}</View>)}
      {visibleStudioRows.length<filteredStudioRows.length&&<Pressable style={styles.secondary} onPress={()=>setStudioVisibleLimit(limit=>limit+100)}><Text style={styles.secondaryText}>학원 100개 더 보기 ({visibleStudioRows.length}/{filteredStudioRows.length})</Text></Pressable>}
      {studioHasMore&&<Pressable style={styles.secondary} disabled={busy} onPress={loadMoreStudios}><Text style={styles.secondaryText}>{busy?"조회 중…":"다음 학원 50개 불러오기"}</Text></Pressable>}
      {!rows.length&&!busy&&<Text style={styles.hint}>등록된 학원이 없습니다.</Text>}{rows.length>0&&!visibleStudioRows.length&&<Text style={styles.hint}>검색/필터 조건에 맞는 학원이 없습니다.</Text>}
    </View>
    </>}
  </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}
export function ErrorBoundary({error,retry}:{error:any;retry:()=>void}){
  const detail=String(error?.stack||error?.message||error||"알 수 없는 오류");
  return <SafeAreaView style={styles.safe}><View style={styles.login}><Text style={styles.brand}>관리자 화면 오류</Text><Text style={styles.hint}>오류 위치를 확인할 수 있도록 상세 내용을 표시합니다.</Text><ScrollView style={{maxHeight:320}}><Text selectable style={styles.errorHint}>{detail}</Text></ScrollView><Pressable style={[styles.button,styles.loginButton]} onPress={retry}><Text style={styles.buttonText}>다시 시도</Text></Pressable></View></SafeAreaView>;
}
const styles=StyleSheet.create({safe:{flex:1,backgroundColor:c.bg},login:{flex:1,justifyContent:"center",paddingHorizontal:22,paddingVertical:20,gap:10,width:"100%",maxWidth:460,alignSelf:"center"},loginButton:{flex:0,alignSelf:"stretch",minHeight:46},content:{paddingHorizontal:14,paddingTop:12,paddingBottom:24,gap:12},adminTabs:{flexDirection:"row",gap:7,marginBottom:2},adminTab:{flex:1,paddingVertical:11,borderRadius:11,backgroundColor:"#F0EDF5",alignItems:"center"},adminTabActive:{backgroundColor:c.purple},adminTabText:{fontSize:12,fontWeight:"700",color:c.muted},adminTabTextActive:{color:"#fff"},manageButton:{paddingHorizontal:13,paddingVertical:8,borderRadius:9,backgroundColor:c.pale},studioListThumb:{width:62,height:62,borderRadius:11,backgroundColor:c.bg,borderWidth:1,borderColor:c.line,alignItems:"center",justifyContent:"center",overflow:"hidden"},studioListImage:{width:62,height:62,borderRadius:11,backgroundColor:c.bg},manageButtonText:{fontSize:12,fontWeight:"800",color:c.purple},studioActionMenu:{width:"100%",flexDirection:"row",flexWrap:"wrap",gap:7,paddingTop:5},manageAction:{paddingHorizontal:10,paddingVertical:7,borderRadius:8,backgroundColor:c.bg,borderWidth:1,borderColor:c.line},reviewToolbar:{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:7},toolbarButton:{minHeight:38,paddingHorizontal:12,paddingVertical:8,borderRadius:9,borderWidth:1,borderColor:c.line,backgroundColor:c.bg,alignItems:"center",justifyContent:"center"},compactTableHeader:{flexDirection:"row",alignItems:"center",paddingVertical:6,borderBottomWidth:1,borderBottomColor:c.line},compactTableRow:{flexDirection:"row",alignItems:"center",gap:8,minHeight:44,paddingVertical:6,borderBottomWidth:1,borderBottomColor:c.line},scheduleReviewCard:{padding:11,borderRadius:12,borderWidth:1,borderColor:c.line,backgroundColor:c.bg,gap:9},scheduleReviewHeader:{flexDirection:"row",alignItems:"flex-start",gap:9},scheduleReviewIndex:{width:26,fontSize:11,color:c.muted,fontWeight:"800",paddingTop:2},scheduleReviewActions:{flexDirection:"row",flexWrap:"wrap",gap:7,justifyContent:"flex-end"},scheduleReviewButton:{minHeight:34,paddingHorizontal:12,paddingVertical:7,borderRadius:8,borderWidth:1,borderColor:c.line,backgroundColor:"#fff",alignItems:"center",justifyContent:"center"},scheduleReviewButtonText:{fontSize:11,fontWeight:"800",color:c.purple},compactNumber:{width:24,fontSize:11,color:c.muted,textAlign:"center",fontVariant:["tabular-nums"]},compactMain:{flex:1,minWidth:0},compactPrimary:{fontSize:12,fontWeight:"800",color:c.ink},compactSecondary:{fontSize:10,color:c.muted,marginTop:2},compactAction:{width:40,textAlign:"center",fontSize:11,fontWeight:"800",color:c.purple},compactExpanded:{padding:10,backgroundColor:c.bg,borderRadius:10,gap:7},header:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},brand:{fontSize:21,fontWeight:"900",color:c.ink},hint:{fontSize:12,color:c.muted,marginTop:5},logout:{color:c.purple,fontWeight:"700"},panel:{backgroundColor:"#fff",padding:14,borderRadius:16,borderWidth:1,borderColor:c.line,gap:10},statsGrid:{flexDirection:"row",flexWrap:"wrap",gap:8},statCard:{width:"31%",flexGrow:1,minWidth:90,backgroundColor:c.bg,borderRadius:12,padding:10,borderWidth:1,borderColor:c.line},statLabel:{fontSize:11,color:c.muted,fontWeight:"700"},statValue:{fontSize:22,fontWeight:"900",color:c.ink,marginTop:4},statCaption:{fontSize:10,color:c.muted,marginTop:3},errorHint:{fontSize:11,color:"#B95764",marginTop:3},heading:{fontSize:16,fontWeight:"800",color:c.ink},field:{gap:5},label:{fontSize:12,color:c.muted},input:{minHeight:44,borderWidth:1,borderColor:c.line,borderRadius:10,paddingHorizontal:11,paddingVertical:9,color:c.ink,backgroundColor:"#fff",fontSize:13},toggles:{flexDirection:"row",flexWrap:"wrap",gap:8},toggle:{borderWidth:1,borderColor:c.line,borderRadius:10,padding:9},toggleText:{fontSize:12,color:c.muted},toggleOn:{color:c.purple,fontWeight:"800"},buttons:{flexDirection:"row",gap:8},button:{backgroundColor:c.purple,minHeight:44,paddingHorizontal:12,paddingVertical:11,borderRadius:11,alignItems:"center",flex:1},buttonText:{color:"#fff",fontWeight:"800"},secondary:{minHeight:44,paddingHorizontal:12,paddingVertical:11,borderWidth:1,borderColor:c.line,borderRadius:12,alignItems:"center"},secondaryText:{color:c.ink},listHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},refresh:{color:c.purple,fontWeight:"700"},row:{flexDirection:"row",flexWrap:"wrap",alignItems:"center",gap:10,paddingVertical:12,borderBottomWidth:1,borderBottomColor:c.line},rowName:{fontSize:13,fontWeight:"800",color:c.ink},rowMeta:{fontSize:11,color:c.muted,marginTop:3},action:{fontSize:12,color:c.purple,fontWeight:"700"},evidenceCard:{backgroundColor:c.bg,borderWidth:1,borderColor:c.line,borderRadius:13,padding:12,gap:7},evidenceStudio:{fontSize:13,fontWeight:"900",color:c.ink,flex:1},evidenceType:{fontSize:10,fontWeight:"800",color:c.purple,backgroundColor:c.pale,paddingHorizontal:8,paddingVertical:5,borderRadius:8},evidenceValue:{fontSize:13,lineHeight:20,color:c.ink},evidenceText:{fontSize:12,lineHeight:19,color:c.ink},rowActions:{flexDirection:"row",flexWrap:"wrap",gap:14,paddingTop:5},reject:{fontSize:12,color:"#B95764",fontWeight:"700"}});

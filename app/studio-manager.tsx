import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { supabase } from "../lib/supabase";

const C={ink:"#252238",muted:"#8B879A",purple:"#653BB7",pale:"#F2ECFF",line:"#E9E2F2",bg:"#FBF9FF",red:"#A33342"};
const dateAfterDays=(days:number)=>{const d=new Date();d.setDate(d.getDate()+days);return d.toISOString().slice(0,10);};

export default function StudioManager(){
 const router=useRouter();
 const params=useLocalSearchParams<{studioId?:string;studioName?:string}>();
 const studioId=String(params.studioId||"");
 const studioName=String(params.studioName||"선택한 학원");
 const [session,setSession]=useState<any>(null);
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);
 const [owner,setOwner]=useState(false);
 const [application,setApplication]=useState<any>(null);
 const [verificationMethod,setVerificationMethod]=useState<"phone"|"blog"|"instagram"|"manual">("phone");
 const [blogUrl,setBlogUrl]=useState("");
 const [blogVerificationCode,setBlogVerificationCode]=useState("");
 const [galleryCount,setGalleryCount]=useState(0);
 const [galleryUrls,setGalleryUrls]=useState<string[]>([]);
 const [galleryExpanded,setGalleryExpanded]=useState(false);
 const [photoUrl,setPhotoUrl]=useState("");
 const [profileName,setProfileName]=useState(studioName);
 const [profileDistrict,setProfileDistrict]=useState("");
 const [profileAddress,setProfileAddress]=useState("");
 const [profilePhone,setProfilePhone]=useState("");
 const [profileWebsite,setProfileWebsite]=useState("");
 const [profileDescription,setProfileDescription]=useState("");
 const [scheduleText,setScheduleText]=useState("");
 const [priceAmount,setPriceAmount]=useState("");
 const [pricePeriod,setPricePeriod]=useState("월 수강료");
 const [priceFrequency,setPriceFrequency]=useState("");
 const [noticeTitle,setNoticeTitle]=useState("");
 const [noticeBody,setNoticeBody]=useState("");
 const [materials,setMaterials]=useState<any[]>([]);
 const [notices,setNotices]=useState<any[]>([]);
 const [editHistory,setEditHistory]=useState<any[]>([]);

 const load=useCallback(async()=>{
  if(!supabase||!studioId){setLoading(false);return;}
  setLoading(true);
  const {data:auth}=await supabase.auth.getSession();
  const current=auth.session;
  setSession(current);
  if(!current){setOwner(false);setApplication(null);setLoading(false);return;}
  const [ownerResult,appResult,studioResult]=await Promise.all([
   supabase.from("studio_owners").select("studio_id,status").eq("studio_id",studioId).eq("user_id",current.user.id).eq("status","approved").maybeSingle(),
   supabase.from("studio_owner_applications").select("id,status,auto_match_status,auto_match_details,review_note,created_at,verification_url,verification_code,verification_method").eq("studio_id",studioId).eq("user_id",current.user.id).order("created_at",{ascending:false}).limit(1).maybeSingle(),
   supabase.from("studios").select("image_urls,name,district,address,phone,website_url,description").eq("id",studioId).maybeSingle()
  ]);
  setOwner(!!ownerResult.data);
  setApplication(appResult.data||null);
  if(appResult.data){setBlogUrl(appResult.data.verification_url||"");setBlogVerificationCode(appResult.data.verification_code||"");setVerificationMethod(appResult.data.verification_method||"phone");}
  setGalleryUrls(studioResult.data?.image_urls||[]);
  setGalleryCount((studioResult.data?.image_urls||[]).length);
  if(studioResult.data){setProfileName(studioResult.data.name||studioName);setProfileDistrict(studioResult.data.district||"");setProfileAddress(studioResult.data.address||"");setProfilePhone(studioResult.data.phone||"");setProfileWebsite(studioResult.data.website_url||"");setProfileDescription(studioResult.data.description||"");}
  if(ownerResult.data){
   const [scheduleResult,priceResult,noticeResult,historyResult]=await Promise.all([
    supabase.from("studio_public_schedules").select("id,schedule_text,image_urls,is_active,published_at,candidate_id").eq("studio_id",studioId).is("candidate_id",null).order("published_at",{ascending:false}).limit(20),
    supabase.from("studio_public_prices").select("id,amount_krw,price_period,image_urls,is_active,published_at,candidate_id").eq("studio_id",studioId).is("candidate_id",null).order("published_at",{ascending:false}).limit(20),
    supabase.from("studio_owner_notices").select("id,title,body,is_active,created_at").eq("studio_id",studioId).order("created_at",{ascending:false}).limit(20),
    supabase.from("studio_owner_edit_history").select("id,entity,action,changed_fields,created_at").eq("studio_id",studioId).order("created_at",{ascending:false}).limit(20)
   ]);
   setMaterials([...(scheduleResult.data||[]).map(x=>({...x,kind:"schedule"})),...(priceResult.data||[]).map(x=>({...x,kind:"price"}))]);
   setNotices(noticeResult.data||[]);setEditHistory(historyResult.error?[]:(historyResult.data||[]));
  }
  setLoading(false);
 },[studioId]);

 useEffect(()=>{load();if(!supabase)return;const {data:{subscription}}=supabase.auth.onAuthStateChange(()=>load());return()=>subscription.unsubscribe();},[load]);

 const saveProfile=async()=>{
  if(!supabase||!owner)return;
  setSaving(true);
  try{
   const {error}=await supabase.rpc("owner_update_studio_profile",{
    p_studio_id:studioId,p_name:profileName,p_district:profileDistrict,p_address:profileAddress,
    p_phone:profilePhone,p_website_url:profileWebsite,p_description:profileDescription
   });
   if(error)throw error;
   Alert.alert("학원 정보 저장 완료","수정한 기본 정보가 학원 상세 페이지에 반영됩니다.");await load();
  }catch(e:any){Alert.alert("정보 저장 실패",e.message||"학원 정보를 저장하지 못했습니다.");}
  finally{setSaving(false);}
 };

 const submitApplication=async()=>{
  if(!supabase||!session){Alert.alert("로그인 필요","로그인 후 신청해 주세요.");return;}
  const isSocial=verificationMethod==="blog"||verificationMethod==="instagram";
  if(verificationMethod==="phone"&&!profilePhone.trim()){Alert.alert("전화 확인 불가","학원 공개 전화번호가 등록되어 있지 않습니다. 블로그, 인스타그램 또는 직접 확인을 선택해 주세요.");return;}
  if(isSocial&&(!blogUrl.trim()||!blogVerificationCode.trim())){
   Alert.alert("인증 정보 확인","공식 채널 주소와 인증 코드를 입력해 주세요.");return;
  }
  setSaving(true);
  try{
   const {error}=await supabase.rpc("submit_studio_owner_application_light",{
    p_studio_id:studioId,p_verification_method:verificationMethod,
    p_verification_url:isSocial?blogUrl.trim():null,
    p_verification_code:isSocial?blogVerificationCode.trim():null
   });
   if(error)throw error;
   Alert.alert("관리 권한 신청 완료","개인 민감정보와 서류는 수집하지 않습니다. 운영자가 선택한 방법으로 운영 관계를 확인 후 승인합니다.");
   await load();
  }catch(e:any){Alert.alert("신청 실패",e.message||"관리 권한 신청을 제출하지 못했습니다.");}
  finally{setSaving(false);}
 };
 const pickImages=async(multiple=true,maxCount=8)=>{
  const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:["images"],allowsMultipleSelection:multiple,quality:0.9,selectionLimit:maxCount});
  if(result.canceled||!result.assets?.length||!supabase||!session)return [] as string[];
  const urls:string[]=[];
  for(const [index,asset] of result.assets.slice(0,maxCount).entries()){
   const optimized=await ImageManipulator.manipulateAsync(asset.uri,[{resize:{width:1600}}],{compress:0.82,format:ImageManipulator.SaveFormat.JPEG});
   const bytes=await (await fetch(optimized.uri)).arrayBuffer();
   const path=studioId+"/"+session.user.id+"/"+Date.now()+"-"+index+".jpg";
   const {error}=await supabase.storage.from("studio-photos").upload(path,bytes,{contentType:"image/jpeg",upsert:false});
   if(error)throw error;
   urls.push(supabase.storage.from("studio-photos").getPublicUrl(path).data.publicUrl);
  }
  return urls;
 };

 const uploadGallery=async()=>{
  if(!supabase||!owner)return;
  if(galleryCount>=30){Alert.alert("사진 등록 한도","학원 대표 사진은 최대 30장까지 등록할 수 있습니다.");return;}
  setSaving(true);
  try{
   const urls=await pickImages(true,Math.max(1,30-galleryCount));
   let count=galleryCount;
   for(const url of urls){const result=await supabase.rpc("owner_add_studio_gallery_photo",{p_studio_id:studioId,p_image_url:url});if(result.error)throw result.error;count=Number(result.data??count);}
   setGalleryCount(count);
   if(supabase){const refreshed=await supabase.from("studios").select("image_urls").eq("id",studioId).maybeSingle();if(!refreshed.error){setGalleryUrls(refreshed.data?.image_urls||[]);setGalleryCount((refreshed.data?.image_urls||[]).length);}}
   Alert.alert("사진 등록 완료",urls.length+"장을 학원 대표 사진으로 등록했습니다.");
  }catch(e:any){Alert.alert("사진 등록 실패",e.message||"사진을 등록하지 못했습니다.");}
  finally{setSaving(false);}
 };

 const registerPhotoUrl=async()=>{
  const url=photoUrl.trim();
  if(!supabase||!owner)return;
  if(!url.toLowerCase().startsWith("https://")){Alert.alert("URL 확인","https://로 시작하는 사진 주소를 입력해 주세요.");return;}
  if(galleryCount>=30){Alert.alert("사진 등록 한도","학원 대표 사진은 최대 30장까지 등록할 수 있습니다.");return;}
  setSaving(true);
  try{const {error}=await supabase.rpc("owner_add_studio_gallery_photo",{p_studio_id:studioId,p_image_url:url});if(error)throw error;const refreshed=await supabase.from("studios").select("image_urls").eq("id",studioId).maybeSingle();if(refreshed.error)throw refreshed.error;setGalleryUrls(refreshed.data?.image_urls||[]);setGalleryCount((refreshed.data?.image_urls||[]).length);setPhotoUrl("");Alert.alert("사진 등록 완료","입력한 URL 사진을 등록했습니다.");}
  catch(e:any){Alert.alert("사진 등록 실패",e.message||"사진 URL을 등록하지 못했습니다.");}
  finally{setSaving(false);}
 };

 const setPrimaryPhoto=async(url:string)=>{
  if(!supabase||!owner||galleryUrls[0]===url)return;
  setSaving(true);
  try{
   const {error}=await supabase.rpc("owner_set_studio_primary_photo",{p_studio_id:studioId,p_image_url:url});
   if(error)throw error;
   setGalleryUrls(current=>[url,...current.filter(item=>item!==url)]);
   Alert.alert("대표 사진 변경 완료","선택한 사진이 학원 대표 사진으로 설정됐습니다.");
  }catch(e:any){Alert.alert("대표 사진 변경 실패",e.message||"대표 사진을 변경하지 못했습니다.");}
  finally{setSaving(false);}
 };

 const saveSchedule=async()=>{
  if(!supabase||!owner||!scheduleText.trim()){Alert.alert("시간표 입력","시간표 설명을 입력해 주세요.");return;}
  setSaving(true);
  try{
   const images=await pickImages(true);
   const {error}=await supabase.from("studio_public_schedules").insert({
    candidate_id:null,studio_id:studioId,schedule_text:scheduleText.trim(),
    evidence_text:null,source_title:"원장님 직접 등록",source_url:null,source_post_date:null,
    published_by:session.user.id,expires_at:dateAfterDays(180),is_active:true,image_urls:images
   });
   if(error)throw error;
   setScheduleText("");Alert.alert("시간표 등록 완료","학원 상세 페이지에 시간표가 공개됩니다.");await load();
  }catch(e:any){Alert.alert("시간표 등록 실패",e.message||"시간표를 저장하지 못했습니다.");}
  finally{setSaving(false);}
 };

 const savePrice=async()=>{
  const amount=Number(priceAmount.replace(/,/g,""));
  if(!supabase||!owner||!Number.isInteger(amount)||amount<=0||!pricePeriod.trim()){Alert.alert("가격 정보 확인","가격과 이용 기간을 정확히 입력해 주세요.");return;}
  setSaving(true);
  try{
   const images=await pickImages(true);
   const frequency=priceFrequency.trim()?Number(priceFrequency):null;
   if(frequency!==null&&(!Number.isInteger(frequency)||frequency<1||frequency>14))throw new Error("주당 횟수는 1~14회로 입력해 주세요.");
   const {error}=await supabase.from("studio_public_prices").insert({
    candidate_id:null,studio_id:studioId,amount_krw:amount,price_period:pricePeriod.trim(),
    frequency_per_week:frequency,evidence_text:null,source_title:"원장님 직접 등록",
    source_url:null,source_post_date:null,published_by:session.user.id,expires_at:dateAfterDays(180),is_active:true,image_urls:images
   });
   if(error)throw error;
   setPriceAmount("");setPriceFrequency("");Alert.alert("가격 등록 완료","학원 상세 페이지에 가격 정보가 공개됩니다.");await load();
  }catch(e:any){Alert.alert("가격 등록 실패",e.message||"가격을 저장하지 못했습니다.");}
  finally{setSaving(false);}
 };

 const saveNotice=async()=>{
  if(!supabase||!owner||!noticeTitle.trim()||!noticeBody.trim()){Alert.alert("공지사항 입력","제목과 내용을 모두 입력해 주세요.");return;}
  setSaving(true);
  try{
   const {error}=await supabase.from("studio_owner_notices").insert({studio_id:studioId,title:noticeTitle.trim(),body:noticeBody.trim(),created_by:session.user.id,is_active:true});
   if(error)throw error;
   setNoticeTitle("");setNoticeBody("");Alert.alert("공지 등록 완료","학원 상세 페이지에 공지사항이 공개됩니다.");await load();
  }catch(e:any){Alert.alert("공지 등록 실패",e.message||"공지사항을 저장하지 못했습니다.");}
  finally{setSaving(false);}
 };

 const deactivateMaterial=async(item:any)=>{
  if(!supabase)return;
  const table=item.kind==="schedule"?"studio_public_schedules":"studio_public_prices";
  const {error}=await supabase.from(table).update({is_active:false}).eq("id",item.id).eq("studio_id",studioId);
  if(error)Alert.alert("자료 삭제 실패",error.message);else await load();
 };
 const toggleNotice=async(item:any)=>{
  if(!supabase)return;
  const {error}=await supabase.from("studio_owner_notices").update({is_active:!item.is_active,updated_at:new Date().toISOString()}).eq("id",item.id).eq("studio_id",studioId);
  if(error)Alert.alert("공지 변경 실패",error.message);else await load();
 };

 const button=(label:string,onPress:()=>void,disabled=false,destructive=false)=><Pressable disabled={disabled} onPress={onPress} style={[s.button,destructive&&s.danger,disabled&&{opacity:0.5}]}><Text style={[s.buttonText,destructive&&{color:C.red}]}>{label}</Text></Pressable>;
 const field=(label:string,value:string,onChangeText:(v:string)=>void,placeholder:string="",keyboardType:any="default")=><View style={{marginTop:12}}><Text style={s.label}>{label}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} keyboardType={keyboardType} style={s.input}/></View>;

 return <SafeAreaView style={s.safe}><KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==="ios"?"padding":"height"}><ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
  <Pressable onPress={()=>router.back()}><Text style={s.back}>‹ 돌아가기</Text></Pressable>
  <Text style={s.brand}>Balletmate · 학원 관리</Text><Text style={s.title}>{studioName}</Text>
  {loading?<ActivityIndicator color={C.purple} style={{marginTop:28}}/>:!session?
   <View style={s.card}><Text style={s.body}>학원 관리 권한을 신청하거나 관리 기능을 사용하려면 먼저 로그인해 주세요.</Text>{button("로그인하기",()=>router.push("/account"))}</View>
  :owner?
   <>
    <View style={s.card}><Text style={s.cardTitle}>승인된 원장님 계정</Text><Text style={s.body}>이 학원의 정보와 공개 자료를 관리할 수 있습니다. 등록한 내용은 학원 상세 페이지에 바로 공개됩니다.</Text></View>
    <View style={s.card}><Text style={s.cardTitle}>학원 기본 정보 수정</Text>{field("학원명",profileName,setProfileName,"학원명")}{field("지역/구",profileDistrict,setProfileDistrict,"예: 서울 강남구")}{field("주소",profileAddress,setProfileAddress,"사업장 주소")}{field("전화번호",profilePhone,setProfilePhone,"연락처","phone-pad")}{field("공식 홈페이지",profileWebsite,setProfileWebsite,"https://") }<TextInput value={profileDescription} onChangeText={setProfileDescription} placeholder="학원 소개를 입력하세요." multiline style={[s.input,{height:90,textAlignVertical:"top",paddingTop:12,marginTop:10}]}/>{button("기본 정보 저장",saveProfile,saving)}</View>
    <View style={s.card}><Text style={s.cardTitle}>학원 대표 사진</Text><Text style={s.body}>현재 {galleryCount}/30장 등록 · 기본은 2장만 표시합니다. 사진을 눌러 대표 사진으로 변경할 수 있습니다.</Text>{galleryUrls.length>0&&<View style={{flexDirection:"row",flexWrap:"wrap",gap:8,marginTop:12}}>{galleryUrls.slice(0,galleryExpanded?galleryUrls.length:2).map((url,index)=><View key={url} style={{width:"31%",minWidth:88,marginBottom:6}}><Image source={{uri:url}} style={{width:"100%",aspectRatio:1,borderRadius:8,backgroundColor:"#eee"}}/><Text style={[s.body,{fontSize:11,textAlign:"center",marginTop:4}]}>{index===0?"현재 대표 사진":"사진 "+(index+1)}</Text>{index!==0&&<Pressable disabled={saving} onPress={()=>setPrimaryPhoto(url)} style={{borderWidth:1,borderColor:C.purple,borderRadius:7,paddingVertical:5,marginTop:4,alignItems:"center"}}><Text style={{color:C.purple,fontSize:11,fontWeight:"700"}}>대표로 설정</Text></Pressable>}</View>)}</View>}{galleryUrls.length>2&&<Pressable onPress={()=>setGalleryExpanded(v=>!v)} style={{paddingVertical:8,alignItems:"center"}}><Text style={{fontSize:12,fontWeight:"800",color:C.purple}}>{galleryExpanded?"사진 접기":"사진 "+(galleryUrls.length-2)+"장 더 보기"}</Text></Pressable>}<View style={{marginTop:10}}><Text style={s.label}>사진 URL 등록</Text><TextInput value={photoUrl} onChangeText={setPhotoUrl} placeholder="https://... 이미지 주소" autoCapitalize="none" keyboardType="url" style={s.input}/>{button("URL로 사진 추가",registerPhotoUrl,saving||galleryCount>=30)}</View>{button("사진 추가 · 여러 장 선택",uploadGallery,saving||galleryCount>=30)}</View>
    <View style={s.card}><Text style={s.cardTitle}>시간표 사진 및 안내</Text>{field("시간표 설명",""+scheduleText,setScheduleText,"예: 성인 초급반 월·수 19:00")}{button("시간표 사진 선택 후 등록",saveSchedule,saving)}</View>
    <View style={s.card}><Text style={s.cardTitle}>가격표 등록</Text>{field("가격",""+priceAmount,setPriceAmount,"예: 150000","numeric")}{field("이용 기간",""+pricePeriod,setPricePeriod,"예: 월 8회 / 1개월")}{field("주당 횟수 (선택)",""+priceFrequency,setPriceFrequency,"예: 2","numeric")}{button("가격표 사진 선택 후 등록",savePrice,saving)}</View>
    <View style={s.card}><Text style={s.cardTitle}>공지사항 작성</Text>{field("제목",noticeTitle,setNoticeTitle,"공지 제목") }<TextInput value={noticeBody} onChangeText={setNoticeBody} placeholder="휴강, 모집, 행사 등 공지 내용을 입력하세요." multiline style={[s.input,{height:110,textAlignVertical:"top",paddingTop:12,marginTop:10}]}/>{button("공지사항 등록",saveNotice,saving)}</View>
    <View style={s.card}><Text style={s.cardTitle}>등록한 시간표 및 가격</Text>{materials.length?materials.map(item=><View key={item.kind+"-"+item.id} style={s.item}><Text style={s.itemTitle}>{item.kind==="schedule"?"시간표":"가격표"} · {item.kind==="schedule"?item.schedule_text:"₩"+Number(item.amount_krw).toLocaleString("ko-KR")+" · "+item.price_period}</Text><Text style={s.body}>{item.is_active?"공개 중":"비공개"}</Text>{item.is_active&&button("공개 중단",()=>Alert.alert("공개 중단","이 자료를 비공개로 전환할까요?",[{text:"취소",style:"cancel"},{text:"중단",style:"destructive",onPress:()=>deactivateMaterial(item)}]),saving,true)}</View>):<Text style={s.body}>등록한 자료가 없습니다.</Text>}</View>
    <View style={s.card}><Text style={s.cardTitle}>공지사항 관리</Text>{notices.length?notices.map(item=><View key={item.id} style={s.item}><Text style={s.itemTitle}>{item.title}</Text><Text style={s.body}>{item.body}</Text>{button(item.is_active?"공지 숨기기":"공지 다시 공개",()=>toggleNotice(item),saving)}</View>):<Text style={s.body}>등록한 공지사항이 없습니다.</Text>}</View>
    <View style={s.card}><Text style={s.cardTitle}>최근 수정 이력</Text>{editHistory.length?editHistory.map(item=><View key={item.id} style={s.item}><Text style={s.itemTitle}>{item.entity==="studios"?"학원 기본 정보":item.entity==="studio_public_prices"?"가격표":item.entity==="studio_public_schedules"?"시간표":"공지사항"} · {item.action==="insert"?"등록":item.action==="delete"?"삭제":"수정"}</Text><Text style={s.body}>{new Date(item.created_at).toLocaleString("ko-KR")} · {(item.changed_fields||[]).map((field:string)=>(({name:"학원명",district:"지역",address:"주소",phone:"전화번호",website_url:"홈페이지",description:"소개",image_urls:"사진",schedule_text:"시간표",amount_krw:"가격",price_period:"가격 기간",frequency_per_week:"주당 횟수",title:"공지 제목",body:"공지 내용",is_active:"공개 상태",expires_at:"만료일"} as Record<string,string>)[field]||field)).join(", ")||"변경 내용"}</Text></View>):<Text style={s.body}>수정 이력이 없습니다.</Text>}</View>
   </>
  :application&&application.status!=="needs_info"?
   <View style={s.card}><Text style={s.cardTitle}>관리 권한 신청 상태</Text><Text style={s.status}>{application.status==="pending"?"운영자 심사 대기":application.status==="needs_info"?"추가 확인 요청":application.status==="approved"?"승인 완료":"반려"}</Text><Text style={s.body}>운영 관계 확인 후 운영자가 권한을 승인합니다.</Text>{application.review_note&&<Text style={s.body}>운영자 메모: {application.review_note}</Text>}{application.status==="rejected"&&button("다시 신청하기",()=>setApplication(null))}</View>
  :<View style={s.card}>
    <Text style={s.cardTitle}>{application?.status==="needs_info"?"추가 확인 정보 제출":"학원 관리자 권한 신청"}</Text>{application?.status==="needs_info"&&<Text style={s.body}>운영자가 확인을 요청했습니다. 다시 제출해 주세요. {application.review_note||""}</Text>}
    <Text style={s.body}>이메일 또는 소셜 로그인 계정으로 신청하고 아래 방법 중 하나로 운영 관계를 확인합니다. 사업자번호·대표자·주소·등록증은 수집하지 않습니다. 확인 후 운영자 승인을 받습니다.</Text>
    <View style={{flexDirection:"row",gap:7,marginTop:10,flexWrap:"wrap"}}>
      {([{value:"phone",label:"공개 전화 확인"},{value:"blog",label:"네이버 블로그"},{value:"instagram",label:"인스타그램"},{value:"manual",label:"운영자 직접 확인"}] as const).map(option=><Pressable key={option.value} onPress={()=>setVerificationMethod(option.value)} style={{paddingHorizontal:11,paddingVertical:9,borderRadius:10,backgroundColor:verificationMethod===option.value?C.purple:"#F2F0F6"}}><Text style={{fontSize:11,fontWeight:"800",color:verificationMethod===option.value?"#fff":C.ink}}>{option.label}</Text></Pressable>)}
    </View>
    {(verificationMethod==="blog"||verificationMethod==="instagram")&&<>
      {field(verificationMethod==="blog"?"공식 네이버 블로그 URL *":"공식 인스타그램 URL *",blogUrl,setBlogUrl,verificationMethod==="blog"?"https://blog.naver.com/아이디":"https://www.instagram.com/아이디")}
      <View style={{backgroundColor:C.pale,borderRadius:10,padding:11,marginTop:10}}><Text style={s.body}>선택한 공식 채널의 새 게시물 또는 소개란에 인증 문구를 올려 주세요. 확인 후 삭제해도 됩니다.</Text><Text style={{fontSize:15,fontWeight:"900",color:C.purple,marginTop:6}}>{blogVerificationCode||"인증 코드를 생성하세요"}</Text><Pressable onPress={()=>setBlogVerificationCode("BALLET-"+Math.random().toString(36).slice(2,8).toUpperCase())} style={{marginTop:8}}><Text style={s.buttonText}>인증 코드 생성</Text></Pressable></View>
    </>}
    {verificationMethod==="phone"&&<Text style={s.body}>학원에 공개된 전화번호로 운영자가 직접 확인합니다. 공개 번호가 없는 경우 다른 확인 방법을 선택해 주세요. {profilePhone?("현재 공개 번호: "+profilePhone):"공개 전화번호가 등록되어 있지 않습니다."}</Text>}
    {verificationMethod==="manual"&&<Text style={s.body}>운영자가 공개 연락처, 공식 채널 또는 기타 자료로 운영 관계를 확인합니다. 필요 시 신청 계정으로 추가 안내합니다.</Text>}
    {button(application?.status==="needs_info"?"확인 정보 다시 제출":"관리자 권한 신청",submitApplication,saving)}
   </View>}
 </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

const s=StyleSheet.create({
 safe:{flex:1,backgroundColor:C.bg},content:{padding:16,paddingBottom:40},back:{color:C.muted,fontWeight:"700",paddingVertical:8},
 brand:{fontSize:13,fontWeight:"900",color:C.purple,marginTop:12},title:{fontSize:23,fontWeight:"900",color:C.ink,marginTop:5,marginBottom:14},
 card:{backgroundColor:"#fff",borderRadius:16,borderWidth:1,borderColor:C.line,padding:15,marginTop:12},
 cardTitle:{fontSize:15,fontWeight:"900",color:C.ink,marginBottom:7},body:{fontSize:12,lineHeight:19,color:C.muted,marginTop:5},
 label:{fontSize:12,fontWeight:"800",color:C.ink,marginBottom:6},input:{borderWidth:1,borderColor:C.line,borderRadius:11,paddingHorizontal:12,paddingVertical:11,fontSize:13,color:C.ink,backgroundColor:"#fff"},
 button:{backgroundColor:C.pale,borderRadius:11,padding:13,alignItems:"center",marginTop:12},buttonText:{fontSize:12,fontWeight:"900",color:C.purple},
 danger:{backgroundColor:"#FFF5F5",borderWidth:1,borderColor:"#E6C5C9"},status:{fontSize:17,fontWeight:"900",color:C.purple,marginVertical:6},
 item:{borderTopWidth:1,borderTopColor:C.line,paddingTop:10,marginTop:10},itemTitle:{fontSize:13,fontWeight:"800",color:C.ink}
});

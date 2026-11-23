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
 const [businessNo,setBusinessNo]=useState("");
 const [businessName,setBusinessName]=useState(studioName);
 const [representative,setRepresentative]=useState("");
 const [businessAddress,setBusinessAddress]=useState("");
 const [documentPath,setDocumentPath]=useState("");
 const [galleryCount,setGalleryCount]=useState(0);
 const [scheduleText,setScheduleText]=useState("");
 const [priceAmount,setPriceAmount]=useState("");
 const [pricePeriod,setPricePeriod]=useState("월 수강료");
 const [priceFrequency,setPriceFrequency]=useState("");
 const [noticeTitle,setNoticeTitle]=useState("");
 const [noticeBody,setNoticeBody]=useState("");
 const [materials,setMaterials]=useState<any[]>([]);
 const [notices,setNotices]=useState<any[]>([]);

 const load=useCallback(async()=>{
  if(!supabase||!studioId){setLoading(false);return;}
  setLoading(true);
  const {data:auth}=await supabase.auth.getSession();
  const current=auth.session;
  setSession(current);
  if(!current){setOwner(false);setApplication(null);setLoading(false);return;}
  const [ownerResult,appResult,studioResult]=await Promise.all([
   supabase.from("studio_owners").select("studio_id").eq("studio_id",studioId).eq("user_id",current.user.id).maybeSingle(),
   supabase.from("studio_owner_applications").select("id,status,auto_match_status,auto_match_details,review_note,created_at,business_registration_number,business_name,representative_name,business_address,document_path").eq("studio_id",studioId).eq("user_id",current.user.id).order("created_at",{ascending:false}).limit(1).maybeSingle(),
   supabase.from("studios").select("image_urls").eq("id",studioId).maybeSingle()
  ]);
  setOwner(!!ownerResult.data);
  setApplication(appResult.data||null);
  if(appResult.data){setBusinessNo(appResult.data.business_registration_number||"");setBusinessName(appResult.data.business_name||studioName);setRepresentative(appResult.data.representative_name||"");setBusinessAddress(appResult.data.business_address||"");setDocumentPath(appResult.data.document_path||"");}
  setGalleryCount((studioResult.data?.image_urls||[]).length);
  if(ownerResult.data){
   const [scheduleResult,priceResult,noticeResult]=await Promise.all([
    supabase.from("studio_public_schedules").select("id,schedule_text,image_urls,is_active,published_at,candidate_id").eq("studio_id",studioId).is("candidate_id",null).order("published_at",{ascending:false}).limit(20),
    supabase.from("studio_public_prices").select("id,amount_krw,price_period,image_urls,is_active,published_at,candidate_id").eq("studio_id",studioId).is("candidate_id",null).order("published_at",{ascending:false}).limit(20),
    supabase.from("studio_owner_notices").select("id,title,body,is_active,created_at").eq("studio_id",studioId).order("created_at",{ascending:false}).limit(20)
   ]);
   setMaterials([...(scheduleResult.data||[]).map(x=>({...x,kind:"schedule"})),...(priceResult.data||[]).map(x=>({...x,kind:"price"}))]);
   setNotices(noticeResult.data||[]);
  }
  setLoading(false);
 },[studioId]);

 useEffect(()=>{load();if(!supabase)return;const {data:{subscription}}=supabase.auth.onAuthStateChange(()=>load());return()=>subscription.unsubscribe();},[load]);

 const chooseCertificate=async()=>{
  const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:["images"],quality:0.9});
  if(result.canceled||!result.assets?.[0]||!supabase||!session)return;
  setSaving(true);
  try{
   const asset=result.assets[0];
   const optimized=await ImageManipulator.manipulateAsync(asset.uri,[{resize:{width:1800}}],{compress:0.88,format:ImageManipulator.SaveFormat.JPEG});
   const bytes=await (await fetch(optimized.uri)).arrayBuffer();
   const path=session.user.id+"/"+studioId+"/"+Date.now()+"-business-registration.jpg";
   const {error}=await supabase.storage.from("studio-business-documents").upload(path,bytes,{contentType:"image/jpeg",upsert:true});
   if(error)throw error;
   setDocumentPath(path);
   Alert.alert("서류 업로드 완료","사업자등록증 사진을 안전한 비공개 저장소에 올렸습니다.");
  }catch(e:any){Alert.alert("업로드 실패",e.message||"사업자등록증을 업로드하지 못했습니다.");}
  finally{setSaving(false);}
 };

 const submitApplication=async()=>{
  if(!supabase||!session)return;
  if(!/^\d{3}-?\d{2}-?\d{5}$/.test(businessNo.replace(/\s/g,""))||!businessName.trim()||!representative.trim()||!businessAddress.trim()||!documentPath){
   Alert.alert("신청 정보 확인","사업자등록번호, 상호, 대표자, 사업장 주소와 사업자등록증 사진을 모두 입력해 주세요.");return;
  }
  setSaving(true);
  try{
   const {data,error}=await supabase.rpc("submit_studio_owner_application",{
    p_studio_id:studioId,p_business_registration_number:businessNo,
    p_business_name:businessName.trim(),p_representative_name:representative.trim(),
    p_business_address:businessAddress.trim(),p_document_path:documentPath
   });
   if(error)throw error;
   Alert.alert("관리 권한 신청 완료","사업자 정보 자동 대조를 마쳤습니다. 최종 권한은 운영자 서류 심사 후 활성화됩니다.");
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
   Alert.alert("사진 등록 완료",urls.length+"장을 학원 대표 사진으로 등록했습니다.");
  }catch(e:any){Alert.alert("사진 등록 실패",e.message||"사진을 등록하지 못했습니다.");}
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

 return <SafeAreaView style={s.safe}><KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==="ios"?"padding":undefined}><ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
  <Pressable onPress={()=>router.back()}><Text style={s.back}>‹ 돌아가기</Text></Pressable>
  <Text style={s.brand}>Balletmate · 학원 관리</Text><Text style={s.title}>{studioName}</Text>
  {loading?<ActivityIndicator color={C.purple} style={{marginTop:28}}/>:!session?
   <View style={s.card}><Text style={s.body}>학원 관리 권한을 신청하거나 관리 기능을 사용하려면 먼저 로그인해 주세요.</Text>{button("로그인하기",()=>router.push("/account"))}</View>
  :owner?
   <>
    <View style={s.card}><Text style={s.cardTitle}>승인된 원장님 계정</Text><Text style={s.body}>이 학원의 정보와 공개 자료를 관리할 수 있습니다. 등록한 내용은 학원 상세 페이지에 바로 공개됩니다.</Text></View>
    <View style={s.card}><Text style={s.cardTitle}>학원 대표 사진</Text><Text style={s.body}>현재 {galleryCount}/30장 등록</Text>{button("사진 업로드",uploadGallery,saving||galleryCount>=30)}</View>
    <View style={s.card}><Text style={s.cardTitle}>시간표 사진 및 안내</Text>{field("시간표 설명",""+scheduleText,setScheduleText,"예: 성인 초급반 월·수 19:00")}{button("시간표 사진 선택 후 등록",saveSchedule,saving)}</View>
    <View style={s.card}><Text style={s.cardTitle}>가격표 등록</Text>{field("가격",""+priceAmount,setPriceAmount,"예: 150000","numeric")}{field("이용 기간",""+pricePeriod,setPricePeriod,"예: 월 8회 / 1개월")}{field("주당 횟수 (선택)",""+priceFrequency,setPriceFrequency,"예: 2","numeric")}{button("가격표 사진 선택 후 등록",savePrice,saving)}</View>
    <View style={s.card}><Text style={s.cardTitle}>공지사항 작성</Text>{field("제목",noticeTitle,setNoticeTitle,"공지 제목") }<TextInput value={noticeBody} onChangeText={setNoticeBody} placeholder="휴강, 모집, 행사 등 공지 내용을 입력하세요." multiline style={[s.input,{height:110,textAlignVertical:"top",paddingTop:12,marginTop:10}]}/>{button("공지사항 등록",saveNotice,saving)}</View>
    <View style={s.card}><Text style={s.cardTitle}>등록한 시간표 및 가격</Text>{materials.length?materials.map(item=><View key={item.kind+"-"+item.id} style={s.item}><Text style={s.itemTitle}>{item.kind==="schedule"?"시간표":"가격표"} · {item.kind==="schedule"?item.schedule_text:"₩"+Number(item.amount_krw).toLocaleString("ko-KR")+" · "+item.price_period}</Text><Text style={s.body}>{item.is_active?"공개 중":"비공개"}</Text>{item.is_active&&button("공개 중단",()=>Alert.alert("공개 중단","이 자료를 비공개로 전환할까요?",[{text:"취소",style:"cancel"},{text:"중단",style:"destructive",onPress:()=>deactivateMaterial(item)}]),saving,true)}</View>):<Text style={s.body}>등록한 자료가 없습니다.</Text>}</View>
    <View style={s.card}><Text style={s.cardTitle}>공지사항 관리</Text>{notices.length?notices.map(item=><View key={item.id} style={s.item}><Text style={s.itemTitle}>{item.title}</Text><Text style={s.body}>{item.body}</Text>{button(item.is_active?"공지 숨기기":"공지 다시 공개",()=>toggleNotice(item),saving)}</View>):<Text style={s.body}>등록한 공지사항이 없습니다.</Text>}</View>
   </>
  :application&&application.status!=="needs_info"?
   <View style={s.card}><Text style={s.cardTitle}>관리 권한 신청 상태</Text><Text style={s.status}>{application.status==="pending"?"운영자 심사 대기":application.status==="needs_info"?"추가 서류 확인 필요":application.status==="approved"?"승인 완료":"반려"}</Text><Text style={s.body}>자동 대조 결과: {application.auto_match_status==="match"?"학원명·주소 일치":"운영자 확인 필요"}</Text>{application.review_note&&<Text style={s.body}>운영자 메모: {application.review_note}</Text>}{application.status==="rejected"&&button("다시 신청하기",()=>setApplication(null))}</View>
  :<View style={s.card}>
    <Text style={s.cardTitle}>{application?.status==="needs_info"?"추가 정보 제출":"학원 관리자 권한 신청"}</Text>{application?.status==="needs_info"&&<Text style={s.body}>운영자가 추가 확인을 요청했습니다. 보완한 정보와 서류를 다시 제출해 주세요. {application.review_note||""}</Text>}<Text style={s.body}>사업자등록증을 제출하면 입력한 상호·주소와 학원 등록 정보를 자동 대조하고, 사업자번호 중복 여부를 확인합니다. 자동 대조는 참고 결과이며, 서류 원본과 실제 운영 관계는 운영자가 최종 심사합니다.</Text>
    {field("사업자등록번호 *",businessNo,setBusinessNo,"000-00-00000","number-pad")}
    {field("사업자등록증 상호 *",businessName,setBusinessName,"등록증에 표시된 상호")}
    {field("대표자명 *",representative,setRepresentative,"대표자 성명")}
    {field("사업장 주소 *",businessAddress,setBusinessAddress,"사업자등록증에 표시된 주소")}
    {button(documentPath?"사업자등록증 업로드 완료 · 다시 선택":"사업자등록증 사진 업로드 *",chooseCertificate,saving)}
    {!!documentPath&&<Text style={s.body}>비공개 저장소에 업로드됨 · {documentPath.split("/").pop()}</Text>}
    {button(application?.status==="needs_info"?"보완 정보 다시 제출":"운영자 심사 신청",submitApplication,saving||!documentPath)}
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

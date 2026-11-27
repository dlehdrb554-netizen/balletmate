import React, {useCallback, useEffect, useState, useMemo, useRef} from "react";
import {themeStyles } from "../lib/theme";
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as XLSX from "xlsx";
import { invalidateStudioPublicMaterials } from "../lib/studio-public-materials";
import { searchStudiosByName } from "../lib/studios";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../lib/supabase";
import { invalidateClassesForStudio } from "../lib/classes";

const C={ink:"#252238",muted:"#625E70",purple:"#653BB7",pale:"#F2ECFF",line:"#E9E2F2",bg:"#FBF9FF",red:"#A33342"};
const dateAfterDays=(days:number)=>{const d=new Date();d.setDate(d.getDate()+days);return d.toISOString().slice(0,10);};

export default function StudioManager(){
 const isDark=useColorScheme()==="dark";
 const s=useMemo(()=>createS(isDark),[isDark]);
 const router=useRouter();
 const params=useLocalSearchParams<{studioId?:string;studioName?:string}>();
 const studioId=String(params.studioId||"");
 const studioName=String(params.studioName||"선택한 학원");
 const managerScrollRef=useRef<ScrollView|null>(null);
 const sectionOffsets=useRef<Record<string,number>>({});
 const tabScrollOffsets=useRef<Record<string,number>>({});
 const [activeTab,setActiveTab]=useState<"profile"|"photos"|"classes"|"notices">("profile");
 const [noticeEditorOpen,setNoticeEditorOpen]=useState(false);
 const [editingNotice,setEditingNotice]=useState<any|null>(null);
 const openNoticeEditor=(item:any|null=null)=>{setEditingNotice(item);setNoticeTitle(item?.title||"");setNoticeBody(item?.body||"");setNoticeEditorOpen(true);};
 const [session,setSession]=useState<any>(null);
 const [loading,setLoading]=useState(true);
 const [saving,setSaving]=useState(false);

 const [studioSearch,setStudioSearch]=useState("");
 const [studioSearchResults,setStudioSearchResults]=useState<any[]>([]);
 const [studioSearchBusy,setStudioSearchBusy]=useState(false);
 const [owner,setOwner]=useState(false);
 const [ownedStudios,setOwnedStudios]=useState<any[]>([]);
 const [application,setApplication]=useState<any>(null);
 const [verificationMethod,setVerificationMethod]=useState<"phone"|"blog"|"instagram"|"manual">("phone");
 const [blogUrl,setBlogUrl]=useState("");
 const [blogVerificationCode,setBlogVerificationCode]=useState("");
 const [profileName,setProfileName]=useState(studioName);
 const [profileDistrict,setProfileDistrict]=useState("");
 const [profileAddress,setProfileAddress]=useState("");
 const [profilePhone,setProfilePhone]=useState("");
 const [profileWebsite,setProfileWebsite]=useState("");
 const [profileDescription,setProfileDescription]=useState("");
 const [scheduleImage,setScheduleImage]=useState<ImagePicker.ImagePickerAsset|null>(null);
 const [priceImage,setPriceImage]=useState<ImagePicker.ImagePickerAsset|null>(null);
 const [representativeImagePath,setRepresentativeImagePath]=useState<string|null>(null);
 const [galleryImages,setGalleryImages]=useState<any[]>([]);
 const [galleryImagesToUpload,setGalleryImagesToUpload]=useState<ImagePicker.ImagePickerAsset[]>([]);
 const [noticeTitle,setNoticeTitle]=useState("");
 const [noticeBody,setNoticeBody]=useState("");
 const [materials,setMaterials]=useState<any[]>([]);
 const [notices,setNotices]=useState<any[]>([]);
 const [editHistory,setEditHistory]=useState<any[]>([]);
 const [reviewCode,setReviewCode]=useState("");
 const [reviewCodeBusy,setReviewCodeBusy]=useState(false);
 const [ownerClasses,setOwnerClasses]=useState<any[]>([]);
 const [ownerCoupons,setOwnerCoupons]=useState<any[]>([]);
 const [classTitle,setClassTitle]=useState("");
 const [classAudience,setClassAudience]=useState<"adult"|"kids"|"all">("adult");
 const [classLevel,setClassLevel]=useState("");
 const [classType,setClassType]=useState("");
 const [classDuration,setClassDuration]=useState("60");
 const [classImportRows,setClassImportRows]=useState<any[]>([]);
 const [classImportErrors,setClassImportErrors]=useState<string[]>([]);
 const [classImportOpen,setClassImportOpen]=useState(false);
 const [classImportBusy,setClassImportBusy]=useState(false);
 const [selectedClassIds,setSelectedClassIds]=useState<string[]>([]);
 const [classSelectionMode,setClassSelectionMode]=useState(false);
 const [couponTitle,setCouponTitle]=useState("");
 const [couponDiscount,setCouponDiscount]=useState("");
 const [couponDescription,setCouponDescription]=useState("");
 const activeGalleryCount=galleryImages.filter(x=>x.is_active).length;

 const load=useCallback(async()=>{
  if(!supabase){setLoading(false);return;}
  setLoading(true);
  const {data:auth}=await supabase.auth.getSession();
  const current=auth.session;
  setSession(current);
  if(!current){setOwner(false);setApplication(null);setOwnedStudios([]);setLoading(false);return;}
  if(!studioId){
   const {data:ownerRows,error:ownerListError}=await supabase.from("studio_owners").select("studio_id").eq("user_id",current.user.id);
   if(ownerListError){setOwnedStudios([]);Alert.alert("관리 학원 조회 실패",ownerListError.message);}
   else if(ownerRows?.length){
    const ids=ownerRows.map((row:any)=>row.studio_id);
    const {data:studios,error:studioListError}=await supabase.from("studios").select("id,name,district,address").in("id",ids);
    if(studioListError){setOwnedStudios([]);Alert.alert("학원 정보 조회 실패",studioListError.message);}
    else setOwnedStudios(studios||[]);
   }else setOwnedStudios([]);
   setLoading(false);return;
  }
  const [ownerResult,appResult,studioResult]=await Promise.all([
   supabase.from("studio_owners").select("studio_id").eq("studio_id",studioId).eq("user_id",current.user.id).maybeSingle(),
   supabase.from("studio_owner_applications").select("id,status,auto_match_status,auto_match_details,review_note,created_at,verification_url,verification_code,verification_method").eq("studio_id",studioId).eq("user_id",current.user.id).order("created_at",{ascending:false}).limit(1).maybeSingle(),
   supabase.from("studios").select("name,district,address,phone,website_url,description,representative_image_path").eq("id",studioId).maybeSingle()
  ]);
  setOwner(!!ownerResult.data);
  setApplication(appResult.data||null);
  if(appResult.data){setBlogUrl(appResult.data.verification_url||"");setBlogVerificationCode(appResult.data.verification_code||"");setVerificationMethod(appResult.data.verification_method||"phone");}
  if(studioResult.data){setProfileName(studioResult.data.name||studioName);setProfileDistrict(studioResult.data.district||"");setProfileAddress(studioResult.data.address||"");setProfilePhone(studioResult.data.phone||"");setProfileWebsite(studioResult.data.website_url||"");setProfileDescription(studioResult.data.description||"");setRepresentativeImagePath(studioResult.data.representative_image_path||null);}
  if(ownerResult.data){
   const [scheduleResult,priceResult,noticeResult,historyResult,classResult,couponResult,galleryResult]=await Promise.all([
    supabase.from("studio_public_schedules").select("id,schedule_text,image_path,is_active,published_at").eq("studio_id",studioId).not("image_path","is",null).order("published_at",{ascending:false}).limit(20),
    supabase.from("studio_public_prices").select("id,amount_krw,price_period,image_path,is_active,published_at").eq("studio_id",studioId).not("image_path","is",null).order("published_at",{ascending:false}).limit(20),
    supabase.from("studio_owner_notices").select("id,title,body,is_active,created_at").eq("studio_id",studioId).order("created_at",{ascending:false}).limit(20),
    supabase.from("studio_owner_edit_history").select("id,entity,action,changed_fields,created_at").eq("studio_id",studioId).order("created_at",{ascending:false}).limit(20)
    ,supabase.from("classes").select("id,title,audience,level,class_type,duration_minutes,is_active").eq("studio_id",studioId).order("created_at",{ascending:false}).limit(50)
    ,supabase.from("coupons").select("id,title,description,discount_text,is_active,starts_at,ends_at").eq("studio_id",studioId).order("created_at",{ascending:false}).limit(30),
    supabase.from("studio_gallery_images").select("id,image_path,is_active,created_at").eq("studio_id",studioId).order("created_at",{ascending:false}).limit(60)
   ]);
   setMaterials([...(scheduleResult.data||[]).map(x=>({...x,kind:"schedule"})),...(priceResult.data||[]).map(x=>({...x,kind:"price"}))]);
   setNotices(noticeResult.data||[]);setEditHistory(historyResult.error?[]:(historyResult.data||[]));
   setOwnerClasses(classResult.data||[]);setOwnerCoupons(couponResult.data||[]);setGalleryImages(galleryResult.error?[]:(galleryResult.data||[]));
  }
  setLoading(false);
 },[studioId]);

 useEffect(()=>{void load();if(!supabase)return;const {data:{subscription}}=supabase.auth.onAuthStateChange(()=>{setTimeout(()=>{void load();},0);});return()=>subscription.unsubscribe();},[load]);
 useEffect(()=>{if(!studioId&&ownedStudios.length===1&&!loading){const studio=ownedStudios[0];router.replace({pathname:"/studio-manager",params:{studioId:studio.id,studioName:studio.name}});}},[studioId,ownedStudios,loading,router]);
 useEffect(()=>{if(!session||owner)return;const timer=setInterval(()=>{void load();},15000);return()=>clearInterval(timer);},[session,owner,load]);

 const searchStudiosForApplication=async()=>{
  const query=studioSearch.trim();
  if(!supabase||query.length<2){Alert.alert("학원 검색","학원명을 2자 이상 입력해 주세요.");return;}
  setStudioSearchBusy(true);
  try{
   const rows=await searchStudiosByName(query);
   setStudioSearchResults(rows);
   if(!rows.length)Alert.alert("검색 결과","일치하는 학원을 찾지 못했습니다. 학원명을 다시 확인해 주세요.");
  }catch(error:any){Alert.alert("학원 검색 실패",error?.message||"학원 목록을 불러오지 못했습니다.");}
  finally{setStudioSearchBusy(false);}
 };

 const saveProfile=async()=>{
  if(!supabase||!owner)return;
  if(profileWebsite.trim()&&!/^https:\/\//i.test(profileWebsite.trim())){Alert.alert("대표 홈페이지 주소","HTTPS 주소를 입력해 주세요.");return;}
  try{const host=new URL(profileWebsite.trim()).hostname.toLowerCase().replace("www.","");if(["neis.go.kr","schoolinfo.go.kr","place.map.kakao.com","kakao.com"].some(domain=>host===domain||host.endsWith("."+domain))){Alert.alert("대표 홈페이지 주소","일반 홈페이지, 네이버 블로그 또는 인스타그램 주소만 등록할 수 있습니다. NEIS·카카오 장소 주소는 사용할 수 없습니다.");return;}}catch{if(profileWebsite.trim()){Alert.alert("대표 홈페이지 주소","올바른 HTTPS URL을 입력해 주세요.");return;}}
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
 const issueReviewCode=async()=>{
  if(!supabase||!owner||reviewCodeBusy)return;
  setReviewCodeBusy(true);
  try{
   const {data,error}=await supabase.rpc("owner_issue_studio_review_code",{p_studio_id:studioId});
   if(error)throw error;
   setReviewCode(String(data||""));
   Alert.alert("수강 인증 코드 발급",String(data||"")+"\n\n실제 수강을 마친 회원에게 전달해 주세요. 72시간 후 만료되며 한 번만 사용할 수 있습니다.");
  }catch(error:any){Alert.alert("코드 발급 실패",error?.message||"수강 인증 코드를 발급하지 못했습니다.");}
  finally{setReviewCodeBusy(false);}
 };
 const downloadClassTemplate=async()=>{
  try{
   const workbook=XLSX.utils.book_new();
   const sheet=XLSX.utils.aoa_to_sheet([
    ["수업명","대상(성인/키즈/전체)","수준","유형","수업시간(분)"],
    ["성인 기초 발레","성인","입문","기초",60],
    ["키즈 발레 A반","키즈","초급","기초",50],
    ["발레핏 전체반","전체","중급","발레핏",60]
   ]);
   sheet["!cols"]=[{wch:24},{wch:24},{wch:16},{wch:18},{wch:18}];
   XLSX.utils.book_append_sheet(workbook,sheet,"수업 등록 양식");
   const base64=XLSX.write(workbook,{bookType:"xlsx",type:"base64"});
   const uri=FileSystem.cacheDirectory+"balletmate_class_template.xlsx";
   await FileSystem.writeAsStringAsync(uri,base64,{encoding:FileSystem.EncodingType.Base64});
   if(await Sharing.isAvailableAsync())await Sharing.shareAsync(uri,{mimeType:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",dialogTitle:"수업 등록 엑셀 양식"});
   else Alert.alert("양식 생성 완료","기기에서 파일 공유 기능을 사용할 수 없습니다.");
  }catch(error:any){Alert.alert("양식 생성 실패",error?.message||"엑셀 양식을 만들지 못했습니다.");}
 };
 const importClassesFromSpreadsheet=async()=>{
  if(!owner||!supabase)return;
  try{
   const picked=await DocumentPicker.getDocumentAsync({type:["application/vnd.openxmlformats-officedocument.spreadsheetml.sheet","application/vnd.ms-excel","text/csv"],copyToCacheDirectory:true,multiple:false});
   if(picked.canceled||!picked.assets?.[0])return;
   const asset=picked.assets[0];
   const base64=await FileSystem.readAsStringAsync(asset.uri,{encoding:FileSystem.EncodingType.Base64});
   const workbook=XLSX.read(base64,{type:"base64"});
   const sheet=workbook.Sheets[workbook.SheetNames[0]];
   if(!sheet)throw new Error("첫 번째 시트를 찾을 수 없습니다.");
   const rawRows=XLSX.utils.sheet_to_json<Record<string,unknown>>(sheet,{defval:"",raw:false});
   if(!rawRows.length)throw new Error("엑셀에 등록할 수업 데이터가 없습니다.");
   const normalize=(value:string)=>value.toLowerCase().replace(/[\s_()·\[\]]/g,"");
   const find=(row:Record<string,unknown>,aliases:string[])=>{
    const key=Object.keys(row).find(k=>aliases.includes(normalize(k)));
    return key===undefined?"":String(row[key]??"").trim();
   };
   const seen=new Set<string>();
   const errors:string[]=[];
   const parsed:any[]=[];
   rawRows.forEach((row,index)=>{
    const line=index+2;
    const title=find(row,["수업명","수업이름","클래스명","title","classname","class"]);
    const audienceText=find(row,["대상","수업대상","연령","audience"]);
    const level=find(row,["수준","레벨","난이도","level"]);
    const type=find(row,["유형","수업유형","종류","classtype","type"]);
    const durationText=find(row,["수업시간분","수업시간","시간분","duration","durationminutes","분"]);
    if(!title){errors.push(line+"행: 수업명이 비어 있어 제외했습니다.");return;}
    let audience:"adult"|"kids"|"all"="all";
    if(/성인|adult|어른/i.test(audienceText))audience="adult";
    else if(/키즈|아동|어린이|유아|kids|child/i.test(audienceText))audience="kids";
    else if(audienceText&&!/전체|모두|all/i.test(audienceText)){errors.push(line+"행: 대상 값은 성인·키즈·전체 중 하나여야 합니다.");return;}
    const duration=durationText?Number(durationText.replace(/[^0-9.]/g,"")):60;
    if(!Number.isInteger(duration)||duration<10||duration>240){errors.push(line+"행: 수업 시간은 10~240분으로 입력해 주세요.");return;}
    const key=title.toLocaleLowerCase();
    if(seen.has(key)){errors.push(line+"행: 파일 안에 같은 수업명이 있어 중복 제외했습니다.");return;}
    seen.add(key);
    parsed.push({title:title.slice(0,100),audience,level:level||null,class_type:type||null,duration_minutes:duration,is_active:true});
   });
   if(!parsed.length)throw new Error("등록 가능한 수업이 없습니다. 수업명과 수업 시간 열을 확인해 주세요.");
   const {data:existing,error}=await supabase.from("classes").select("title").eq("studio_id",studioId);
   if(error)throw error;
   const existingTitles=new Set((existing||[]).map((x:any)=>String(x.title||"").trim().toLocaleLowerCase()));
   const unique=parsed.filter(row=>{const key=row.title.toLocaleLowerCase();if(existingTitles.has(key)){errors.push("기존 등록 수업과 중복되어 제외: "+row.title);return false;}return true;});
   setClassImportRows(unique);setClassImportErrors(errors);
   if(!unique.length)throw new Error("새로 등록할 수업이 없습니다. 기존 수업과 중복 여부를 확인해 주세요.");
   setClassImportOpen(true);
  }catch(error:any){Alert.alert("엑셀 읽기 실패",error?.message||"파일 형식이나 양식의 열 이름을 확인해 주세요.");}
 };
 const confirmImportClasses=async()=>{
  if(!supabase||!owner||!classImportRows.length||classImportBusy)return;
  setClassImportBusy(true);
  try{
   const payload=classImportRows.map(row=>({studio_id:studioId,...row}));
   const {error}=await supabase.from("classes").insert(payload);
   if(error)throw error;
   invalidateClassesForStudio(studioId);
   const count=payload.length;
   setClassImportOpen(false);setClassImportRows([]);setClassImportErrors([]);
   Alert.alert("일괄 등록 완료",count+"개 수업을 등록했습니다.");
   await load();
  }catch(error:any){Alert.alert("일괄 등록 실패",error?.message||"수업을 등록하지 못했습니다. 기존 수업은 유지됩니다.");}
  finally{setClassImportBusy(false);}
 };
 const toggleClassSelection=(id:string)=>{
  setSelectedClassIds(current=>current.includes(id)?current.filter(x=>x!==id):[...current,id]);
 };
 const deleteSelectedClasses=async()=>{
  if(!supabase||!owner||!selectedClassIds.length||saving)return;
  setSaving(true);
  try{
   const {error}=await supabase.from("classes").delete().eq("studio_id",studioId).in("id",selectedClassIds);
   if(error)throw error;
   const count=selectedClassIds.length;
   setSelectedClassIds([]);setClassSelectionMode(false);invalidateClassesForStudio(studioId);
   Alert.alert("선택 삭제 완료",count+"개 수업을 삭제했습니다.");
   await load();
  }catch(error:any){Alert.alert("일괄 삭제 실패",error?.message||"선택한 수업을 삭제하지 못했습니다.");}
  finally{setSaving(false);}
 };
 const saveClass=async()=>{
  if(!supabase||!owner||classTitle.trim().length<2){Alert.alert("수업 정보","수업명은 2자 이상 입력해 주세요.");return;}
  const duration=Number(classDuration);
  if(!Number.isInteger(duration)||duration<10||duration>240){Alert.alert("수업 시간","수업 시간은 10~240분으로 입력해 주세요.");return;}
  setSaving(true);
  try{
   const {error}=await supabase.from("classes").insert({studio_id:studioId,title:classTitle.trim(),audience:classAudience,level:classLevel.trim()||null,class_type:classType.trim()||null,duration_minutes:duration,is_active:true});
   if(error)throw error;
   invalidateClassesForStudio(studioId);
   setClassTitle("");setClassLevel("");setClassType("");setClassDuration("60");
   Alert.alert("수업 등록 완료","학원 수업 목록에 반영됩니다.");await load();
  }catch(error:any){Alert.alert("수업 등록 실패",error?.message||"수업을 저장하지 못했습니다.");}
  finally{setSaving(false);}
 };
 const deleteOwnerClass=async(item:any)=>{
  if(!supabase||!owner)return;
  setSaving(true);
  try{
   const {error}=await supabase.from("classes").delete().eq("id",item.id).eq("studio_id",studioId);
   if(error)throw error;
   invalidateClassesForStudio(studioId);
   Alert.alert("수업 삭제 완료","수업 정보를 삭제했습니다.");
   await load();
  }catch(error:any){Alert.alert("수업 삭제 실패",error?.message||"수업을 삭제하지 못했습니다.");}
  finally{setSaving(false);}
 };
 const toggleOwnerClass=async(item:any)=>{
  if(!supabase)return;
  const {error}=await supabase.from("classes").update({is_active:!item.is_active}).eq("id",item.id).eq("studio_id",studioId);
  if(error)Alert.alert("수업 변경 실패",error.message);else{invalidateClassesForStudio(studioId);await load();}
 };
 const saveCoupon=async()=>{
  if(!supabase||!owner||couponTitle.trim().length<2||!couponDiscount.trim()){Alert.alert("혜택 정보","혜택명과 할인 내용을 입력해 주세요.");return;}
  setSaving(true);
  try{
   const {error}=await supabase.from("coupons").insert({studio_id:studioId,title:couponTitle.trim(),description:couponDescription.trim()||null,discount_text:couponDiscount.trim(),starts_at:new Date().toISOString(),is_active:true});
   if(error)throw error;
   setCouponTitle("");setCouponDiscount("");setCouponDescription("");
   Alert.alert("혜택 등록 완료","학원 혜택 목록에 반영됩니다.");await load();
  }catch(error:any){Alert.alert("혜택 등록 실패",error?.message||"혜택을 저장하지 못했습니다.");}
  finally{setSaving(false);}
 };
 const toggleOwnerCoupon=async(item:any)=>{
  if(!supabase)return;
  const {error}=await supabase.from("coupons").update({is_active:!item.is_active}).eq("id",item.id).eq("studio_id",studioId);
  if(error)Alert.alert("혜택 변경 실패",error.message);else await load();
 };
 const pickRepresentativeImage=async()=>{
  if(!supabase||!owner)return;
  const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:["images"],allowsMultipleSelection:false,quality:0.9});
  if(result.canceled||!result.assets[0])return;
  setSaving(true);let uploadedPath:string|null=null;
  try{
   const optimized=await ImageManipulator.manipulateAsync(result.assets[0].uri,[{resize:{width:1600}}],{compress:0.86,format:ImageManipulator.SaveFormat.JPEG});
   const response=await fetch(optimized.uri);
   if(!response.ok)throw new Error("대표 이미지 파일을 읽지 못했습니다.");
   const bytes=await response.arrayBuffer();
   uploadedPath=`${studioId}/representative/${Date.now()}-${Math.random().toString(36).slice(2,8)}.jpg`;
   const {error:uploadError}=await supabase.storage.from("studio-representative-images").upload(uploadedPath,bytes,{contentType:"image/jpeg",upsert:false});
   if(uploadError)throw uploadError;
   const {error}=await supabase.rpc("owner_update_studio_representative_image",{p_studio_id:studioId,p_image_path:uploadedPath});
   if(error)throw error;
   const previous=representativeImagePath;
   setRepresentativeImagePath(uploadedPath);
   if(previous)await supabase.storage.from("studio-representative-images").remove([previous]);
   Alert.alert("대표 사진 변경 완료","새 대표 사진이 학원 상세 페이지에 반영됩니다.");
  }catch(error:any){
   if(uploadedPath)await supabase.storage.from("studio-representative-images").remove([uploadedPath]);
   Alert.alert("대표 사진 변경 실패",error?.message||"대표 사진을 변경하지 못했습니다.");
  }finally{setSaving(false);}
 };
 const pickStudioPhotos=async()=>{
  const remaining=Math.max(0,10-activeGalleryCount);
  if(!remaining){Alert.alert("사진 등록 한도","갤러리 사진은 최대 10장까지 등록할 수 있습니다.");return;}
  const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:["images"],allowsMultipleSelection:true,selectionLimit:remaining,quality:0.9});
  if(!result.canceled&&result.assets.length)setGalleryImagesToUpload(result.assets.slice(0,remaining));
 };
 const saveStudioPhotos=async()=>{
  if(!supabase||!owner||!session?.user?.id||!galleryImagesToUpload.length){Alert.alert("학원 사진","등록할 사진을 선택해 주세요.");return;}
  if(activeGalleryCount+galleryImagesToUpload.length>10){Alert.alert("사진 등록 한도","갤러리 사진은 최대 10장까지 등록할 수 있습니다.");return;}
  setSaving(true);
  const uploadedGalleryPaths:string[]=[];
  let representativePath:string|null=null;
  try{
   for(let index=0;index<galleryImagesToUpload.length;index++){
    const asset=galleryImagesToUpload[index];
    const optimized=await ImageManipulator.manipulateAsync(asset.uri,[{resize:{width:1800}}],{compress:0.86,format:ImageManipulator.SaveFormat.JPEG});
    const response=await fetch(optimized.uri);
    if(!response.ok)throw new Error("이미지를 읽지 못했습니다.");
    const bytes=await response.arrayBuffer();
    const path=`${studioId}/gallery/${Date.now()}-${index}-${Math.random().toString(36).slice(2,9)}.jpg`;
    const {error:uploadError}=await supabase.storage.from("studio-public-materials").upload(path,bytes,{contentType:"image/jpeg",upsert:false});
    if(uploadError)throw uploadError;
    uploadedGalleryPaths.push(path);
   }
   const {error:galleryError}=await supabase.from("studio_gallery_images").insert(uploadedGalleryPaths.map(image_path=>({studio_id:studioId,image_path,created_by:session.user.id,is_active:true})));
   if(galleryError)throw galleryError;
   if(uploadedGalleryPaths.length){
    const first=galleryImagesToUpload[0];
    const optimized=await ImageManipulator.manipulateAsync(first.uri,[{resize:{width:1600}}],{compress:0.86,format:ImageManipulator.SaveFormat.JPEG});
    const response=await fetch(optimized.uri);
    if(!response.ok)throw new Error("대표 이미지 파일을 읽지 못했습니다.");
    const bytes=await response.arrayBuffer();
    representativePath=`${studioId}/representative/${Date.now()}-${Math.random().toString(36).slice(2,8)}.jpg`;
    const {error:representativeUploadError}=await supabase.storage.from("studio-representative-images").upload(representativePath,bytes,{contentType:"image/jpeg",upsert:false});
    if(representativeUploadError)throw representativeUploadError;
    const {error:representativeError}=await supabase.rpc("owner_update_studio_representative_image",{p_studio_id:studioId,p_image_path:representativePath});
    if(representativeError)throw representativeError;
    if(representativeImagePath)await supabase.storage.from("studio-representative-images").remove([representativeImagePath]);
    setRepresentativeImagePath(representativePath);
   }
   setGalleryImagesToUpload([]);
   Alert.alert("사진 등록 완료",uploadedGalleryPaths.length+"장의 사진을 등록했습니다. 첫 번째 사진은 대표 이미지로도 설정했습니다.");
   await load();
  }catch(error:any){
   if(uploadedGalleryPaths.length){await supabase.from("studio_gallery_images").delete().eq("studio_id",studioId).in("image_path",uploadedGalleryPaths);await supabase.storage.from("studio-public-materials").remove(uploadedGalleryPaths);}
   if(representativePath)await supabase.storage.from("studio-representative-images").remove([representativePath]);
   Alert.alert("사진 등록 실패",error?.message||"사진을 등록하지 못했습니다.");
  }finally{setSaving(false);}
 };
 const deactivateGalleryImage=async(item:any)=>{
  if(!supabase||!owner)return;
  setSaving(true);
  try{
   const {error}=await supabase.from("studio_gallery_images").delete().eq("id",item.id).eq("studio_id",studioId);
   if(error)throw error;
   const {error:storageError}=await supabase.storage.from("studio-public-materials").remove([item.image_path]);
   if(storageError)console.warn("Gallery image storage cleanup failed:",storageError.message);
   Alert.alert("사진 삭제 완료","학원 사진에서 삭제했습니다.");
   await load();
  }catch(error:any){Alert.alert("사진 삭제 실패",error?.message||"사진을 삭제하지 못했습니다.");}
  finally{setSaving(false);}
 };
 const pickMaterialImage=async(kind:"schedule"|"price")=>{
  const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:["images"],allowsMultipleSelection:false,quality:0.9});
  if(result.canceled||!result.assets[0])return;
  if(kind==="schedule")setScheduleImage(result.assets[0]);else setPriceImage(result.assets[0]);
 };
 const uploadMaterialImage=async(asset:ImagePicker.ImagePickerAsset,kind:"schedule"|"price")=>{
  if(!supabase||!session?.user?.id)throw new Error("로그인이 필요합니다.");
  const optimized=await ImageManipulator.manipulateAsync(asset.uri,[{resize:{width:1800}}],{compress:0.86,format:ImageManipulator.SaveFormat.JPEG});
  const response=await fetch(optimized.uri);
  if(!response.ok)throw new Error("이미지 파일을 읽지 못했습니다.");
  const bytes=await response.arrayBuffer();
  const path=`${studioId}/${kind}/${Date.now()}-${Math.random().toString(36).slice(2,9)}.jpg`;
  const {error}=await supabase.storage.from("studio-public-materials").upload(path,bytes,{contentType:"image/jpeg",upsert:false});
  if(error)throw error;
  return path;
 };
 const saveSchedule=async()=>{
  if(!supabase||!owner||!scheduleImage){Alert.alert("시간표 이미지","시간표 이미지를 선택해 주세요.");return;}
  setSaving(true);let uploadedPath:string|null=null;
  try{
   uploadedPath=await uploadMaterialImage(scheduleImage,"schedule");
   const {error}=await supabase.from("studio_public_schedules").insert({studio_id:studioId,schedule_text:null,image_path:uploadedPath,published_by:session.user.id,expires_at:dateAfterDays(180),is_active:true});
   if(error)throw error;
   setScheduleImage(null);invalidateStudioPublicMaterials(studioId);Alert.alert("시간표 등록 완료","이미지 시간표가 학원 상세 페이지에 공개됩니다.");await load();
  }catch(e:any){if(uploadedPath)await supabase.storage.from("studio-public-materials").remove([uploadedPath]);Alert.alert("시간표 등록 실패",e.message||"시간표를 저장하지 못했습니다.");}
  finally{setSaving(false);}
 };
 const savePrice=async()=>{
  if(!supabase||!owner||!priceImage){Alert.alert("가격표 이미지","가격표 이미지를 선택해 주세요.");return;}
  setSaving(true);let uploadedPath:string|null=null;
  try{
   uploadedPath=await uploadMaterialImage(priceImage,"price");
   const {error}=await supabase.from("studio_public_prices").insert({studio_id:studioId,amount_krw:null,price_period:null,frequency_per_week:null,image_path:uploadedPath,published_by:session.user.id,expires_at:dateAfterDays(180),is_active:true});
   if(error)throw error;
   setPriceImage(null);invalidateStudioPublicMaterials(studioId);Alert.alert("가격표 등록 완료","이미지 가격표가 학원 상세 페이지에 공개됩니다.");await load();
  }catch(e:any){if(uploadedPath)await supabase.storage.from("studio-public-materials").remove([uploadedPath]);Alert.alert("가격표 등록 실패",e.message||"가격표를 저장하지 못했습니다.");}
  finally{setSaving(false);}
 };

 const saveNotice=async()=>{
  if(!supabase||!owner||!noticeTitle.trim()||!noticeBody.trim()){Alert.alert("공지사항 입력","제목과 내용을 모두 입력해 주세요.");return;}
  setSaving(true);
  try{
   const query=editingNotice
    ?supabase.from("studio_owner_notices").update({title:noticeTitle.trim(),body:noticeBody.trim()}).eq("id",editingNotice.id).eq("studio_id",studioId)
    :supabase.from("studio_owner_notices").insert({studio_id:studioId,title:noticeTitle.trim(),body:noticeBody.trim(),created_by:session.user.id,is_active:true});
   const {error}=await query;
   if(error)throw error;
   setNoticeTitle("");setNoticeBody("");setEditingNotice(null);setNoticeEditorOpen(false);
   Alert.alert(editingNotice?"공지 수정 완료":"공지 등록 완료",editingNotice?"공지사항을 수정했습니다.":"학원 상세 페이지에 공지사항이 공개됩니다.");await load();
  }catch(e:any){Alert.alert(editingNotice?"공지 수정 실패":"공지 등록 실패",e.message||"공지사항을 저장하지 못했습니다.");}
  finally{setSaving(false);}
 };

 const replaceMaterialImage=async(kind:"schedule"|"price")=>{
  if(!supabase||!owner)return;
  const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:["images"],allowsMultipleSelection:false,quality:0.9});
  if(result.canceled||!result.assets[0])return;
  setSaving(true);let uploadedPath:string|null=null;
  try{
   uploadedPath=await uploadMaterialImage(result.assets[0],kind);
   const table=kind==="schedule"?"studio_public_schedules":"studio_public_prices";
   const payload:any=kind==="schedule"?{studio_id:studioId,schedule_text:null,image_path:uploadedPath,published_by:session.user.id,expires_at:dateAfterDays(180),is_active:true}:{studio_id:studioId,amount_krw:null,price_period:null,frequency_per_week:null,image_path:uploadedPath,published_by:session.user.id,expires_at:dateAfterDays(180),is_active:true};
   const {error}=await supabase.from(table).insert(payload);if(error)throw error;
   for(const item of materials.filter(item=>item.kind===kind&&item.is_active)){const {error:hideError}=await supabase.from(table).update({is_active:false}).eq("id",item.id).eq("studio_id",studioId);if(hideError)throw hideError;}
   invalidateStudioPublicMaterials(studioId);Alert.alert(kind==="schedule"?"시간표 공개 완료":"가격표 공개 완료","새 이미지가 학원 상세 페이지에 공개되었습니다.");await load();
  }catch(error:any){if(uploadedPath)await supabase.storage.from("studio-public-materials").remove([uploadedPath]);Alert.alert("이미지 변경 실패",error?.message||"이미지를 공개하지 못했습니다.");}
  finally{setSaving(false);}
 };
 const setGalleryAsRepresentative=async(item:any)=>{
  if(!supabase||!owner)return;
  setSaving(true);let newPath:string|null=null;
  try{
   const sourceUrl=supabase.storage.from("studio-public-materials").getPublicUrl(item.image_path).data.publicUrl;
   const response=await fetch(sourceUrl);if(!response.ok)throw new Error("사진 파일을 불러오지 못했습니다.");
   const bytes=await response.arrayBuffer();
   newPath=`${studioId}/representative/${Date.now()}-${Math.random().toString(36).slice(2,8)}.jpg`;
   const {error:uploadError}=await supabase.storage.from("studio-representative-images").upload(newPath,bytes,{contentType:"image/jpeg",upsert:false});if(uploadError)throw uploadError;
   const {error}=await supabase.rpc("owner_update_studio_representative_image",{p_studio_id:studioId,p_image_path:newPath});if(error)throw error;
   const previous=representativeImagePath;setRepresentativeImagePath(newPath);if(previous)await supabase.storage.from("studio-representative-images").remove([previous]);
   Alert.alert("대표 사진 변경 완료","선택한 사진을 대표 사진으로 설정했습니다.");
  }catch(error:any){if(newPath)await supabase.storage.from("studio-representative-images").remove([newPath]);Alert.alert("대표 사진 변경 실패",error?.message||"대표 사진을 변경하지 못했습니다.");}
  finally{setSaving(false);}
 };
 const showGalleryActions=(item:any)=>Alert.alert("사진 관리","이 사진으로 할 작업을 선택하세요.",[
  {text:"대표 사진으로 설정",onPress:()=>void setGalleryAsRepresentative(item)},
  {text:"갤러리에서 삭제",style:"destructive",onPress:()=>Alert.alert("사진 삭제","학원 사진에서 삭제할까요?",[{text:"취소",style:"cancel"},{text:"삭제",style:"destructive",onPress:()=>deactivateGalleryImage(item)}])},
  {text:"취소",style:"cancel"}
 ]);
 const deactivateMaterial=async(item:any)=>{
  if(!supabase)return;
  const table=item.kind==="schedule"?"studio_public_schedules":"studio_public_prices";
  const {error}=await supabase.from(table).update({is_active:false}).eq("id",item.id).eq("studio_id",studioId);
  if(error)Alert.alert("자료 삭제 실패",error.message);else{invalidateStudioPublicMaterials(studioId);await load();}
 };
 const deleteNotice=async(item:any)=>{
  if(!supabase||!owner)return;
  setSaving(true);
  try{
   const {error}=await supabase.from("studio_owner_notices").delete().eq("id",item.id).eq("studio_id",studioId);
   if(error)throw error;
   Alert.alert("공지 삭제 완료","공지사항을 삭제했습니다.");
   await load();
  }catch(error:any){Alert.alert("공지 삭제 실패",error?.message||"공지를 삭제하지 못했습니다.");}
  finally{setSaving(false);}
 };
 const toggleNotice=async(item:any)=>{
  if(!supabase)return;
  const {error}=await supabase.from("studio_owner_notices").update({is_active:!item.is_active,updated_at:new Date().toISOString()}).eq("id",item.id).eq("studio_id",studioId);
  if(error)Alert.alert("공지 변경 실패",error.message);else await load();
 };

 const button=(label:string,onPress:()=>void,disabled=false,destructive=false)=><Pressable disabled={disabled} onPress={onPress} style={[s.button,{backgroundColor:isDark?"#7652B8":C.pale},destructive&&s.danger,disabled&&{opacity:0.5}]}><Text style={[s.buttonText,{color:isDark?"#FFFFFF":C.purple},destructive&&{color:C.red}]}>{label}</Text></Pressable>;
 const field=(label:string,value:string,onChangeText:(v:string)=>void,placeholder:string="",keyboardType:any="default")=><View style={{marginTop:12}}><Text style={s.label}>{label}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} keyboardType={keyboardType} style={s.input}/></View>;

 return <SafeAreaView style={s.safe}><KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==="ios"?"padding":"height"}><ScrollView ref={managerScrollRef} contentContainerStyle={s.content} keyboardShouldPersistTaps="handled" stickyHeaderIndices={owner?[3]:[]} onScroll={event=>{tabScrollOffsets.current[activeTab]=event.nativeEvent.contentOffset.y;}} scrollEventThrottle={100}>
  <Pressable onPress={()=>router.back()}><Text style={s.back}>‹ 돌아가기</Text></Pressable>
  <Text style={s.brand}>Balletmate · 학원 관리</Text><Text style={s.title}>{studioName}</Text>
  {loading?<ActivityIndicator color={C.purple} style={{marginTop:28}}/>:!session?
   <View style={s.card}><Text style={s.body}>학원 관리 권한을 신청하거나 관리 기능을 사용하려면 먼저 로그인해 주세요.</Text>{button("로그인하기",()=>router.push({pathname:"/account",params:{returnTo:"studio-manager",studioId,studioName}}))}</View>
  :!studioId?
   ownedStudios.length?
    <View style={s.card}><Text style={s.cardTitle}>승인된 학원 관리</Text><Text style={s.body}>승인된 학원 관리자 계정입니다. 관리할 학원을 선택하세요.</Text>{ownedStudios.map(item=><View key={item.id} style={s.item}><Text style={s.itemTitle}>{item.name}</Text><Text style={s.body}>{[item.district,item.address].filter(Boolean).join(" · ")||"주소 정보 없음"}</Text>{button("학원 관리 열기",()=>router.push({pathname:"/studio-manager",params:{studioId:item.id,studioName:item.name}}))}</View>)}</View>
    :<View style={s.card}>
     <Text style={s.cardTitle}>관리할 학원 검색</Text>
     <Text style={s.body}>학원명을 검색한 뒤 해당 학원을 선택하면 관리자 권한 신청서를 작성할 수 있습니다.</Text>
     {field("학원명",studioSearch,setStudioSearch,"학원 이름을 입력하세요")}
     {button(studioSearchBusy?"검색 중…":"학원 검색",searchStudiosForApplication,studioSearchBusy)}
     {studioSearchResults.map(item=><View key={item.id} style={s.item}>
      <Text style={s.itemTitle}>{item.name}</Text>
      <Text style={s.body}>{[item.district,item.address].filter(Boolean).join(" · ")||"주소 정보 없음"}</Text>
      {button("이 학원 신청하기",()=>router.replace({pathname:"/studio-manager",params:{studioId:item.id,studioName:item.name}}))}
     </View>)}
    </View>
  :owner?
   <>
    <View style={{flexDirection:"row",gap:5,marginTop:8,marginBottom:4,padding:4,borderRadius:14,backgroundColor:isDark?"#211D2A":"#F0ECF7"}}>
     {([{key:"profile",label:"기본정보"},{key:"photos",label:"사진"},{key:"classes",label:"수업정보"},{key:"notices",label:"공지사항"}] as const).map(tab=><Pressable key={tab.key} onPress={()=>setActiveTab(tab.key)} accessibilityRole="tab" accessibilityState={{selected:activeTab===tab.key}} style={{flex:1,minHeight:48,borderRadius:10,alignItems:"center",justifyContent:"center",backgroundColor:activeTab===tab.key?(isDark?"#49366B":"#FFFFFF"):"transparent",borderWidth:activeTab===tab.key?1:0,borderColor:isDark?"#7255A0":"#E1D5F5"}}><Text style={{fontSize:11,fontWeight:"900",color:activeTab===tab.key?(isDark?"#E8DCFF":C.purple):(isDark?"#C0B8CC":C.muted)}}>{tab.label}</Text></Pressable>)}
    </View>
    <View style={{paddingVertical:7,paddingHorizontal:3}}><Text style={s.body}>{activeTab==="profile"?"학원 기본 정보와 운영 변경 이력을 관리합니다.":activeTab==="photos"?"대표 사진과 갤러리 사진을 한곳에서 관리합니다.":activeTab==="classes"?"시간표·가격표, 수업, 혜택과 수강 인증을 관리합니다.":"공지 목록을 확인하고 작성·수정·공개 여부를 관리합니다."}</Text></View>
    {activeTab==="profile"&&<>
     <View style={s.card}><Text style={s.cardTitle}>학원 기본 정보</Text>{field("학원명",profileName,setProfileName,"학원명")}{field("지역/구",profileDistrict,setProfileDistrict,"예: 서울 강남구")}{field("주소",profileAddress,setProfileAddress,"사업장 주소")}{field("전화번호",profilePhone,setProfilePhone,"연락처","phone-pad")}{field("대표 홈페이지 URL",profileWebsite,setProfileWebsite,"일반 홈페이지·네이버 블로그·인스타그램 URL (https://)")}<TextInput value={profileDescription} onChangeText={setProfileDescription} placeholder="학원 소개를 입력하세요." multiline style={[s.input,{height:110,textAlignVertical:"top",paddingTop:12,marginTop:12}]}/>{button("기본 정보 저장",saveProfile,saving)}</View>
     <View style={s.card}><Text style={s.cardTitle}>최근 수정 이력</Text>{editHistory.length?editHistory.map(item=><View key={item.id} style={s.item}><Text style={s.itemTitle}>{item.entity==="studios"?"학원 기본 정보":item.entity==="studio_public_prices"?"가격표":item.entity==="studio_public_schedules"?"시간표":"공지사항"} · {item.action==="insert"?"등록":item.action==="delete"?"삭제":"수정"}</Text><Text style={s.body}>{new Date(item.created_at).toLocaleString("ko-KR")} · {(item.changed_fields||[]).map((field:string)=>(({name:"학원명",district:"지역",address:"주소",phone:"전화번호",website_url:"홈페이지",description:"소개",schedule_text:"시간표",amount_krw:"가격",price_period:"가격 기간",frequency_per_week:"주당 횟수",title:"공지 제목",body:"공지 내용",is_active:"공개 상태",expires_at:"만료일"} as Record<string,string>)[field]||field)).join(", ")||"변경 내용"}</Text></View>):<Text style={s.body}>수정 이력이 없습니다.</Text>}</View>
    </>}
    {activeTab==="photos"&&<View style={s.card}><Text style={s.cardTitle}>대표 사진</Text>{representativeImagePath?<Image source={{uri:supabase?.storage.from("studio-representative-images").getPublicUrl(representativeImagePath).data.publicUrl}} style={{width:"100%",height:205,borderRadius:12,marginTop:8,backgroundColor:isDark?"#292633":"#F2F0F6"}} resizeMode="cover"/>:<View style={{height:150,borderRadius:12,marginTop:8,backgroundColor:isDark?"#292633":"#F2F0F6",alignItems:"center",justifyContent:"center"}}><Text style={s.body}>대표 사진이 등록되지 않았습니다.</Text></View>}{button("대표 사진 변경",pickRepresentativeImage,saving)}
     <View style={[s.item,{marginTop:18}]}><Text style={s.cardTitle}>갤러리 사진 · {activeGalleryCount} / 10</Text><Text style={s.body}>사진을 누르면 대표 사진 설정 또는 삭제를 선택할 수 있습니다.</Text>
      {activeGalleryCount?<View style={{flexDirection:"row",flexWrap:"wrap",gap:8,marginTop:12}}>{galleryImages.filter(x=>x.is_active).map(item=><Pressable key={item.id} disabled={saving} onPress={()=>showGalleryActions(item)} style={{width:"31.5%",aspectRatio:1,borderRadius:10,overflow:"hidden",backgroundColor:isDark?"#292633":"#F2F0F6"}}><Image source={{uri:supabase?.storage.from("studio-public-materials").getPublicUrl(item.image_path).data.publicUrl}} style={{width:"100%",height:"100%"}} resizeMode="cover"/></Pressable>)}</View>:<Text style={s.body}>등록된 갤러리 사진이 없습니다.</Text>}
      {galleryImagesToUpload.length>0&&<View style={{marginTop:14}}><Text style={s.label}>업로드 대기 · {galleryImagesToUpload.length}장</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{gap:8,paddingVertical:8}}>{galleryImagesToUpload.map((asset,index)=><View key={asset.assetId||asset.uri} style={{width:96}}><Image source={{uri:asset.uri}} style={{width:96,height:88,borderRadius:9}}/><Text style={s.body}>{index===0?"대표 사진":"사진 "+(index+1)}</Text></View>)}</ScrollView></View>}
      {button("갤러리 사진 추가",pickStudioPhotos,saving||activeGalleryCount>=10)}{button("선택 사진 등록",saveStudioPhotos,saving||!galleryImagesToUpload.length)}
     </View></View>}
    {activeTab==="classes"&&<>
     <View style={s.card}><Text style={s.cardTitle}>시간표 이미지</Text>{(()=>{const current=materials.find(item=>item.kind==="schedule"&&item.is_active);const url=current?.image_path?supabase?.storage.from("studio-public-materials").getPublicUrl(current.image_path).data.publicUrl:null;return url?<Image source={{uri:url}} style={{width:"100%",height:190,marginTop:8,borderRadius:10,backgroundColor:isDark?"#292633":"#F2F0F6"}} resizeMode="contain"/>:<Text style={s.body}>등록된 시간표 이미지가 없습니다.</Text>;})()}{button("시간표 이미지 변경",()=>replaceMaterialImage("schedule"),saving)}{materials.filter(item=>item.kind==="schedule").map(item=><View key={"schedule-"+item.id} style={s.item}><Text style={s.body}>{item.is_active?"공개 중":"비공개"} · {item.published_at?new Date(item.published_at).toLocaleDateString("ko-KR"):""}</Text>{item.is_active&&button("공개 중단",()=>Alert.alert("시간표 공개 중단","시간표 이미지를 비공개로 전환할까요?",[{text:"취소",style:"cancel"},{text:"중단",style:"destructive",onPress:()=>deactivateMaterial(item)}]),saving,true)}</View>)}</View>
     <View style={s.card}><Text style={s.cardTitle}>가격표 이미지</Text>{(()=>{const current=materials.find(item=>item.kind==="price"&&item.is_active);const url=current?.image_path?supabase?.storage.from("studio-public-materials").getPublicUrl(current.image_path).data.publicUrl:null;return url?<Image source={{uri:url}} style={{width:"100%",height:190,marginTop:8,borderRadius:10,backgroundColor:isDark?"#292633":"#F2F0F6"}} resizeMode="contain"/>:<Text style={s.body}>등록된 가격표 이미지가 없습니다.</Text>;})()}{button("가격표 이미지 변경",()=>replaceMaterialImage("price"),saving)}{materials.filter(item=>item.kind==="price").map(item=><View key={"price-"+item.id} style={s.item}><Text style={s.body}>{item.is_active?"공개 중":"비공개"} · {item.published_at?new Date(item.published_at).toLocaleDateString("ko-KR"):""}</Text>{item.is_active&&button("공개 중단",()=>Alert.alert("가격표 공개 중단","가격표 이미지를 비공개로 전환할까요?",[{text:"취소",style:"cancel"},{text:"중단",style:"destructive",onPress:()=>deactivateMaterial(item)}]),saving,true)}</View>)}</View>
     <View style={s.card}><Text style={s.cardTitle}>수업 관리</Text><Text style={s.body}>엑셀 양식에 여러 수업을 작성한 뒤 한 번에 등록할 수 있습니다. 같은 수업명은 중복 등록하지 않습니다.</Text><View style={{flexDirection:"row",gap:8,marginTop:10}}><Pressable onPress={downloadClassTemplate} style={{flex:1,padding:12,borderRadius:10,backgroundColor:isDark?"#342A43":C.pale,alignItems:"center"}}><Text style={{fontSize:12,fontWeight:"900",color:C.purple}}>엑셀 양식 받기</Text></Pressable><Pressable onPress={importClassesFromSpreadsheet} style={{flex:1,padding:12,borderRadius:10,backgroundColor:C.purple,alignItems:"center"}}><Text style={{fontSize:12,fontWeight:"900",color:"#FFFFFF"}}>엑셀로 일괄 등록</Text></Pressable></View>{field("수업명 *",classTitle,setClassTitle,"예: 성인 기초 발레")}<Text style={s.label}>수업 대상</Text><View style={{flexDirection:"row",gap:7,marginTop:6}}>{([{value:"adult",label:"성인"},{value:"kids",label:"키즈"},{value:"all",label:"전체"}] as const).map(option=><Pressable key={option.value} onPress={()=>setClassAudience(option.value)} style={{paddingHorizontal:12,paddingVertical:9,borderRadius:9,backgroundColor:classAudience===option.value?C.purple:C.pale}}><Text style={{fontSize:11,fontWeight:"800",color:classAudience===option.value?"#fff":C.purple}}>{option.label}</Text></Pressable>)}</View>{field("수업 수준",classLevel,setClassLevel,"입문 / 초급 / 중급 / 고급")}{field("수업 유형",classType,setClassType,"기초 / 포인트 / 발레핏")}{field("수업 시간(분)",classDuration,setClassDuration,"60","numeric")}{button("수업 직접 등록",saveClass,saving)}<View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginTop:16}}><Text style={s.label}>등록된 수업 {ownerClasses.length}개</Text><Pressable onPress={()=>{setClassSelectionMode(v=>!v);setSelectedClassIds([]);}}><Text style={{fontSize:12,fontWeight:"900",color:C.purple}}>{classSelectionMode?"선택 취소":"여러 개 선택"}</Text></Pressable></View>{classSelectionMode&&<View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginVertical:8}}><Pressable onPress={()=>setSelectedClassIds(selectedClassIds.length===ownerClasses.length?[]:ownerClasses.map(x=>x.id))}><Text style={{fontSize:12,color:C.purple,fontWeight:"800"}}>{selectedClassIds.length===ownerClasses.length?"전체 선택 해제":"전체 선택"}</Text></Pressable><Pressable disabled={!selectedClassIds.length||saving} onPress={()=>Alert.alert("수업 일괄 삭제",selectedClassIds.length+"개 수업을 영구 삭제할까요?",[{text:"취소",style:"cancel"},{text:"삭제",style:"destructive",onPress:deleteSelectedClasses}])}><Text style={{fontSize:12,color:selectedClassIds.length?C.red:C.muted,fontWeight:"900"}}>선택 {selectedClassIds.length}개 삭제</Text></Pressable></View>}{ownerClasses.map(item=><View key={item.id} style={[s.item,{flexDirection:"row",alignItems:"center",gap:10}]}>{classSelectionMode&&<Pressable onPress={()=>toggleClassSelection(item.id)} style={{width:28,height:28,borderRadius:7,borderWidth:1,borderColor:selectedClassIds.includes(item.id)?C.purple:C.line,backgroundColor:selectedClassIds.includes(item.id)?C.purple:"transparent",alignItems:"center",justifyContent:"center"}}><Text style={{color:"#FFFFFF",fontWeight:"900"}}>{selectedClassIds.includes(item.id)?"✓":""}</Text></Pressable>}<View style={{flex:1}}><Text style={s.itemTitle}>{item.title}</Text><Text style={s.body}>{item.audience==="kids"?"키즈":item.audience==="all"?"전체":"성인"} · {item.level||"수준 미입력"} · {item.duration_minutes||60}분</Text><View style={{flexDirection:"row",gap:7,flexWrap:"wrap",marginTop:7}}><Pressable onPress={()=>toggleOwnerClass(item)} disabled={saving} style={{padding:8,borderRadius:8,backgroundColor:isDark?"#342A43":C.pale}}><Text style={{fontSize:11,color:C.purple,fontWeight:"800"}}>{item.is_active?"비공개":"공개"}</Text></Pressable>{!classSelectionMode&&<Pressable onPress={()=>Alert.alert("수업 삭제","이 수업을 완전히 삭제할까요?",[{text:"취소",style:"cancel"},{text:"삭제",style:"destructive",onPress:()=>deleteOwnerClass(item)}])} style={{padding:8,borderRadius:8,backgroundColor:isDark?"#44282E":"#FFF0F1"}}><Text style={{fontSize:11,color:C.red,fontWeight:"800"}}>삭제</Text></Pressable>}</View></View></View>)}{!ownerClasses.length&&<Text style={s.body}>등록된 수업이 없습니다.</Text>}</View>
     <View style={s.card}><Text style={s.cardTitle}>할인·혜택 관리</Text>{field("혜택명 *",couponTitle,setCouponTitle,"예: 첫 등록 할인")}{field("할인 내용 *",couponDiscount,setCouponDiscount,"예: 첫 달 10% 할인")}{field("상세 안내",couponDescription,setCouponDescription,"적용 조건 등")}{button("혜택 등록",saveCoupon,saving)}{ownerCoupons.map(item=><View key={item.id} style={s.item}><Text style={s.itemTitle}>{item.title}</Text><Text style={s.body}>{item.discount_text||item.description||""}</Text>{button(item.is_active?"혜택 비공개":"혜택 공개",()=>toggleOwnerCoupon(item),saving)}</View>)}{!ownerCoupons.length&&<Text style={s.body}>등록된 혜택이 없습니다.</Text>}</View>
     <View style={s.card}><Text style={s.cardTitle}>수강 인증 코드</Text><Text style={s.body}>실제 수강을 완료한 회원에게만 코드를 전달해 주세요. 코드는 72시간 후 만료되고 한 번만 사용할 수 있습니다.</Text>{!!reviewCode&&<Text selectable style={{fontSize:22,fontWeight:"900",letterSpacing:2,color:C.purple,marginTop:10}}>{reviewCode}</Text>}{button(reviewCodeBusy?"발급 중…":"수강 인증 코드 발급",issueReviewCode,reviewCodeBusy)}</View>
    </>}
    {activeTab==="notices"&&<View style={s.card}><View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between"}}><View><Text style={s.cardTitle}>공지사항</Text><Text style={s.body}>등록한 공지는 학원 상세 페이지에 표시됩니다.</Text></View><Pressable onPress={()=>openNoticeEditor()} style={{paddingHorizontal:13,paddingVertical:11,borderRadius:11,backgroundColor:isDark?"#7652B8":C.pale}}><Text style={{fontSize:12,fontWeight:"900",color:isDark?"#FFFFFF":C.purple}}>+ 새 공지</Text></Pressable></View>{notices.length?notices.map(item=><View key={item.id} style={s.item}><View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between"}}><Text style={s.itemTitle} numberOfLines={1}>{item.title}</Text><Text style={{fontSize:10,fontWeight:"800",color:item.is_active?"#24865A":C.muted}}>{item.is_active?"공개 중":"비공개"}</Text></View><Text style={s.body}>{item.body}</Text><Text style={[s.body,{fontSize:10}]}>{item.created_at?new Date(item.created_at).toLocaleDateString("ko-KR"):"날짜 미확인"}</Text><View style={{flexDirection:"row",gap:8,marginTop:8}}><Pressable onPress={()=>openNoticeEditor(item)} style={{paddingHorizontal:13,paddingVertical:9,borderRadius:9,backgroundColor:isDark?"#3A3048":C.pale}}><Text style={{fontSize:11,fontWeight:"800",color:isDark?"#E8DCFF":C.purple}}>수정</Text></Pressable><Pressable onPress={()=>toggleNotice(item)} disabled={saving} style={{paddingHorizontal:13,paddingVertical:9,borderRadius:9,backgroundColor:isDark?"#302C38":"#F2F0F6"}}><Text style={{fontSize:11,fontWeight:"800",color:isDark?"#E5E0EC":C.ink}}>{item.is_active?"숨기기":"다시 공개"}</Text></Pressable><Pressable onPress={()=>Alert.alert("공지 삭제","이 공지사항을 완전히 삭제할까요?",[{text:"취소",style:"cancel"},{text:"삭제",style:"destructive",onPress:()=>deleteNotice(item)}])} disabled={saving} style={{paddingHorizontal:13,paddingVertical:9,borderRadius:9,backgroundColor:isDark?"#44282E":"#FFF0F1"}}><Text style={{fontSize:11,fontWeight:"800",color:C.red}}>삭제</Text></Pressable></View></View>):<Text style={s.body}>등록된 공지사항이 없습니다. 새 공지를 작성해 보세요.</Text>}</View>}
   </>:application&&application.status!=="needs_info"?
   <View style={s.card}><Text style={s.cardTitle}>관리 권한 신청 상태</Text><Text style={s.status}>{application.status==="pending"?"운영자 심사 대기":application.status==="needs_info"?"추가 확인 요청":application.status==="approved"?"승인 완료":"반려"}</Text><Text style={s.body}>운영 관계 확인 후 운영자가 권한을 승인합니다.</Text>{application.review_note&&<Text style={s.body}>운영자 메모: {application.review_note}</Text>}{application.status==="rejected"&&button("다시 신청하기",()=>setApplication(null))}</View>
  :<View style={s.card}>
    <Text style={s.cardTitle}>{application?.status==="needs_info"?"추가 확인 정보 제출":"학원 관리자 권한 신청"}</Text>{application?.status==="needs_info"&&<Text style={s.body}>운영자가 확인을 요청했습니다. 다시 제출해 주세요. {application.review_note||""}</Text>}
    <Text style={s.body}>이메일 또는 소셜 로그인 계정으로 신청하고 아래 방법 중 하나로 운영 관계를 확인합니다. 사업자번호·대표자·주소·등록증은 수집하지 않습니다. 확인 후 운영자 승인을 받습니다.</Text>
    <View style={{flexDirection:"row",gap:7,marginTop:12,flexWrap:"wrap"}}>
      {([{value:"phone",label:"공개 전화 확인"},{value:"blog",label:"네이버 블로그"},{value:"instagram",label:"인스타그램"},{value:"manual",label:"운영자 직접 확인"}] as const).map(option=><Pressable key={option.value} onPress={()=>setVerificationMethod(option.value)} style={{paddingHorizontal:11,paddingVertical:9,borderRadius:10,backgroundColor:verificationMethod===option.value?C.purple:(isDark?"#292929":"#F2F0F6")}}><Text style={{fontSize:11,fontWeight:"800",color:verificationMethod===option.value?"#fff":(isDark?"#FFFFFF":C.ink)}}>{option.label}</Text></Pressable>)}
    </View>
    {(verificationMethod==="blog"||verificationMethod==="instagram")&&<>
      {field(verificationMethod==="blog"?"공식 네이버 블로그 URL *":"공식 인스타그램 URL *",blogUrl,setBlogUrl,verificationMethod==="blog"?"https://blog.naver.com/아이디":"https://www.instagram.com/아이디")}
      <View style={{backgroundColor:isDark?"#242424":C.pale,borderRadius:10,padding:11,marginTop:10}}><Text style={s.body}>선택한 공식 채널의 새 게시물 또는 소개란에 인증 문구를 올려 주세요. 확인 후 삭제해도 됩니다.</Text><Text style={{fontSize:15,fontWeight:"900",color:C.purple,marginTop:6}}>{blogVerificationCode||"인증 코드를 생성하세요"}</Text><Pressable onPress={()=>setBlogVerificationCode("BALLET-"+Math.random().toString(36).slice(2,8).toUpperCase())} style={{marginTop:8}}><Text style={s.buttonText}>인증 코드 생성</Text></Pressable></View>
    </>}
    {verificationMethod==="phone"&&<View style={{padding:11,borderRadius:10,backgroundColor:isDark?"#242424":C.pale,marginTop:10}}><Text style={s.body}>학원에 공개된 전화번호로 운영자가 직접 확인합니다. 별도 서류나 개인 전화번호는 수집하지 않습니다.</Text><Text style={{fontSize:12,fontWeight:"800",color:isDark?"#FFFFFF":C.ink,marginTop:6}}>{profilePhone?"확인 대상 공개 번호: "+profilePhone:"공개 전화번호가 등록되어 있지 않습니다."}</Text></View>}
    {verificationMethod==="manual"&&<Text style={s.body}>운영자가 공개 연락처, 공식 채널 또는 기타 자료로 운영 관계를 확인합니다. 필요 시 신청 계정으로 추가 안내합니다.</Text>}
    <Text style={[s.body,{marginTop:12}]}>신청 정보는 선택한 인증 방식에 필요한 공식 채널 정보만 전달됩니다. 운영자 확인 후 승인되면 별도 신청 없이 학원 관리 기능을 사용할 수 있습니다.</Text>{button(application?.status==="needs_info"?"확인 정보 다시 제출":"관리자 권한 신청",submitApplication,saving||(verificationMethod==="phone"&&!profilePhone.trim())||((verificationMethod==="blog"||verificationMethod==="instagram")&&(!blogUrl.trim()||!blogVerificationCode.trim())))}
   </View>}
 </ScrollView>
 <Modal visible={classImportOpen} transparent animationType="slide" onRequestClose={()=>{if(!classImportBusy)setClassImportOpen(false);}}>
  <View style={{flex:1,justifyContent:"flex-end",backgroundColor:"rgba(0,0,0,0.42)"}}><Pressable style={{flex:1}} onPress={()=>{if(!classImportBusy)setClassImportOpen(false);}}/>
   <View style={{maxHeight:"82%",padding:18,paddingBottom:28,borderTopLeftRadius:22,borderTopRightRadius:22,backgroundColor:isDark?"#211E29":"#FFFFFF"}}>
    <Text style={{fontSize:18,fontWeight:"900",color:isDark?"#F3EFFA":C.ink}}>엑셀 등록 미리보기</Text>
    <Text style={s.body}>등록 예정 {classImportRows.length}개 · 제외 {classImportErrors.length}개</Text>
    <ScrollView style={{marginTop:10}}>{classImportRows.map((row,index)=><View key={index} style={s.item}><Text style={s.itemTitle}>{row.title}</Text><Text style={s.body}>{row.audience==="kids"?"키즈":row.audience==="adult"?"성인":"전체"} · {row.level||"수준 미입력"} · {row.class_type||"유형 미입력"} · {row.duration_minutes}분</Text></View>)}{classImportErrors.map((error,index)=><Text key={"error"+index} style={{fontSize:11,color:C.red,marginTop:7}}>{error}</Text>)}</ScrollView>
    <Pressable disabled={classImportBusy} onPress={confirmImportClasses} style={{marginTop:12,padding:15,borderRadius:11,backgroundColor:C.purple,alignItems:"center"}}><Text style={{fontSize:13,fontWeight:"900",color:"#FFFFFF"}}>{classImportBusy?"등록 중…":classImportRows.length+"개 수업 한 번에 등록"}</Text></Pressable>
    <Pressable disabled={classImportBusy} onPress={()=>setClassImportOpen(false)} style={{padding:12,alignItems:"center"}}><Text style={{fontSize:12,fontWeight:"800",color:C.muted}}>취소</Text></Pressable>
   </View>
  </View>
 </Modal>
 <Modal visible={noticeEditorOpen} transparent animationType="slide" onRequestClose={()=>{if(!saving)setNoticeEditorOpen(false);}}>
  <View style={{flex:1,justifyContent:"flex-end",backgroundColor:"rgba(0,0,0,0.42)"}}><Pressable style={{flex:1}} onPress={()=>{if(!saving)setNoticeEditorOpen(false);}}/>
   <KeyboardAvoidingView behavior={Platform.OS==="ios"?"padding":undefined}><View style={{padding:20,paddingBottom:28,borderTopLeftRadius:22,borderTopRightRadius:22,backgroundColor:isDark?"#211E29":"#FFFFFF",borderWidth:1,borderColor:isDark?"#40384D":C.line}}>
    <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between",marginBottom:12}}><Text style={{fontSize:18,fontWeight:"900",color:isDark?"#F3EFFA":C.ink}}>{editingNotice?"공지 수정":"새 공지 작성"}</Text><Pressable onPress={()=>{if(!saving)setNoticeEditorOpen(false);}}><Text style={{fontSize:22,color:isDark?"#D6CDE4":C.muted}}>×</Text></Pressable></View>
    <Text style={[s.label,{color:isDark?"#E9E2F2":C.ink}]}>제목</Text><TextInput value={noticeTitle} onChangeText={setNoticeTitle} placeholder="공지 제목을 입력하세요." placeholderTextColor={isDark?"#9B93A8":"#8A8493"} style={[s.input,{backgroundColor:isDark?"#302B39":"#FFFFFF",color:isDark?"#FFFFFF":C.ink,borderColor:isDark?"#514568":C.line}]}/>
    <Text style={[s.label,{color:isDark?"#E9E2F2":C.ink,marginTop:14}]}>내용</Text><TextInput value={noticeBody} onChangeText={setNoticeBody} placeholder="휴강, 모집, 행사 등 공지 내용을 입력하세요." placeholderTextColor={isDark?"#9B93A8":"#8A8493"} multiline textAlignVertical="top" style={[s.input,{height:150,backgroundColor:isDark?"#302B39":"#FFFFFF",color:isDark?"#FFFFFF":C.ink,borderColor:isDark?"#514568":C.line}]}/>
    {button(saving?"저장 중…":editingNotice?"공지 수정":"공지 공개하기",saveNotice,saving||!noticeTitle.trim()||!noticeBody.trim())}
   </View></KeyboardAvoidingView>
  </View>
 </Modal>
 </KeyboardAvoidingView></SafeAreaView>;
}

const createS = (dark:boolean) => StyleSheet.create(themeStyles({
 safe:{flex:1,backgroundColor:C.bg},content:{padding:16,paddingBottom:40},back:{color:C.muted,fontWeight:"700",paddingVertical:8},
 brand:{fontSize:13,fontWeight:"900",color:C.purple,marginTop:12},title:{fontSize:23,fontWeight:"900",color:C.ink,marginTop:5,marginBottom:14},
 card:{backgroundColor:"#fff",borderRadius:16,borderWidth:1,borderColor:C.line,padding:15,marginTop:12},
 tabBar:{flexDirection:"row",borderBottomWidth:1,borderBottomColor:C.line,marginTop:14},tab:{flex:1,alignItems:"center",paddingVertical:13,borderBottomWidth:3},tabText:{fontSize:12,fontWeight:"900"},tabHint:{fontSize:11,color:C.muted,marginTop:8,marginBottom:2},
 cardTitle:{fontSize:15,fontWeight:"900",color:C.ink,marginBottom:7},body:{fontSize:12,lineHeight:19,color:C.muted,marginTop:5},
 label:{fontSize:12,fontWeight:"800",color:C.ink,marginBottom:6},input:{borderWidth:1,borderColor:C.line,borderRadius:11,paddingHorizontal:12,paddingVertical:11,fontSize:13,color:C.ink,backgroundColor:"#fff"},
 button:{backgroundColor:C.pale,borderRadius:11,minHeight:50,paddingHorizontal:16,paddingVertical:14,alignItems:"center",justifyContent:"center",marginTop:12},buttonText:{fontSize:14,fontWeight:"900",color:C.purple},
 danger:{backgroundColor:"#FFF5F5",borderWidth:1,borderColor:"#E6C5C9"},status:{fontSize:17,fontWeight:"900",color:C.purple,marginVertical:6},
 item:{borderTopWidth:1,borderTopColor:C.line,paddingTop:10,marginTop:10},itemTitle:{fontSize:13,fontWeight:"800",color:C.ink}
},dark));

import React, {useCallback, useEffect, useState, useMemo} from "react";
import {themeStyles } from "../lib/theme";
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { invalidateStudioPublicMaterials } from "../lib/studio-public-materials";
import { searchStudiosByName } from "../lib/studios";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../lib/supabase";

const C={ink:"#252238",muted:"#625E70",purple:"#653BB7",pale:"#F2ECFF",line:"#E9E2F2",bg:"#FBF9FF",red:"#A33342"};
const dateAfterDays=(days:number)=>{const d=new Date();d.setDate(d.getDate()+days);return d.toISOString().slice(0,10);};

export default function StudioManager(){
 const isDark=useColorScheme()==="dark";
 const s=useMemo(()=>createS(isDark),[isDark]);
 const router=useRouter();
 const params=useLocalSearchParams<{studioId?:string;studioName?:string}>();
 const studioId=String(params.studioId||"");
 const studioName=String(params.studioName||"선택한 학원");
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
 const [representativeImage,setRepresentativeImage]=useState<ImagePicker.ImagePickerAsset|null>(null);
 const [representativeImagePath,setRepresentativeImagePath]=useState<string|null>(null);
 const [galleryImages,setGalleryImages]=useState<any[]>([]);
 const [galleryImage,setGalleryImage]=useState<ImagePicker.ImagePickerAsset|null>(null);
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
 const [couponTitle,setCouponTitle]=useState("");
 const [couponDiscount,setCouponDiscount]=useState("");
 const [couponDescription,setCouponDescription]=useState("");

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
 const saveClass=async()=>{
  if(!supabase||!owner||classTitle.trim().length<2){Alert.alert("수업 정보","수업명은 2자 이상 입력해 주세요.");return;}
  const duration=Number(classDuration);
  if(!Number.isInteger(duration)||duration<10||duration>240){Alert.alert("수업 시간","수업 시간은 10~240분으로 입력해 주세요.");return;}
  setSaving(true);
  try{
   const {error}=await supabase.from("classes").insert({studio_id:studioId,title:classTitle.trim(),audience:classAudience,level:classLevel.trim()||null,class_type:classType.trim()||null,duration_minutes:duration,is_active:true});
   if(error)throw error;
   setClassTitle("");setClassLevel("");setClassType("");setClassDuration("60");
   Alert.alert("수업 등록 완료","학원 수업 목록에 반영됩니다.");await load();
  }catch(error:any){Alert.alert("수업 등록 실패",error?.message||"수업을 저장하지 못했습니다.");}
  finally{setSaving(false);}
 };
 const toggleOwnerClass=async(item:any)=>{
  if(!supabase)return;
  const {error}=await supabase.from("classes").update({is_active:!item.is_active}).eq("id",item.id).eq("studio_id",studioId);
  if(error)Alert.alert("수업 변경 실패",error.message);else await load();
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
 const pickRepresentativeImage=async()=>{const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:["images"],allowsMultipleSelection:false,quality:0.9});if(!result.canceled&&result.assets[0])setRepresentativeImage(result.assets[0]);};
 const saveRepresentativeImage=async()=>{if(!supabase||!owner||!session?.user?.id||!representativeImage){Alert.alert("대표 이미지","사진을 먼저 선택해 주세요.");return;}setSaving(true);let uploadedPath:string|null=null;try{const optimized=await ImageManipulator.manipulateAsync(representativeImage.uri,[{resize:{width:1600}}],{compress:0.86,format:ImageManipulator.SaveFormat.JPEG});const response=await fetch(optimized.uri);if(!response.ok)throw new Error("이미지를 읽지 못했습니다.");const bytes=await response.arrayBuffer();const previousPath=representativeImagePath;uploadedPath=studioId+"/representative/"+Date.now()+".jpg";const {error:uploadError}=await supabase.storage.from("studio-representative-images").upload(uploadedPath,bytes,{contentType:"image/jpeg",upsert:false});if(uploadError)throw uploadError;const {error}=await supabase.rpc("owner_update_studio_representative_image",{p_studio_id:studioId,p_image_path:uploadedPath});if(error)throw error;setRepresentativeImagePath(uploadedPath);setRepresentativeImage(null);if(previousPath&&previousPath!==uploadedPath)await supabase.storage.from("studio-representative-images").remove([previousPath]);Alert.alert("대표 이미지 변경 완료","학원 대표 이미지가 변경되었습니다. 운영자에게 변경 알림이 전달됩니다.");await load();}catch(error:any){if(uploadedPath)await supabase.storage.from("studio-representative-images").remove([uploadedPath]);Alert.alert("대표 이미지 저장 실패",error?.message||"대표 이미지를 저장하지 못했습니다.");}finally{setSaving(false);}};
 const pickGalleryImage=async()=>{const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:["images"],allowsMultipleSelection:false,quality:0.9});if(!result.canceled&&result.assets[0])setGalleryImage(result.assets[0]);};
 const saveGalleryImage=async()=>{if(!supabase||!owner||!session?.user?.id||!galleryImage){Alert.alert("학원 사진","사진을 먼저 선택해 주세요.");return;}setSaving(true);let uploadedPath:string|null=null;try{const optimized=await ImageManipulator.manipulateAsync(galleryImage.uri,[{resize:{width:1800}}],{compress:0.86,format:ImageManipulator.SaveFormat.JPEG});const response=await fetch(optimized.uri);if(!response.ok)throw new Error("이미지를 읽지 못했습니다.");const bytes=await response.arrayBuffer();uploadedPath=`${studioId}/gallery/${Date.now()}-${Math.random().toString(36).slice(2,9)}.jpg`;const {error:uploadError}=await supabase.storage.from("studio-public-materials").upload(uploadedPath,bytes,{contentType:"image/jpeg",upsert:false});if(uploadError)throw uploadError;const {error}=await supabase.from("studio_gallery_images").insert({studio_id:studioId,image_path:uploadedPath,created_by:session.user.id,is_active:true});if(error)throw error;setGalleryImage(null);Alert.alert("사진 등록 완료","학원 사진 탭에 공개되었습니다.");await load();}catch(error:any){if(uploadedPath)await supabase.storage.from("studio-public-materials").remove([uploadedPath]);Alert.alert("사진 등록 실패",error?.message||"사진을 저장하지 못했습니다.");}finally{setSaving(false);}};
 const deactivateGalleryImage=async(item:any)=>{if(!supabase||!owner)return;setSaving(true);try{const {error}=await supabase.from("studio_gallery_images").update({is_active:false}).eq("id",item.id).eq("studio_id",studioId);if(error)throw error;await supabase.storage.from("studio-public-materials").remove([item.image_path]);Alert.alert("사진 삭제 완료","학원 사진에서 삭제했습니다.");await load();}catch(error:any){Alert.alert("사진 삭제 실패",error?.message||"사진을 삭제하지 못했습니다.");}finally{setSaving(false);}};
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
  if(error)Alert.alert("자료 삭제 실패",error.message);else{invalidateStudioPublicMaterials(studioId);await load();}
 };
 const toggleNotice=async(item:any)=>{
  if(!supabase)return;
  const {error}=await supabase.from("studio_owner_notices").update({is_active:!item.is_active,updated_at:new Date().toISOString()}).eq("id",item.id).eq("studio_id",studioId);
  if(error)Alert.alert("공지 변경 실패",error.message);else await load();
 };

 const button=(label:string,onPress:()=>void,disabled=false,destructive=false)=><Pressable disabled={disabled} onPress={onPress} style={[s.button,{backgroundColor:isDark?"#7652B8":C.pale},destructive&&s.danger,disabled&&{opacity:0.5}]}><Text style={[s.buttonText,{color:isDark?"#FFFFFF":C.purple},destructive&&{color:C.red}]}>{label}</Text></Pressable>;
 const field=(label:string,value:string,onChangeText:(v:string)=>void,placeholder:string="",keyboardType:any="default")=><View style={{marginTop:12}}><Text style={s.label}>{label}</Text><TextInput value={value} onChangeText={onChangeText} placeholder={placeholder} keyboardType={keyboardType} style={s.input}/></View>;

 return <SafeAreaView style={s.safe}><KeyboardAvoidingView style={{flex:1}} behavior={Platform.OS==="ios"?"padding":"height"}><ScrollView contentContainerStyle={s.content} keyboardShouldPersistTaps="handled">
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
    <View style={s.card}><Text style={s.cardTitle}>승인된 원장님 계정</Text><Text style={s.body}>이 학원의 정보와 공개 자료를 관리할 수 있습니다. 등록한 내용은 학원 상세 페이지에 바로 공개됩니다.</Text></View>
    <View style={s.card}><Text style={s.cardTitle}>학원 대표 이미지</Text><Text style={s.body}>사진을 첨부해 학원 상세 페이지의 대표 사진을 변경할 수 있습니다. 별도 승인 없이 즉시 반영됩니다.</Text>{(representativeImage?.uri||representativeImagePath)&&<Image source={{uri:representativeImage?.uri||supabase?.storage.from("studio-representative-images").getPublicUrl(representativeImagePath!).data.publicUrl}} style={{width:"100%",height:190,borderRadius:10,marginTop:10}} resizeMode="cover"/>}{button(representativeImage?"사진 다시 선택":"대표 사진 첨부",pickRepresentativeImage,saving)}{button("대표 이미지로 설정",saveRepresentativeImage,saving||!representativeImage)}{representativeImagePath&&button("대표 이미지 제거",()=>Alert.alert("대표 이미지 제거","현재 대표 이미지를 제거할까요?",[{text:"취소",style:"cancel"},{text:"제거",style:"destructive",onPress:async()=>{if(!supabase)return;setSaving(true);const {error}=await supabase.rpc("owner_update_studio_representative_image",{p_studio_id:studioId,p_image_path:null});if(error)Alert.alert("제거 실패",error.message);else{const previousPath=representativeImagePath;setRepresentativeImagePath(null);if(previousPath)await supabase.storage.from("studio-representative-images").remove([previousPath]);Alert.alert("제거 완료","대표 이미지가 제거되었습니다.");await load();}setSaving(false);}}]),saving,true)}</View>
    <View style={s.card}><Text style={s.cardTitle}>학원 사진 관리</Text><Text style={s.body}>학원 상세 페이지의 사진 탭에 공개할 사진을 등록할 수 있습니다. 승인된 원장 계정만 등록·삭제할 수 있습니다.</Text>{galleryImage&&<Image source={{uri:galleryImage.uri}} style={{width:"100%",height:180,borderRadius:10,marginTop:10}} resizeMode="cover"/>}{button(galleryImage?"사진 다시 선택":"사진 선택",pickGalleryImage,saving)}{button("사진 공개",saveGalleryImage,saving||!galleryImage)}{galleryImages.filter(x=>x.is_active).map(item=><View key={item.id} style={s.item}><Image source={{uri:supabase?.storage.from("studio-public-materials").getPublicUrl(item.image_path).data.publicUrl}} style={{width:"100%",height:150,borderRadius:9}} resizeMode="cover"/>{button("사진 삭제",()=>Alert.alert("사진 삭제","이 사진을 학원 사진에서 삭제할까요?",[{text:"취소",style:"cancel"},{text:"삭제",style:"destructive",onPress:()=>deactivateGalleryImage(item)}]),saving,true)}</View>)}</View>
    <View style={s.card}><Text style={s.cardTitle}>학원 기본 정보 수정</Text>{field("학원명",profileName,setProfileName,"학원명")}{field("지역/구",profileDistrict,setProfileDistrict,"예: 서울 강남구")}{field("주소",profileAddress,setProfileAddress,"사업장 주소")}{field("전화번호",profilePhone,setProfilePhone,"연락처","phone-pad")}{field("대표 홈페이지 URL",profileWebsite,setProfileWebsite,"일반 홈페이지·네이버 블로그·인스타그램 URL (https://)") }<TextInput value={profileDescription} onChangeText={setProfileDescription} placeholder="학원 소개를 입력하세요." multiline style={[s.input,{height:90,textAlignVertical:"top",paddingTop:12,marginTop:10}]}/>{button("기본 정보 저장",saveProfile,saving)}</View>
    <View style={s.card}><Text style={s.cardTitle}>시간표 이미지 등록</Text><Text style={s.body}>글자 입력은 지원하지 않습니다. 시간표가 보이는 이미지 한 장을 선택해 주세요.</Text>{scheduleImage&&<Image source={{uri:scheduleImage.uri}} style={{width:"100%",height:190,marginTop:10,borderRadius:10}} resizeMode="contain"/>}{button(scheduleImage?"시간표 이미지 다시 선택":"시간표 이미지 선택",()=>pickMaterialImage("schedule"),saving)}{button("시간표 이미지 공개",saveSchedule,saving||!scheduleImage)}</View>
    <View style={s.card}><Text style={s.cardTitle}>가격표 이미지 등록</Text><Text style={s.body}>가격과 이용 조건이 표시된 이미지로만 등록할 수 있습니다.</Text>{priceImage&&<Image source={{uri:priceImage.uri}} style={{width:"100%",height:190,marginTop:10,borderRadius:10}} resizeMode="contain"/>}{button(priceImage?"가격표 이미지 다시 선택":"가격표 이미지 선택",()=>pickMaterialImage("price"),saving)}{button("가격표 이미지 공개",savePrice,saving||!priceImage)}</View>
    <View style={s.card}><Text style={s.cardTitle}>공지사항 작성</Text>{field("제목",noticeTitle,setNoticeTitle,"공지 제목") }<TextInput value={noticeBody} onChangeText={setNoticeBody} placeholder="휴강, 모집, 행사 등 공지 내용을 입력하세요." multiline style={[s.input,{height:110,textAlignVertical:"top",paddingTop:12,marginTop:10}]}/>{button("공지사항 등록",saveNotice,saving)}</View>
    <View style={s.card}><Text style={s.cardTitle}>등록한 시간표 및 가격표</Text>{materials.length?materials.map(item=>{const imagePath=item.image_path?supabase?.storage.from("studio-public-materials").getPublicUrl(item.image_path).data.publicUrl:null;return <View key={item.kind+"-"+item.id} style={s.item}><Text style={s.itemTitle}>{item.kind==="schedule"?"시간표 이미지":"가격표 이미지"}</Text>{imagePath&&<Image source={{uri:imagePath}} style={{width:"100%",height:180,borderRadius:10,marginTop:8}} resizeMode="contain"/>}<Text style={s.body}>{item.is_active?"공개 중":"비공개"}</Text>{item.is_active&&button("공개 중단",()=>Alert.alert("공개 중단","이 자료를 비공개로 전환할까요?",[{text:"취소",style:"cancel"},{text:"중단",style:"destructive",onPress:()=>deactivateMaterial(item)}]),saving,true)}</View>}):<Text style={s.body}>등록한 자료가 없습니다.</Text>}</View>
    <View style={s.card}><Text style={s.cardTitle}>수업 관리</Text>
     {field("수업명 *",classTitle,setClassTitle,"예: 성인 기초 발레")}
     <Text style={s.label}>수업 대상</Text><View style={{flexDirection:"row",gap:7,marginTop:6}}>{([{value:"adult",label:"성인"},{value:"kids",label:"키즈"},{value:"all",label:"전체"}] as const).map(option=><Pressable key={option.value} onPress={()=>setClassAudience(option.value)} style={{paddingHorizontal:12,paddingVertical:9,borderRadius:9,backgroundColor:classAudience===option.value?C.purple:C.pale}}><Text style={{fontSize:11,fontWeight:"800",color:classAudience===option.value?"#fff":C.purple}}>{option.label}</Text></Pressable>)}</View>
     {field("수업 수준",classLevel,setClassLevel,"입문 / 초급 / 중급 / 고급")}
     {field("수업 유형",classType,setClassType,"기초 / 포인트 / 발레핏")}
     {field("수업 시간(분)",classDuration,setClassDuration,"60","numeric")}
     {button("수업 등록",saveClass,saving)}
     {ownerClasses.map(item=><View key={item.id} style={s.item}><Text style={s.itemTitle}>{item.title}</Text><Text style={s.body}>{item.audience==="kids"?"키즈":item.audience==="all"?"전체":"성인"} · {item.level||"수준 미입력"} · {item.duration_minutes||60}분</Text>{button(item.is_active?"수업 비공개":"수업 공개",()=>toggleOwnerClass(item),saving)}</View>)}
     {!ownerClasses.length&&<Text style={s.body}>등록된 수업이 없습니다.</Text>}
    </View>
    <View style={s.card}><Text style={s.cardTitle}>할인·혜택 관리</Text>
     {field("혜택명 *",couponTitle,setCouponTitle,"예: 첫 등록 할인")}
     {field("할인 내용 *",couponDiscount,setCouponDiscount,"예: 첫 달 10% 할인")}
     {field("상세 안내",couponDescription,setCouponDescription,"적용 조건 등")}
     {button("혜택 등록",saveCoupon,saving)}
     {ownerCoupons.map(item=><View key={item.id} style={s.item}><Text style={s.itemTitle}>{item.title}</Text><Text style={s.body}>{item.discount_text||item.description||""}</Text>{button(item.is_active?"혜택 비공개":"혜택 공개",()=>toggleOwnerCoupon(item),saving)}</View>)}
     {!ownerCoupons.length&&<Text style={s.body}>등록된 혜택이 없습니다.</Text>}
    </View>
    <View style={s.card}><Text style={s.cardTitle}>수강 인증 코드</Text><Text style={s.body}>실제 수강을 완료한 회원에게만 코드를 전달해 주세요. 회원은 이 코드를 입력해야 학원 리뷰를 작성할 수 있습니다. 코드는 72시간 후 만료되고 한 번만 사용할 수 있습니다.</Text>{!!reviewCode&&<Text selectable style={{fontSize:22,fontWeight:"900",letterSpacing:2,color:C.purple,marginTop:10}}>{reviewCode}</Text>}{button(reviewCodeBusy?"발급 중…":"수강 인증 코드 발급",issueReviewCode,reviewCodeBusy)}</View>
    <View style={s.card}><Text style={s.cardTitle}>공지사항 관리</Text>{notices.length?notices.map(item=><View key={item.id} style={s.item}><Text style={s.itemTitle}>{item.title}</Text><Text style={s.body}>{item.body}</Text>{button(item.is_active?"공지 숨기기":"공지 다시 공개",()=>toggleNotice(item),saving)}</View>):<Text style={s.body}>등록한 공지사항이 없습니다.</Text>}</View>
    <View style={s.card}><Text style={s.cardTitle}>최근 수정 이력</Text>{editHistory.length?editHistory.map(item=><View key={item.id} style={s.item}><Text style={s.itemTitle}>{item.entity==="studios"?"학원 기본 정보":item.entity==="studio_public_prices"?"가격표":item.entity==="studio_public_schedules"?"시간표":"공지사항"} · {item.action==="insert"?"등록":item.action==="delete"?"삭제":"수정"}</Text><Text style={s.body}>{new Date(item.created_at).toLocaleString("ko-KR")} · {(item.changed_fields||[]).map((field:string)=>(({name:"학원명",district:"지역",address:"주소",phone:"전화번호",website_url:"홈페이지",description:"소개",schedule_text:"시간표",amount_krw:"가격",price_period:"가격 기간",frequency_per_week:"주당 횟수",title:"공지 제목",body:"공지 내용",is_active:"공개 상태",expires_at:"만료일"} as Record<string,string>)[field]||field)).join(", ")||"변경 내용"}</Text></View>):<Text style={s.body}>수정 이력이 없습니다.</Text>}</View>
   </>
  :application&&application.status!=="needs_info"?
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
 </ScrollView></KeyboardAvoidingView></SafeAreaView>;
}

const createS = (dark:boolean) => StyleSheet.create(themeStyles({
 safe:{flex:1,backgroundColor:C.bg},content:{padding:16,paddingBottom:40},back:{color:C.muted,fontWeight:"700",paddingVertical:8},
 brand:{fontSize:13,fontWeight:"900",color:C.purple,marginTop:12},title:{fontSize:23,fontWeight:"900",color:C.ink,marginTop:5,marginBottom:14},
 card:{backgroundColor:"#fff",borderRadius:16,borderWidth:1,borderColor:C.line,padding:15,marginTop:12},
 cardTitle:{fontSize:15,fontWeight:"900",color:C.ink,marginBottom:7},body:{fontSize:12,lineHeight:19,color:C.muted,marginTop:5},
 label:{fontSize:12,fontWeight:"800",color:C.ink,marginBottom:6},input:{borderWidth:1,borderColor:C.line,borderRadius:11,paddingHorizontal:12,paddingVertical:11,fontSize:13,color:C.ink,backgroundColor:"#fff"},
 button:{backgroundColor:C.pale,borderRadius:11,minHeight:50,paddingHorizontal:16,paddingVertical:14,alignItems:"center",justifyContent:"center",marginTop:12},buttonText:{fontSize:14,fontWeight:"900",color:C.purple},
 danger:{backgroundColor:"#FFF5F5",borderWidth:1,borderColor:"#E6C5C9"},status:{fontSize:17,fontWeight:"900",color:C.purple,marginVertical:6},
 item:{borderTopWidth:1,borderTopColor:C.line,paddingTop:10,marginTop:10},itemTitle:{fontSize:13,fontWeight:"800",color:C.ink}
},dark));

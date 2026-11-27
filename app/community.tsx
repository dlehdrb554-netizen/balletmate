import React, {useCallback, useEffect, useRef, useState, useMemo} from "react";
import {themeStyles } from "../lib/theme";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Alert, BackHandler, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { SafeAreaView, useSafeAreaInsets } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../lib/supabase";
import { Gesture, GestureDetector } from "react-native-gesture-handler";
import Animated, {runOnJS,useAnimatedStyle,useSharedValue,withSpring} from "react-native-reanimated";

type Category="전체"|"학원 추천"|"발레복 추천"|"자유";
type Post={id:string;author_id:string;author_name:string;category:Exclude<Category,"전체">;title:string;content:string;image_urls:string[];created_at:string};
type Comment={id:string;post_id:string;author_id:string;author_name:string;content:string;created_at:string};
type ComposerBlock={id:string;type:"text"|"image";value?:string;photoIndex?:number};
type RenderBlock={type:"text"|"image";value?:string;photoIndex?:number};
const C={bg:"#FAF9FC",ink:"#252238",muted:"#625E70",purple:"#653BB7",pale:"#F3F0FF",line:"#EAE7F0",red:"#D04444",green:"#18875B"};
const categories:Category[]=["전체","학원 추천","발레복 추천","자유"];
const timeLabel=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?"":date.toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});};
const postDateLabel=(value:string)=>{const date=new Date(value);if(Number.isNaN(date.getTime()))return "";const now=new Date();if(date.getFullYear()===now.getFullYear()&&date.getMonth()===now.getMonth()&&date.getDate()===now.getDate())return "오늘 "+date.toLocaleTimeString("ko-KR",{hour:"2-digit",minute:"2-digit",hour12:false});if(date.getFullYear()===now.getFullYear())return date.toLocaleDateString("ko-KR",{month:"numeric",day:"numeric"});return date.toLocaleDateString("ko-KR",{year:"numeric",month:"2-digit",day:"2-digit"});};
const CAPTION_MARKER="\n\n[BALLET_MATE_PHOTO_CAPTIONS]";
const IMAGE_TOKEN_PREFIX="\uFFFCBM_IMAGE_";
const IMAGE_TOKEN_SUFFIX="\uFFFC";
const serializePostContent=(blocks:ComposerBlock[],captions:string[])=>{
 const body=blocks.map(block=>block.type==="image"?IMAGE_TOKEN_PREFIX+block.photoIndex+IMAGE_TOKEN_SUFFIX:(block.value||"")).join("");
 const entries=captions.map((value,index)=>value.trim()?String(index+1)+"|"+value.trim():"").filter(Boolean);
 return entries.length?body+CAPTION_MARKER+"\n"+entries.join("\n"):body;
};
const parsePostContent=(value:string)=>{
 const marker=value.indexOf(CAPTION_MARKER);
 const body=marker<0?value:value.slice(0,marker);
 const captions=marker<0?[]:value.slice(marker+CAPTION_MARKER.length).split("\n").filter(Boolean).reduce((result,line)=>{const split=line.indexOf("|");if(split>0){const index=Number(line.slice(0,split))-1;if(Number.isInteger(index)&&index>=0)result[index]=line.slice(split+1);}return result;},[] as string[]);
 const blocks:RenderBlock[]=[];
 const token=/\uFFFCBM_IMAGE_(\d+)\uFFFC/g;
 let last=0,match:RegExpExecArray|null;
 while((match=token.exec(body))!==null){if(match.index>last)blocks.push({type:"text",value:body.slice(last,match.index)});blocks.push({type:"image",photoIndex:Number(match[1])});last=token.lastIndex;}
 if(last<body.length||!blocks.length)blocks.push({type:"text",value:body.slice(last)});
 return {body:body.replace(token,""),captions,blocks,hasInlineImages:blocks.some(block=>block.type==="image")};
};
const getComposerText=(blocks:ComposerBlock[])=>blocks.filter(block=>block.type==="text").map(block=>block.value||"").join("");
const getPostImageIndices=(post:Post)=>{const parsed=parsePostContent(post.content);const indices=parsed.hasInlineImages?parsed.blocks.filter(block=>block.type==="image"&&block.photoIndex!==undefined).map(block=>block.photoIndex as number):((post.image_urls||[]).map((_,index)=>index));return indices.filter(index=>index>=0&&index<(post.image_urls||[]).length);};
const cooldownMessage="도배 방지를 위해 작성 후 30초가 지나야 다음 글이나 댓글을 작성할 수 있습니다.";
const COMMUNITY_TERMS_VERSION="2026-11-27-community-policy-1";
const containsSensitiveInfo=(value:string)=>/(?:\b\d{2,3}[- .]?\d{3,4}[- .]?\d{4}\b)|(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,})/i.test(value);
const containsPromotion=(value:string)=>/(https?:\/\/|www\.|무료\s*체험|공동구매|구매\s*문의|홍보|협찬|할인\s*코드)/i.test(value);
const containsAbuse=(value:string)=>/(?:^|[\s.,!?])(?:시발|씨발|병신|개새끼|좆같아|꺼져|죽어)(?=$|[\s.,!?])/i.test(value);

function ZoomablePhoto({uri,onDismiss,onSwipeLeft,onSwipeRight}:{uri:string;onDismiss:()=>void;onSwipeLeft:()=>void;onSwipeRight:()=>void}){
 const scale=useSharedValue(1),savedScale=useSharedValue(1),translateX=useSharedValue(0),translateY=useSharedValue(0),startX=useSharedValue(0),startY=useSharedValue(0);
 const pinch=Gesture.Pinch().onUpdate(event=>{scale.value=Math.max(1,Math.min(4,savedScale.value*event.scale));}).onEnd(()=>{savedScale.value=scale.value;if(scale.value<=1.02){scale.value=withSpring(1);savedScale.value=1;translateX.value=withSpring(0);translateY.value=withSpring(0);}});
 const pan=Gesture.Pan().onStart(()=>{startX.value=translateX.value;startY.value=translateY.value;}).onUpdate(event=>{if(scale.value>1){translateX.value=startX.value+event.translationX;translateY.value=startY.value+event.translationY;}}).onEnd(event=>{if(scale.value>1)return;if(event.translationY>110)runOnJS(onDismiss)();else if(event.translationX<-75)runOnJS(onSwipeLeft)();else if(event.translationX>75)runOnJS(onSwipeRight)();});
 const doubleTap=Gesture.Tap().numberOfTaps(2).onEnd(()=>{if(scale.value>1){scale.value=withSpring(1);savedScale.value=1;translateX.value=withSpring(0);translateY.value=withSpring(0);}else{scale.value=withSpring(2.4);savedScale.value=2.4;}});
 const style=useAnimatedStyle(()=>({transform:[{translateX:translateX.value},{translateY:translateY.value},{scale:scale.value}]}));
 return <GestureDetector gesture={Gesture.Simultaneous(pinch,pan,doubleTap)}><Animated.View style={{width:"100%",height:"100%",alignItems:"center",justifyContent:"center"}}><Animated.Image source={{uri}} resizeMode="contain" style={[{width:"100%",height:"100%"},style]}/></Animated.View></GestureDetector>;
}

export default function Community(){
 const isDark=useColorScheme()==="dark";
  const insets=useSafeAreaInsets();
 const s=useMemo(()=>createS(isDark),[isDark]);
 const router=useRouter();
 const params=useLocalSearchParams<{postId?:string}>();
 const [bookmarkedIds,setBookmarkedIds]=useState<string[]>([]);
 const [posts,setPosts]=useState<Post[]>([]);
 const [category,setCategory]=useState<Category>("전체");
 const [selected,setSelected]=useState<Post|null>(null);
 const [comments,setComments]=useState<Comment[]>([]);
 const [visibleCommentCount,setVisibleCommentCount]=useState(5);
 const [commentText,setCommentText]=useState("");
 const [loading,setLoading]=useState(true);
 const [loadError,setLoadError]=useState(false);
 const [refreshing,setRefreshing]=useState(false);
 const [submitting,setSubmitting]=useState(false);
 const [composer,setComposer]=useState(false);
 const [newCategory,setNewCategory]=useState<Exclude<Category,"전체">>("학원 추천");
 const [title,setTitle]=useState("");
 const [body,setBody]=useState("");
 const [editorBlocks,setEditorBlocks]=useState<ComposerBlock[]>([{id:"text-0",type:"text",value:""}]);
 const activeEditorBlockId=useRef("text-0");
 const editorSelection=useRef({blockId:"text-0",start:0,end:0});
 const [selectedPhotos,setSelectedPhotos]=useState<ImagePicker.ImagePickerAsset[]>([]);
 const [photoCaptions,setPhotoCaptions]=useState<string[]>([]);
 const [viewerIndex,setViewerIndex]=useState<number|null>(null);
 const [userId,setUserId]=useState<string|null>(null);
  const [isAdmin,setIsAdmin]=useState(false);
 const [authorName,setAuthorName]=useState("발레메이트 회원");
 const [blockedUserIds,setBlockedUserIds]=useState<string[]>([]);
 const [termsConsentOpen,setTermsConsentOpen]=useState(false);
 const [termsAccepting,setTermsAccepting]=useState(false);
 const [termsReturnTo,setTermsReturnTo]=useState<"entry"|"post"|"comment">("entry");
 const [finalConfirmed,setFinalConfirmed]=useState(false);
 const termsEntryChecked=useRef(false);
 const commentRequestId=useRef(0);
 const selectedPostIdRef=useRef<string|null>(null);

 const postRequestId=useRef(0);
 const loadPosts=useCallback(async()=>{
  const requestId=++postRequestId.current;
  if(requestId===postRequestId.current)setLoadError(false);
  if(!supabase){if(requestId===postRequestId.current)setLoading(false);return;}
  try{
   let query=supabase.from("community_posts").select("id,author_id,author_name,category,title,content,image_urls,created_at").order("created_at",{ascending:false}).limit(50);
   if(category!=="전체")query=query.eq("category",category);

   const {data,error}=await query;
   if(error)throw error;
   if(requestId===postRequestId.current)setPosts((data||[]) as Post[]);
  }catch(error:any){if(requestId===postRequestId.current){setLoadError(true);Alert.alert("커뮤니티 불러오기 실패",error?.message||"잠시 후 다시 시도해 주세요.");}}
  finally{if(requestId===postRequestId.current){setLoading(false);setRefreshing(false);}}
 },[category]);

 useEffect(()=>{loadPosts();},[loadPosts]);
 useEffect(()=>{
  if(!userId||!supabase||termsEntryChecked.current)return;
  termsEntryChecked.current=true;
  let active=true;
  supabase.from("community_terms_acceptances").select("terms_version").eq("user_id",userId).eq("terms_version",COMMUNITY_TERMS_VERSION).maybeSingle().then(({data,error})=>{
   if(!active)return;
   if(error){Alert.alert("이용규칙 확인 실패",error.message);return;}
   if(!data){setTermsReturnTo("entry");setTermsConsentOpen(true);}
  });
  return()=>{active=false;};
 },[userId]);
 useEffect(()=>{
  if(!selected)return;
  const subscription=BackHandler.addEventListener("hardwareBackPress",()=>{
   commentRequestId.current++;
   selectedPostIdRef.current=null;
   setSelected(null);
   setComments([]);
   setCommentText("");
   return true;
  });
  return()=>subscription.remove();
 },[selected]);
 useEffect(()=>{
  if(!supabase||!userId){setBlockedUserIds([]);return;}
  let active=true;
  supabase.from("community_user_blocks").select("blocked_user_id").eq("blocker_id",userId).then(({data,error})=>{
   if(!active)return;
   if(error){Alert.alert("차단 목록 조회 실패",error.message);return;}
   setBlockedUserIds((data||[]).map(row=>row.blocked_user_id));
  });
  return()=>{active=false;};
 },[userId]);
 useEffect(()=>{
  if(!supabase)return;
  const client=supabase;
  const resolveAuthorName=(user:any)=>{
   const metadata=user?.user_metadata||{};
   const candidate=[metadata.nickname,metadata.display_name,metadata.full_name,metadata.name,metadata.user_name,user?.email?.split("@")[0]].find(value=>typeof value==="string"&&value.trim());
   return String(candidate||"발레메이트 회원").trim().slice(0,40);
  };
  const loadAuthorName=async(user:any)=>{
   if(!user)return "발레메이트 회원";
   try{const {data}=await client.from("user_profiles").select("display_name,username").eq("user_id",user.id).maybeSingle();const displayName=String(data?.display_name||"").trim();if(displayName)return displayName.slice(0,40);const profileName=data?.username;if(profileName&&!String(profileName).startsWith("social_"))return String(profileName).trim().slice(0,40);}catch{}
   const fallback=resolveAuthorName(user);return fallback.startsWith("social_")?"발레메이트 회원":fallback;
  };
  const syncSession=async(user:any)=>{setUserId(user?.id||null);setAuthorName(await loadAuthorName(user));if(user){const {data,error}=await client.rpc("is_balletmate_admin");setIsAdmin(!error&&data===true);}else setIsAdmin(false);};
  client.auth.getSession().then(({data})=>syncSession(data.session?.user));
  const {data:{subscription}}=client.auth.onAuthStateChange((_event,session)=>{void syncSession(session?.user);});
  return()=>subscription.unsubscribe();
 },[]);

 const loadComments=async(postId:string,requestId=++commentRequestId.current)=>{
  if(!supabase)return;
  let query=supabase.from("community_comments").select("id,post_id,author_id,author_name,content,created_at").eq("post_id",postId).order("created_at",{ascending:true}).limit(100);

  const {data,error}=await query;
  if(requestId!==commentRequestId.current||selectedPostIdRef.current!==postId)return;
  if(error){Alert.alert("댓글 불러오기 실패",error.message);return;}
  setComments((data||[]) as Comment[]);
 };
 const openPost=async(post:Post)=>{
  const requestId=++commentRequestId.current;
  selectedPostIdRef.current=post.id;
  setSelected(post);
  setComments([]);
  setVisibleCommentCount(5);
  await loadComments(post.id,requestId);
 };
 const toggleBookmark=async(post:Post)=>{if(!userId||!supabase){requireLogin();return;}const exists=bookmarkedIds.includes(post.id);if(exists){const {error}=await supabase.from("community_post_bookmarks").delete().eq("user_id",userId).eq("post_id",post.id);if(error){Alert.alert("북마크 해제 실패",error.message);return;}setBookmarkedIds(v=>v.filter(id=>id!==post.id));}else{const {error}=await supabase.from("community_post_bookmarks").insert({user_id:userId,post_id:post.id});if(error){Alert.alert("북마크 저장 실패",error.message);return;}setBookmarkedIds(v=>[...v,post.id]);}};
 useEffect(()=>{if(!supabase||!userId)return;supabase.from("community_post_bookmarks").select("post_id").eq("user_id",userId).then(({data})=>setBookmarkedIds((data||[]).map(x=>x.post_id)));},[userId]);
 useEffect(()=>{if(!params.postId||!supabase)return;let active=true;supabase.from("community_posts").select("id,author_id,author_name,category,title,content,image_urls,created_at").eq("id",params.postId).maybeSingle().then(({data,error})=>{if(active&&data&&!error)void openPost(data as Post);});return()=>{active=false;};},[params.postId]);
 const requireLogin=()=>{Alert.alert("로그인이 필요합니다","게시글과 댓글 작성은 가입한 회원만 이용할 수 있습니다.",[{text:"취소",style:"cancel"},{text:"로그인",onPress:()=>router.push("/account")}]);};
 const requireMemberProfile=async()=>{if(!supabase||!userId)return false;const {data,error}=await supabase.from("user_profiles").select("display_name").eq("user_id",userId).maybeSingle();if(error){Alert.alert("회원 정보 확인 실패",error.message);return false;}if(!String(data?.display_name||"").trim()){Alert.alert("회원정보 등록 필요","게시글과 댓글을 작성하려면 회원정보 등록을 완료해 주세요.",[{text:"취소",style:"cancel"},{text:"등록하기",onPress:()=>router.push("/onboarding")}]);return false;}return true;};
 const explainError=(error:any)=>{
  const message=String(error?.message||"");
  const constraint=String(error?.constraint||"");
  if(message.includes("30초")||message.includes("P0001"))Alert.alert("잠시만 기다려 주세요",cooldownMessage);
  else if(message.includes("42501")||message.toLowerCase().includes("row-level security"))Alert.alert("로그인이 필요합니다","회원 로그인 후 작성할 수 있습니다.");
  else if(error?.code==="23514"&&/community_posts_(content|contents)_check/i.test(constraint+" "+message))Alert.alert("게시글 내용 확인","제목과 내용은 각각 최소 2자 이상 입력해야 합니다. 공백만 입력한 경우 글자로 인정되지 않습니다.");
  else Alert.alert("작성 실패",message||"잠시 후 다시 시도해 주세요.");
 };

 const pickPhotos=async()=>{
  if(selectedPhotos.length>=4){Alert.alert("사진 첨부","게시글 사진은 최대 4장까지 첨부할 수 있습니다.");return;}
  const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:["images"],allowsMultipleSelection:true,selectionLimit:4-selectedPhotos.length,quality:0.85});
  if(result.canceled||!result.assets.length)return;
  const assets=result.assets.slice(0,4-selectedPhotos.length);
  const startIndex=selectedPhotos.length;
  setSelectedPhotos(current=>[...current,...assets].slice(0,4));
  setPhotoCaptions(current=>[...current,...assets.map(()=>"")].slice(0,4));
  setEditorBlocks(current=>{
   const next=[...current];
   let insertAt=next.findIndex(block=>block.id===activeEditorBlockId.current&&block.type==="text");
   if(insertAt<0)insertAt=next.length-1;
   const active=next[insertAt];
   const original=active?.value||"";
   const selection=editorSelection.current.blockId===active?.id?editorSelection.current:{blockId:active?.id||"",start:original.length,end:original.length};
   const splitAt=Math.max(0,Math.min(original.length,selection.start));
   if(active)next[insertAt]={...active,value:original.slice(0,splitAt)};
   const trailing=original.slice(Math.max(splitAt,selection.end));
   const additions:ComposerBlock[]=[];
   assets.forEach((_,offset)=>additions.push({id:"image-"+(startIndex+offset)+"-"+Date.now()+"-"+offset,type:"image",photoIndex:startIndex+offset}));
   const trailingBlock:ComposerBlock={id:"text-"+Date.now()+"-after-"+Math.random().toString(36).slice(2,6),type:"text",value:trailing};
   additions.push(trailingBlock);
   next.splice(insertAt+1,0,...additions);
   activeEditorBlockId.current=trailingBlock.id;
   editorSelection.current={blockId:trailingBlock.id,start:0,end:0};
   return next;
  });
 };
 const updateEditorText=(id:string,value:string)=>{
  const next=editorBlocks.map(block=>block.id===id?{...block,value}:block);
  setEditorBlocks(next);setBody(getComposerText(next));setFinalConfirmed(false);
 };
 const removeComposerPhoto=(index:number)=>{
  const next=editorBlocks.filter(block=>block.type!=="image"||block.photoIndex!==index).map(block=>block.type==="image"&&block.photoIndex!==undefined&&block.photoIndex>index?{...block,photoIndex:block.photoIndex-1}:block);
  setEditorBlocks(next);setBody(getComposerText(next));
  setSelectedPhotos(current=>current.filter((_,i)=>i!==index));
  setPhotoCaptions(current=>current.filter((_,i)=>i!==index));
  setFinalConfirmed(false);
 };
 const uploadCommunityPhotos=async()=>{
  if(!supabase||!userId)return {urls:[] as string[],paths:[] as string[]};
  const urls:string[]=[],paths:string[]=[];
  try{
   for(let index=0;index<selectedPhotos.length;index++){
    const asset=selectedPhotos[index];
    const optimized=await ImageManipulator.manipulateAsync(asset.uri,[{resize:{width:1600}}],{compress:0.82,format:ImageManipulator.SaveFormat.JPEG});
    const response=await fetch(optimized.uri);
    if(!response.ok)throw new Error("사진 파일을 읽지 못했습니다.");
    const bytes=await response.arrayBuffer();
    const path=`${userId}/${Date.now()}-${index}-${Math.random().toString(36).slice(2,8)}.jpg`;
    const {error}=await supabase.storage.from("community-photos").upload(path,bytes,{contentType:"image/jpeg",upsert:false});
    if(error)throw error;
    paths.push(path);
    urls.push(supabase.storage.from("community-photos").getPublicUrl(path).data.publicUrl);
   }
   return {urls,paths};
  }catch(error){
   if(paths.length)await supabase.storage.from("community-photos").remove(paths);
   throw error;
  }
 };
 const submitPost=async()=>{
  if(!userId){requireLogin();return;}
  if(!supabase||!(await requireMemberProfile()))return;
  const plainBody=getComposerText(editorBlocks);const serializedContent=serializePostContent(editorBlocks,photoCaptions);if(title.trim().length<2||plainBody.trim().length<2){Alert.alert("내용 확인","제목과 내용은 각각 2자 이상 입력해 주세요.");return;}if(title.trim().length>80||plainBody.length+photoCaptions.join("").length>5000){Alert.alert("내용 확인","제목은 최대 80자, 사진 설명을 포함한 내용은 최대 5,000자까지 입력할 수 있습니다.");return;}if(!finalConfirmed){Alert.alert("게시 전 확인","개인정보와 저작권·초상권, 커뮤니티 운영정책을 확인해 주세요.");return;}
  setSubmitting(true);
  let uploadedPaths:string[]=[];
  try{
   const uploaded=await uploadCommunityPhotos();uploadedPaths=uploaded.paths;
   const {error}=await supabase.from("community_posts").insert({author_id:userId,author_name:authorName,category:newCategory,title:title.trim(),content:serializedContent,image_urls:uploaded.urls});
   if(error)throw error;
   setComposer(false);setTitle("");setBody("");setEditorBlocks([{id:"text-0",type:"text",value:""}]);activeEditorBlockId.current="text-0";setSelectedPhotos([]);setPhotoCaptions([]);setLoading(true);
   if(category!=="전체")setCategory("전체");else await loadPosts();
   Alert.alert("등록 완료","게시글이 등록되었습니다.");
  }catch(error:any){
   if(uploadedPaths.length)await supabase.storage.from("community-photos").remove(uploadedPaths).catch(()=>{});
   explainError(error);
  }finally{setSubmitting(false);}
 };
 const submitComment=async()=>{
  if(!userId){requireLogin();return;}
  const client=supabase;
  if(!client||!selected||!(await requireMemberProfile()))return;
  const accepted=await client.from("community_terms_acceptances").select("terms_version").eq("user_id",userId).eq("terms_version",COMMUNITY_TERMS_VERSION).maybeSingle();
  if(accepted.error){Alert.alert("이용규칙 확인 실패",accepted.error.message);return;}
  if(!accepted.data){setTermsReturnTo("comment");setTermsConsentOpen(true);return;}
  if(!commentText.trim()){Alert.alert("댓글 내용","댓글을 입력해 주세요.");return;}
  setSubmitting(true);
  try{
   const {error}=await client.from("community_comments").insert({post_id:selected.id,author_id:userId,author_name:authorName,content:commentText.trim()});
   if(error)throw error;
   setCommentText("");await loadComments(selected.id);
   Alert.alert("등록 완료","댓글이 등록되었습니다.");
  }catch(error:any){explainError(error);}
  finally{setSubmitting(false);}
 };

 const openComposer=async()=>{
  if(!userId){requireLogin();return;}
  const client=supabase;
  if(!client||!(await requireMemberProfile()))return;
  const {data,error}=await client.from("community_terms_acceptances").select("terms_version").eq("user_id",userId).eq("terms_version",COMMUNITY_TERMS_VERSION).maybeSingle();
  if(error){Alert.alert("이용규칙 확인 실패",error.message);return;}
  if(data){setFinalConfirmed(false);setComposer(true);return;}
  setTermsReturnTo("post");setTermsConsentOpen(true);
 };
 const acceptCommunityTerms=async()=>{
  const client=supabase;
  if(!client||!userId||termsAccepting)return;
  setTermsAccepting(true);
  try{
   const {error}=await client.from("community_terms_acceptances").insert({user_id:userId,terms_version:COMMUNITY_TERMS_VERSION});
   if(error&&error.code!=="23505")throw error;
   setTermsConsentOpen(false);
   if(termsReturnTo==="post"){setFinalConfirmed(false);setComposer(true);}
   else if(termsReturnTo==="comment")await submitComment();
  }catch(error:any){Alert.alert("동의 처리 실패",error?.message||"이용규칙 동의를 저장하지 못했습니다.");}
  finally{setTermsAccepting(false);}
 };
 const reportContent=(contentType:"post"|"comment",contentId:string,targetUserId:string)=>{
  const client=supabase;
  if(!userId||!client){requireLogin();return;}
  if(targetUserId===userId){Alert.alert("신고 불가","본인이 작성한 콘텐츠는 신고할 수 없습니다.");return;}
  const reasons=["스팸/광고","욕설/괴롭힘","개인정보 노출","저작권·초상권 침해","허위 정보","부적절한 콘텐츠","기타"];
  Alert.alert("콘텐츠 신고","신고 사유를 선택해 주세요.",[
   {text:"취소",style:"cancel"},
   ...reasons.map(reason=>({text:reason,onPress:async()=>{
    const {error}=await client.from("community_reports").insert({reporter_id:userId,target_user_id:targetUserId,content_type:contentType,content_id:contentId,reason,details:""});
    if(error){Alert.alert("신고 실패",error.code==="23505"?"이미 신고한 콘텐츠입니다.":error.message);return;}
    Alert.alert("신고 접수","신고가 접수되었습니다. 운영자가 검토하겠습니다.");
   }}))
  ]);
 };
 const blockUser=(targetUserId:string,targetName:string)=>{
  const client=supabase;
  if(!userId||!client){requireLogin();return;}
  if(targetUserId===userId)return;
  Alert.alert("사용자 차단",targetName+" 회원의 게시글과 댓글을 내 화면에서 숨길까요?",[
   {text:"취소",style:"cancel"},
   {text:"차단",style:"destructive",onPress:async()=>{
    const {error}=await client.from("community_user_blocks").insert({blocker_id:userId,blocked_user_id:targetUserId});
    if(error&&error.code!=="23505"){Alert.alert("차단 실패",error.message);return;}
    setBlockedUserIds(current=>current.includes(targetUserId)?current:[...current,targetUserId]);
    if(selected?.author_id===targetUserId){commentRequestId.current++;selectedPostIdRef.current=null;setSelected(null);setComments([]);}
    else if(selected){setComments(current=>current.filter(comment=>comment.author_id!==targetUserId));}
    Alert.alert("차단 완료","해당 회원의 콘텐츠를 숨겼습니다.");
   }}
  ]);
 };
 const removePost=async(post:Post)=>{
  const client=supabase;
  if(!client||(post.author_id!==userId&&!isAdmin))return;
  Alert.alert("게시글 삭제","이 게시글을 삭제할까요?",[{text:"취소",style:"cancel"},{text:"삭제",style:"destructive",onPress:async()=>{
   const {error}=await client.from("community_posts").delete().eq("id",post.id);
   if(error){Alert.alert("삭제 실패",error.message);return;}
   const paths=(post.image_urls||[]).map(url=>{const marker="/community-photos/";const index=url.indexOf(marker);return index>=0?decodeURIComponent(url.slice(index+marker.length)):"";}).filter(Boolean);
   if(paths.length)await client.storage.from("community-photos").remove(paths);
   commentRequestId.current++;selectedPostIdRef.current=null;setSelected(null);setComments([]);loadPosts();
  }}]);
 };
 const removeComment=async(comment:Comment)=>{
  const client=supabase;
  if(!client||(comment.author_id!==userId&&!isAdmin))return;
  const postId=selectedPostIdRef.current;
  if(!postId||comment.post_id!==postId)return;
  Alert.alert("댓글 삭제","이 댓글을 삭제할까요?",[{text:"취소",style:"cancel"},{text:"삭제",style:"destructive",onPress:async()=>{
   try{
    const {error}=await client.from("community_comments").delete().eq("id",comment.id);
    if(error)throw error;
    if(selectedPostIdRef.current===postId)await loadComments(postId);
   }catch(error:any){Alert.alert("댓글 처리 실패",error?.message||"댓글을 삭제하거나 새로고침하지 못했습니다.");}
  }}]);
 };

 const visibleComments=comments.filter(comment=>!blockedUserIds.includes(comment.author_id));

 return <SafeAreaView style={s.safe}>
  <View style={s.header}>
   <Pressable onPress={()=>{if(selected){commentRequestId.current++;selectedPostIdRef.current=null;setSelected(null);setComments([]);}else router.replace("/");}}><><Ionicons name="chevron-back" size={16} color={C.muted} /><Text style={s.back}>{selected?"목록":"지도"}</Text></></Pressable>
   <Text style={s.heading}>발레 커뮤니티</Text>
   <View style={{flexDirection:"row",alignItems:"center"}}><Pressable style={s.writeBtn} onPress={openComposer}><Text style={s.writeText}>＋ 글쓰기</Text></Pressable><Pressable style={s.menuBtn} onPress={()=>router.replace("/")}><Ionicons name="menu-outline" size={22} color={C.ink} /></Pressable></View>
  </View>
  {selected?
   <ScrollView contentContainerStyle={s.detailContent} keyboardShouldPersistTaps="handled">
    <View style={s.postDetail}>
     <View style={s.categoryBadge}><Text style={s.categoryText}>{selected.category}</Text></View>
     <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between"}}><Text style={[s.postTitle,{flex:1}]}>{selected.title}</Text><Pressable onPress={()=>void toggleBookmark(selected)} accessibilityRole="button" accessibilityLabel={bookmarkedIds.includes(selected.id)?"북마크 해제":"북마크 저장"}><Ionicons name={bookmarkedIds.includes(selected.id)?"bookmark":"bookmark-outline"} size={22} color={C.purple}/></Pressable></View>
     <Text style={s.meta}>{selected.author_name||"발레메이트 회원"} · {timeLabel(selected.created_at)}</Text>
     {parsePostContent(selected.content).hasInlineImages?<View style={s.inlinePostBody}>{parsePostContent(selected.content).blocks.map((block,index)=>block.type==="image"&&block.photoIndex!==undefined&&selected.image_urls[block.photoIndex]?<View key={"photo-"+index} style={s.detailPhotoItem}><Pressable onPress={()=>setViewerIndex(getPostImageIndices(selected).indexOf(block.photoIndex!))} accessibilityRole="button" accessibilityLabel={"사진 "+(block.photoIndex+1)+" 크게 보기"}><Image source={{uri:selected.image_urls[block.photoIndex]}} style={s.detailPhoto} resizeMode="cover"/></Pressable>{Boolean(parsePostContent(selected.content).captions[block.photoIndex])&&<Text style={s.photoCaption}>{parsePostContent(selected.content).captions[block.photoIndex]}</Text>}</View>:<Text key={"text-"+index} style={s.inlinePostText}>{block.value}</Text>)}</View>:<><Text style={s.postBody}>{parsePostContent(selected.content).body}</Text>{!!selected.image_urls?.length&&<View style={s.detailPhotoList}>{selected.image_urls.map((url,index)=><View key={url} style={s.detailPhotoItem}><Pressable onPress={()=>setViewerIndex(index)} accessibilityRole="button" accessibilityLabel={"사진 "+(index+1)+" 크게 보기"}><Image source={{uri:url}} style={s.detailPhoto} resizeMode="cover"/></Pressable>{Boolean(parsePostContent(selected.content).captions[index])&&<Text style={s.photoCaption}>{parsePostContent(selected.content).captions[index]}</Text>}</View>)}</View>}</>}
     {selected.author_id===userId||isAdmin?<Pressable onPress={()=>removePost(selected)}><Text style={s.deleteText}>{isAdmin&&selected.author_id!==userId?"관리자 삭제":"게시글 삭제"}</Text></Pressable>:<View style={s.moderationActions}><Pressable onPress={()=>reportContent("post",selected.id,selected.author_id)}><Text style={s.deleteText}>작성자·콘텐츠 신고</Text></Pressable><Pressable onPress={()=>blockUser(selected.author_id,selected.author_name||"해당")}><Text style={s.deleteText}>차단</Text></Pressable></View>}
    </View>
    <Text style={s.section}>댓글 {visibleComments.length}</Text>
    {visibleComments.slice(0,visibleCommentCount).map(comment=><View key={comment.id} style={s.comment}>
     <View style={s.commentTop}><Text style={s.commentAuthor}>{comment.author_name||"발레메이트 회원"}</Text><Text style={s.meta}>{timeLabel(comment.created_at)}</Text></View>
     <Text style={s.commentBody}>{comment.content}</Text>
     {comment.author_id===userId||isAdmin?<Pressable onPress={()=>removeComment(comment)}><Text style={s.deleteText}>{isAdmin&&comment.author_id!==userId?"관리자 삭제":"삭제"}</Text></Pressable>:<View style={s.moderationActions}><Pressable onPress={()=>reportContent("comment",comment.id,comment.author_id)}><Text style={s.deleteText}>작성자·콘텐츠 신고</Text></Pressable><Pressable onPress={()=>blockUser(comment.author_id,comment.author_name||"해당")}><Text style={s.deleteText}>차단</Text></Pressable></View>}
    </View>)}
    {!visibleComments.length&&<Text style={s.empty}>첫 댓글을 남겨보세요.</Text>}
    {visibleCommentCount<visibleComments.length&&<Pressable onPress={()=>setVisibleCommentCount(count=>Math.min(count+5,visibleComments.length))} style={{alignItems:"center",paddingVertical:13,marginBottom:4}}><Text style={s.openLabel}>댓글 {Math.min(5,visibleComments.length-visibleCommentCount)}개 더 보기 · 남은 {visibleComments.length-visibleCommentCount}개</Text></Pressable>}
    <View style={s.commentComposer}>
     <TextInput style={s.commentInput} value={commentText} onChangeText={setCommentText} placeholder={userId?"댓글을 입력하세요":"로그인 후 댓글을 작성할 수 있어요"} multiline maxLength={1000}/>
     <Pressable style={[s.sendBtn,submitting&&{opacity:.5}]} disabled={submitting} onPress={submitComment}><Text style={s.sendText}>등록</Text></Pressable>
    </View>
    <Text style={s.cooldownNote}>게시글과 댓글은 도배 방지를 위해 작성 간격이 30초로 제한됩니다.</Text>
   </ScrollView>
   :
   <>
    <Text style={s.intro}>학원 경험과 발레복 정보를 서로 나눠보세요.</Text>
    <ScrollView horizontal showsHorizontalScrollIndicator={false} style={s.filterScroll} contentContainerStyle={s.filters}>
     {categories.map(item=><Pressable key={item} onPress={()=>setCategory(item)} style={[s.filter,item===category&&s.filterActive]}><Text style={[s.filterText,item===category&&s.filterTextActive]}>{item}</Text></Pressable>)}
    </ScrollView>
    {loading?<ActivityIndicator color={C.purple} style={{marginTop:40}}/>:
     <FlatList data={posts.filter(item=>!blockedUserIds.includes(item.author_id))} keyExtractor={item=>item.id} contentContainerStyle={s.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>{setRefreshing(true);loadPosts();}} tintColor={C.purple}/>} renderItem={({item})=><Pressable style={s.postCard} onPress={()=>openPost(item)}>
      <View style={s.postTop}><View style={s.categoryBadge}><Text style={s.categoryText}>{item.category}</Text></View><Text style={s.meta}>{postDateLabel(item.created_at)}</Text></View>
      <Text style={s.cardTitle} numberOfLines={2}>{item.title}</Text>
      <Text style={s.preview} numberOfLines={2}>{parsePostContent(item.content).body}</Text>
      {!!item.image_urls?.length&&<View style={s.postPhotos}>{item.image_urls.slice(0,2).map((url,index)=><Image key={url} source={{uri:url}} style={s.listPhoto} resizeMode="cover"/>)}</View>}
      <View style={s.cardFoot}><Text style={s.author}>{item.author_name||"발레메이트 회원"}</Text><View style={{flexDirection:"row",alignItems:"center",gap:12}}><Pressable onPress={(event:any)=>{event.stopPropagation?.();void toggleBookmark(item);}} accessibilityRole="button" accessibilityLabel={bookmarkedIds.includes(item.id)?"북마크 해제":"북마크 저장"}><Ionicons name={bookmarkedIds.includes(item.id)?"bookmark":"bookmark-outline"} size={18} color={C.purple}/></Pressable><Text style={s.openLabel}>댓글 보기 ›</Text></View></View>
     </Pressable>} ListEmptyComponent={loadError?<View><Text style={s.empty}>게시글을 불러오지 못했습니다.</Text><Pressable onPress={()=>{setLoading(true);loadPosts();}}><Text style={s.openLabel}>다시 시도</Text></Pressable></View>:<Text style={s.empty}>아직 게시글이 없습니다. 첫 추천을 남겨보세요!</Text>}/>
    }
   </>
  }

  <Modal visible={viewerIndex!==null&&!!selected?.image_urls?.length} transparent animationType="fade" onRequestClose={()=>setViewerIndex(null)}>
   <View style={s.viewerRoot}>
    <View style={s.viewerHeader}><Pressable style={s.viewerControl} onPress={()=>setViewerIndex(null)} accessibilityRole="button" accessibilityLabel="사진 보기 닫기"><Ionicons name="close" size={25} color="#FFFFFF"/></Pressable><Text style={s.viewerCounter}>{viewerIndex===null?0:viewerIndex+1} / {selected?getPostImageIndices(selected).length:0}</Text><View style={s.viewerControl}/></View>
    {viewerIndex!==null&&selected&&getPostImageIndices(selected)[viewerIndex]!==undefined&&<ZoomablePhoto uri={selected.image_urls[getPostImageIndices(selected)[viewerIndex]]} onDismiss={()=>setViewerIndex(null)} onSwipeLeft={()=>setViewerIndex(index=>index===null?null:Math.min(getPostImageIndices(selected).length-1,index+1))} onSwipeRight={()=>setViewerIndex(index=>index===null?null:Math.max(0,index-1))}/>}
    <View style={s.viewerFooter}>
     <Pressable style={s.viewerNavButton} disabled={viewerIndex===null||viewerIndex===0} onPress={()=>setViewerIndex(index=>index===null?null:Math.max(0,index-1))}><Ionicons name="chevron-back" size={25} color={viewerIndex===0?"#777":"#FFFFFF"}/></Pressable>
     <Text style={s.viewerHint}>두 손가락 확대 · 두 번 탭으로 확대/축소</Text>
     <Pressable style={s.viewerNavButton} disabled={viewerIndex===null||viewerIndex>=(selected?getPostImageIndices(selected).length:1)-1} onPress={()=>setViewerIndex(index=>index===null?null:Math.min((selected?getPostImageIndices(selected).length:1)-1,index+1))}><Ionicons name="chevron-forward" size={25} color={viewerIndex===(selected?getPostImageIndices(selected).length:1)-1?"#777":"#FFFFFF"}/></Pressable>
    </View>
   </View>
  </Modal>

  <Modal visible={termsConsentOpen} transparent animationType="fade" onRequestClose={()=>setTermsConsentOpen(false)}>
   <View style={[s.shade,{paddingBottom:insets.bottom}]}><View style={[s.modal,{maxHeight:"88%",paddingBottom:Math.max(24,insets.bottom+16)}]}>
    <View style={s.modalHead}><Text style={s.modalTitle}>커뮤니티 첫 이용 안내</Text><Pressable onPress={()=>setTermsConsentOpen(false)}><Text style={s.close}>×</Text></Pressable></View>
    <ScrollView style={{marginTop:12}} contentContainerStyle={s.rulesContent} showsVerticalScrollIndicator={false}>
     <Text style={s.rulesIntro}>서로의 발레 경험을 편안하게 나눌 수 있도록 아래 네 가지 약속을 확인해 주세요. 동의하면 게시글과 댓글을 작성할 수 있습니다.</Text>
     {["서로 존중하는 표현을 사용하고 욕설·비방·괴롭힘은 피해 주세요.","학원·상품 광고는 허용된 안내 범위를 지키고 반복 홍보나 도배는 삼가 주세요.","본인과 타인의 전화번호·주소·계정정보 등 개인정보는 공개하지 말아 주세요.","사진과 글은 저작권·초상권 등 필요한 권리와 동의를 확인한 뒤 올려 주세요."].map((rule,index)=><View key={index} style={s.ruleRow}><Text style={s.ruleNumber}>{index+1}</Text><Text style={s.ruleText}>{rule}</Text></View>)}
    </ScrollView>
    <Pressable style={s.termsFullLink} onPress={()=>router.push("/community-policy")}><Text style={s.openLabel}>커뮤니티 운영정책 전체보기</Text></Pressable>
    <Pressable style={[s.submitBtn,termsAccepting&&{opacity:.5}]} disabled={termsAccepting} onPress={acceptCommunityTerms}><Text style={s.submitText}>{termsAccepting?"저장 중…":termsReturnTo==="comment"?"동의하고 댓글 등록":termsReturnTo==="post"?"동의하고 글쓰기":"동의하고 커뮤니티 이용"}</Text></Pressable>
    <Pressable style={s.legacyLink} onPress={()=>setTermsConsentOpen(false)}><Text style={s.legacyLinkText}>동의하지 않음</Text></Pressable>
   </View></View>
  </Modal>

  <Modal visible={composer} transparent animationType="slide" onRequestClose={()=>setComposer(false)}>
   <KeyboardAvoidingView style={[s.shade,{paddingBottom:insets.bottom}]} behavior={Platform.OS==="ios"?"padding":"height"} keyboardVerticalOffset={0}>
    <View style={[s.modal,{maxHeight:"90%",paddingBottom:Math.max(24,insets.bottom+16)}]}>
     <View style={s.composerHeader}><Pressable onPress={()=>setComposer(false)} accessibilityRole="button" accessibilityLabel="글쓰기 닫기" style={s.composerClose}><Text style={s.close}>×</Text></Pressable><Text style={s.modalTitle}>새 게시글</Text><Pressable style={[s.composerSubmit,submitting&&{opacity:.5}]} disabled={submitting} onPress={submitPost} accessibilityRole="button" accessibilityLabel="게시글 등록"><Text style={s.composerSubmitText}>{submitting?"등록 중…":"등록"}</Text></Pressable></View>
     <ScrollView style={{flexShrink:1}} contentContainerStyle={{paddingBottom:8}} keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator>
     <View style={s.writerGuide}><Text style={s.writerGuideTitle}>도움이 되는 글쓰기</Text><Text style={s.writerGuideText}>지역·수업 수준·수업 시간·가격대처럼 다른 회원이 참고할 정보를 함께 적어주시면 좋아요.</Text><Pressable onPress={()=>router.push("/community-policy")}><Text style={s.writerGuideLink}>작성 예시와 운영 기준 보기 ›</Text></Pressable></View>
     <Text style={s.label}>게시판 선택</Text>
     <View style={s.categoryChoices}>{(["학원 추천","발레복 추천","자유"] as const).map(item=><Pressable key={item} onPress={()=>setNewCategory(item)} style={[s.filter,newCategory===item&&s.filterActive]}><Text style={[s.filterText,newCategory===item&&s.filterTextActive]}>{item}</Text></Pressable>)}</View>
     <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between"}}><Text style={s.label}>제목 <Text style={{fontSize:10,color:C.muted,fontWeight:"500"}}>(최소 2자)</Text></Text><Text style={{fontSize:11,color:C.muted}}>{title.length}/80자</Text></View>
     <View style={s.inputWithClear}><TextInput style={[s.titleInput,{flex:1}]} value={title} onChangeText={value=>{setTitle(value);setFinalConfirmed(false);}} placeholder="예: 성인 초급 발레 학원 추천 부탁드려요" maxLength={80} returnKeyType="next"/>{!!title&&<Pressable style={s.clearField} onPress={()=>{setTitle("");setFinalConfirmed(false);}} accessibilityRole="button" accessibilityLabel="제목 전체 삭제"><Ionicons name="close-circle" size={19} color={C.muted}/></Pressable>}</View>
     <View style={{flexDirection:"row",alignItems:"center",justifyContent:"space-between"}}><Text style={s.label}>내용 <Text style={{fontSize:10,color:C.muted,fontWeight:"500"}}>(최소 2자)</Text></Text><Text style={{fontSize:11,color:C.muted}}>{body.length}/5,000자</Text></View>
     <View style={s.inlineEditor}>
      {editorBlocks.map((block,index)=>block.type==="text"?<View key={block.id} style={s.editorTextBlock}><TextInput style={s.editorTextInput} autoFocus={block.id===activeEditorBlockId.current} value={block.value||""} onFocus={()=>{activeEditorBlockId.current=block.id;}} onSelectionChange={({nativeEvent})=>{editorSelection.current={blockId:block.id,start:nativeEvent.selection.start,end:nativeEvent.selection.end};}} onChangeText={value=>updateEditorText(block.id,value)} placeholder={index===0?(newCategory==="학원 추천"?"지역, 수업 수준, 수업 시간, 가격, 시설 경험을 적어주세요.":newCategory==="발레복 추천"?"제품명, 사이즈, 착용감, 가격, 구매처를 적어주세요.":"경험과 의견을 구체적으로 나눠주세요."):"사진 다음 내용을 이어서 작성하세요."} multiline textAlignVertical="top" maxLength={5000}/></View>:<View key={block.id} style={s.inlineEditorPhoto}>
       <View style={s.inlineEditorPhotoHead}><Text style={s.inlinePhotoLabel}>본문 사진 {Number(block.photoIndex)+1}</Text><Pressable style={s.inlineRemoveButton} onPress={()=>removeComposerPhoto(block.photoIndex||0)} accessibilityRole="button" accessibilityLabel="본문 사진 삭제"><Ionicons name="trash-outline" size={17} color={C.red}/><Text style={s.inlineRemoveText}>삭제</Text></Pressable></View>
       {selectedPhotos[block.photoIndex||0]&&<Image source={{uri:selectedPhotos[block.photoIndex||0].uri}} style={s.inlineEditorImage} resizeMode="cover"/>}
       <TextInput style={s.captionInput} value={photoCaptions[block.photoIndex||0]||""} onChangeText={value=>{const photoIndex=block.photoIndex||0;setPhotoCaptions(current=>current.map((caption,i)=>i===photoIndex?value:caption));setFinalConfirmed(false);}} placeholder="이 사진에 대한 설명을 입력하세요" maxLength={200}/>
      </View>)}
     </View>
     <View style={s.photoPickerRow}><View style={s.photoPickerHeader}><Text style={s.photoPickerText}>본문 사진 ({selectedPhotos.length}/4)</Text><Pressable style={s.addPhotoButton} onPress={pickPhotos} disabled={selectedPhotos.length>=4} accessibilityRole="button" accessibilityLabel="본문에 사진 삽입"><Ionicons name="image-outline" size={17} color={C.purple}/><Text style={s.addPhotoText}>본문에 사진 삽입</Text></Pressable></View><Text style={s.editorHint}>사진을 추가하면 현재 작성 중인 문단 바로 아래에 들어가며, 아래에서 설명을 이어 쓸 수 있어요.</Text></View>
     {(containsSensitiveInfo(title+" "+body+" "+photoCaptions.join(" "))||containsPromotion(title+" "+body+" "+photoCaptions.join(" "))||containsAbuse(title+" "+body+" "+photoCaptions.join(" ")))&&<View style={s.inlineWarning}><Text style={s.inlineWarningTitle}>게시 전 한 번 더 확인해 주세요</Text>{containsSensitiveInfo(title+" "+body+" "+photoCaptions.join(" "))&&<Text style={s.inlineWarningText}>전화번호나 이메일처럼 보이는 정보가 있어요. 본인과 타인의 개인정보가 포함되지 않았는지 확인해 주세요.</Text>}{containsPromotion(title+" "+body+" "+photoCaptions.join(" "))&&<Text style={s.inlineWarningText}>광고·홍보성 표현이나 외부 링크가 감지됐어요. 정보 공유 목적의 글인지 운영정책을 확인해 주세요.</Text>}{containsAbuse(title+" "+body+" "+photoCaptions.join(" "))&&<Text style={s.inlineWarningText}>공격적인 표현이 포함된 것 같아요. 서로 존중하는 표현으로 다듬어 주세요.</Text>}</View>}
     <Pressable style={s.finalCheck} onPress={()=>setFinalConfirmed(value=>!value)} accessibilityRole="checkbox" accessibilityState={{checked:finalConfirmed}}><View style={[s.checkBox,finalConfirmed&&s.checkBoxActive]}>{finalConfirmed&&<Ionicons name="checkmark" size={14} color="#FFFFFF"/>}</View><Text style={s.finalCheckText}>개인정보와 저작권·초상권을 확인했고, 커뮤니티 운영정책을 지키는 글임을 확인합니다.</Text></Pressable>
     <Text style={s.cooldownNote}>제목·내용 각각 최소 2자, 최대 80자·5,000자입니다. 등록 후 30초 동안 댓글을 포함한 새 작성이 제한됩니다.</Text>
     </ScrollView>
    </View>
   </KeyboardAvoidingView>
  </Modal>
 </SafeAreaView>;
}

const createS = (dark:boolean) => StyleSheet.create(themeStyles({postPhotos:{flexDirection:"row",flexWrap:"wrap",gap:8,marginTop:10},detailPhotoList:{gap:14,marginTop:16},detailPhotoItem:{width:"100%"},detailPhoto:{width:"100%",height:230,borderRadius:12,backgroundColor:"#EEEAF4"},photoCaption:{fontSize:13,lineHeight:19,color:C.muted,marginTop:7},photoPickerHeader:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"},photoEditorItem:{width:104,gap:6},addPhotoButton:{minHeight:44,minWidth:104,paddingHorizontal:12,borderRadius:10,borderWidth:1,borderColor:C.purple,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:3},addPhotoText:{fontSize:11,fontWeight:"800",color:C.purple},captionInput:{height:42,borderWidth:1,borderColor:C.line,borderRadius:8,paddingHorizontal:8,fontSize:11,color:C.ink},viewerRoot:{flex:1,backgroundColor:"#08070B",justifyContent:"space-between"},viewerHeader:{height:58,paddingHorizontal:16,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},viewerControl:{width:44,height:44,alignItems:"center",justifyContent:"center"},viewerCounter:{fontSize:13,fontWeight:"800",color:"#FFFFFF"},viewerImage:{width:"100%",height:"100%"},viewerFooter:{minHeight:64,paddingHorizontal:12,flexDirection:"row",alignItems:"center",justifyContent:"space-between"},viewerNavButton:{width:48,height:48,alignItems:"center",justifyContent:"center"},viewerHint:{fontSize:11,color:"#C7C2CE"},listPhoto:{width:88,height:68,borderRadius:8,backgroundColor:"#EEEAF4"},photoPickerRow:{marginTop:10},photoSlots:{gap:9},photoPickerText:{fontSize:12,fontWeight:"800",color:C.purple},photoSlotList:{flexDirection:"row",flexWrap:"wrap",gap:8},photoSlot:{width:76,height:76,position:"relative"},photoSlotEmpty:{flex:1,borderWidth:1,borderStyle:"dashed",borderColor:C.purple,borderRadius:9,backgroundColor:C.pale,alignItems:"center",justifyContent:"center"},photoSlotImage:{width:76,height:76,borderRadius:9,backgroundColor:"#EEEAF4"},photoRemove:{position:"absolute",right:-10,top:-10,width:40,height:40,borderRadius:20,backgroundColor:C.red,alignItems:"center",justifyContent:"center",zIndex:1},photoRemoveText:{fontSize:17,color:"#fff",fontWeight:"900",lineHeight:20},
 safe:{flex:1,backgroundColor:C.bg},header:{minHeight:56,paddingVertical:7,paddingHorizontal:12,flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:6,borderBottomWidth:1,borderColor:C.line},
 back:{color:C.muted,fontWeight:"700",fontSize:12,width:52},writerGuide:{backgroundColor:C.pale,borderRadius:13,padding:13,marginHorizontal:14,marginTop:8},writerGuideTitle:{fontSize:12,fontWeight:"900",color:C.purple},writerGuideText:{fontSize:11,lineHeight:17,color:C.muted,marginTop:5},writerGuideLink:{fontSize:11,fontWeight:"800",color:C.purple,marginTop:7},inlineWarning:{marginTop:12,padding:12,borderRadius:11,backgroundColor:"#FFF4E5",borderWidth:1,borderColor:"#F1D4A8"},inlineWarningTitle:{fontSize:12,fontWeight:"900",color:"#8A4B08",marginBottom:5},inlineWarningText:{fontSize:11,lineHeight:17,color:"#80551E",marginTop:3},finalCheck:{flexDirection:"row",alignItems:"flex-start",gap:9,marginTop:14,padding:12,borderRadius:11,borderWidth:1,borderColor:C.line,backgroundColor:C.pale},checkBox:{width:20,height:20,borderRadius:5,borderWidth:1.5,borderColor:C.purple,alignItems:"center",justifyContent:"center",backgroundColor:"#FFFFFF"},checkBoxActive:{backgroundColor:C.purple},finalCheckText:{flex:1,fontSize:11,lineHeight:17,color:C.ink},heading:{fontSize:16,fontWeight:"900",color:C.ink,flexShrink:1,textAlign:"center"},writeBtn:{backgroundColor:C.purple,borderRadius:10,paddingHorizontal:9,paddingVertical:8},writeText:{color:"#fff",fontSize:11,fontWeight:"800"},menuBtn:{borderWidth:1,borderColor:C.line,borderRadius:10,paddingHorizontal:9,paddingVertical:7,marginLeft:5},menuText:{color:C.ink,fontSize:17,fontWeight:"800"},
 intro:{color:C.muted,fontSize:12,paddingHorizontal:18,paddingTop:16},filterScroll:{flexGrow:0,flexShrink:0},filters:{paddingHorizontal:14,paddingVertical:9,gap:6,alignItems:"center"},filter:{paddingHorizontal:11,paddingVertical:7,borderRadius:18,borderWidth:1,borderColor:C.line,backgroundColor:"#fff"},filterActive:{backgroundColor:C.pale,borderColor:C.purple},filterText:{fontSize:12,color:C.muted,fontWeight:"700"},filterTextActive:{color:C.purple},
 list:{padding:12,paddingBottom:24},postCard:{backgroundColor:"#fff",padding:13,borderRadius:16,borderWidth:1,borderColor:C.line,marginBottom:10},postTop:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},categoryBadge:{backgroundColor:C.pale,borderRadius:8,paddingHorizontal:9,paddingVertical:5,alignSelf:"flex-start"},categoryText:{fontSize:10,color:C.purple,fontWeight:"800"},meta:{fontSize:10,color:C.muted},cardTitle:{fontSize:16,fontWeight:"900",color:C.ink,marginTop:11},preview:{fontSize:12,color:"#625E70",lineHeight:18,marginTop:6},cardFoot:{flexDirection:"row",justifyContent:"space-between",marginTop:13},author:{fontSize:11,color:C.muted,fontWeight:"700"},openLabel:{fontSize:11,color:C.purple,fontWeight:"800"},empty:{textAlign:"center",color:C.muted,padding:28,fontSize:13},
 detailContent:{padding:14,paddingBottom:24},postDetail:{backgroundColor:"#fff",borderRadius:17,borderWidth:1,borderColor:C.line,padding:16},postTitle:{fontSize:20,fontWeight:"900",color:C.ink,marginTop:12},postBody:{fontSize:14,color:"#4E4A5C",lineHeight:23,marginTop:20},section:{fontSize:15,fontWeight:"900",color:C.ink,marginTop:22,marginBottom:10},comment:{backgroundColor:"#fff",borderRadius:12,padding:13,marginBottom:8,borderWidth:1,borderColor:C.line},moderationActions:{flexDirection:"row",justifyContent:"flex-end",gap:16,marginTop:10},commentTop:{flexDirection:"row",justifyContent:"space-between"},commentAuthor:{fontSize:12,color:C.ink,fontWeight:"800"},commentBody:{fontSize:13,color:"#555164",lineHeight:20,marginTop:8},deleteText:{fontSize:10,color:C.red,fontWeight:"700",marginTop:10,alignSelf:"flex-end"},
 commentComposer:{flexDirection:"row",alignItems:"flex-end",gap:8,marginTop:15},commentInput:{flex:1,minHeight:44,maxHeight:110,backgroundColor:"#fff",borderRadius:12,borderWidth:1,borderColor:C.line,padding:11,fontSize:13,color:C.ink},sendBtn:{backgroundColor:C.purple,paddingHorizontal:15,paddingVertical:13,borderRadius:11},sendText:{color:"#fff",fontWeight:"800",fontSize:12},cooldownNote:{fontSize:10,color:C.muted,lineHeight:16,marginTop:10},rulesContent:{paddingBottom:6},rulesIntro:{fontSize:13,color:"#4E4A5C",lineHeight:21,marginBottom:14},ruleRow:{flexDirection:"row",alignItems:"flex-start",gap:10,marginBottom:13},ruleNumber:{width:22,height:22,borderRadius:11,backgroundColor:C.pale,color:C.purple,fontSize:11,fontWeight:"900",textAlign:"center",textAlignVertical:"center",overflow:"hidden",paddingTop:3},ruleText:{flex:1,minWidth:0,fontSize:13,color:"#4E4A5C",lineHeight:21,flexShrink:1},termsFullLink:{paddingVertical:12,alignItems:"center"},legacyLink:{alignItems:"center",paddingVertical:8},legacyLinkText:{fontSize:12,fontWeight:"800",color:C.purple},
 shade:{flex:1,backgroundColor:"rgba(20,16,32,0.55)",justifyContent:"flex-end"},modal:{backgroundColor:"#fff",borderTopLeftRadius:22,borderTopRightRadius:22,padding:16,paddingBottom:20,maxHeight:"92%"},modalHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},composerHeader:{flexDirection:"row",alignItems:"center",justifyContent:"space-between",minHeight:44,gap:10},composerClose:{width:36,height:36,alignItems:"center",justifyContent:"center"},composerSubmit:{minWidth:64,minHeight:44,paddingHorizontal:16,borderRadius:10,backgroundColor:C.purple,alignItems:"center",justifyContent:"center"},composerSubmitText:{fontSize:13,fontWeight:"900",color:"#FFFFFF"},modalTitle:{fontSize:18,fontWeight:"900",color:C.ink,flex:1,textAlign:"center"},close:{fontSize:25,color:C.muted},inputWithClear:{position:"relative",flexDirection:"row",alignItems:"center"},bodyInputWrap:{position:"relative",minHeight:140,maxHeight:220},inlineEditor:{gap:10},editorTextBlock:{minHeight:110,borderWidth:1,borderColor:C.line,borderRadius:11,backgroundColor:"#FFFFFF",padding:11},editorTextInput:{minHeight:88,fontSize:13,lineHeight:21,color:C.ink,padding:0},inlineEditorPhoto:{borderWidth:1,borderColor:C.line,borderRadius:12,padding:10,gap:9,backgroundColor:"#FFFFFF"},inlineEditorPhotoHead:{flexDirection:"row",alignItems:"center",justifyContent:"space-between"},inlinePhotoLabel:{fontSize:11,fontWeight:"900",color:C.purple},inlineRemoveButton:{minWidth:64,minHeight:40,paddingHorizontal:10,borderRadius:8,flexDirection:"row",alignItems:"center",justifyContent:"center",gap:4},inlineRemoveText:{fontSize:11,fontWeight:"800",color:C.red},inlineEditorImage:{width:"100%",height:170,borderRadius:9,backgroundColor:"#EEEAF4"},editorHint:{fontSize:11,lineHeight:16,color:C.muted,marginTop:7},inlinePostBody:{gap:12},inlinePostText:{fontSize:14,color:"#4E4A5C",lineHeight:23,marginTop:0},clearField:{position:"absolute",right:10,padding:6,backgroundColor:"#FFFFFF"},clearBodyField:{position:"absolute",right:8,top:8,padding:5,backgroundColor:"#FFFFFF"},label:{fontSize:12,color:C.ink,fontWeight:"800",marginTop:17,marginBottom:8},categoryChoices:{flexDirection:"row",flexWrap:"wrap",gap:7},titleInput:{height:47,borderWidth:1,borderColor:C.line,borderRadius:11,paddingHorizontal:12,fontSize:13,color:C.ink},bodyInput:{minHeight:140,maxHeight:220,borderWidth:1,borderColor:C.line,borderRadius:11,padding:12,fontSize:13,color:C.ink},submitBtn:{backgroundColor:C.purple,borderRadius:12,padding:15,alignItems:"center",marginTop:15},submitText:{color:"#fff",fontWeight:"900"}
},dark));

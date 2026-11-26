import React, {useCallback, useEffect, useRef, useState, useMemo} from "react";
import {themeStyles } from "../lib/theme";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Alert, FlatList, Image, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, useColorScheme} from "react-native";
import * as ImagePicker from "expo-image-picker";
import * as ImageManipulator from "expo-image-manipulator";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLocalSearchParams, useRouter } from "expo-router";
import { supabase } from "../lib/supabase";

type Category="전체"|"학원 추천"|"발레복 추천"|"자유";
type Post={id:string;author_id:string;author_name:string;category:Exclude<Category,"전체">;title:string;content:string;image_urls:string[];created_at:string};
type Comment={id:string;post_id:string;author_id:string;author_name:string;content:string;created_at:string};
const C={bg:"#FAF9FC",ink:"#252238",muted:"#8B879A",purple:"#7661D8",pale:"#F3F0FF",line:"#EAE7F0",red:"#D04444",green:"#18875B"};
const categories:Category[]=["전체","학원 추천","발레복 추천","자유"];
const timeLabel=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?"":date.toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});};
const cooldownMessage="도배 방지를 위해 작성 후 30초가 지나야 다음 글이나 댓글을 작성할 수 있습니다.";

export default function Community(){
 const isDark=useColorScheme()==="dark";
 const s=useMemo(()=>createS(isDark),[isDark]);
 const router=useRouter();
 const params=useLocalSearchParams<{postId?:string}>();
 const [bookmarkedIds,setBookmarkedIds]=useState<string[]>([]);
 const [posts,setPosts]=useState<Post[]>([]);
 const [category,setCategory]=useState<Category>("전체");
 const [selected,setSelected]=useState<Post|null>(null);
 const [comments,setComments]=useState<Comment[]>([]);
 const [commentText,setCommentText]=useState("");
 const [loading,setLoading]=useState(true);
 const [loadError,setLoadError]=useState(false);
 const [refreshing,setRefreshing]=useState(false);
 const [submitting,setSubmitting]=useState(false);
 const [composer,setComposer]=useState(false);
 const [newCategory,setNewCategory]=useState<Exclude<Category,"전체">>("학원 추천");
 const [title,setTitle]=useState("");
 const [body,setBody]=useState("");
 const [selectedPhotos,setSelectedPhotos]=useState<ImagePicker.ImagePickerAsset[]>([]);
 const [userId,setUserId]=useState<string|null>(null);
  const [isAdmin,setIsAdmin]=useState(false);
 const [authorName,setAuthorName]=useState("발레메이트 회원");
 const [blockedUserIds,setBlockedUserIds]=useState<string[]>([]);
 const [termsConsentOpen,setTermsConsentOpen]=useState(false);
 const [termsAccepting,setTermsAccepting]=useState(false);
 const [termsReturnTo,setTermsReturnTo]=useState<"post"|"comment">("post");
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
  await loadComments(post.id,requestId);
 };
 const toggleBookmark=async(post:Post)=>{if(!userId||!supabase){requireLogin();return;}const exists=bookmarkedIds.includes(post.id);if(exists){const {error}=await supabase.from("community_post_bookmarks").delete().eq("user_id",userId).eq("post_id",post.id);if(error){Alert.alert("북마크 해제 실패",error.message);return;}setBookmarkedIds(v=>v.filter(id=>id!==post.id));}else{const {error}=await supabase.from("community_post_bookmarks").insert({user_id:userId,post_id:post.id});if(error){Alert.alert("북마크 저장 실패",error.message);return;}setBookmarkedIds(v=>[...v,post.id]);}};
 useEffect(()=>{if(!supabase||!userId)return;supabase.from("community_post_bookmarks").select("post_id").eq("user_id",userId).then(({data})=>setBookmarkedIds((data||[]).map(x=>x.post_id)));},[userId]);
 useEffect(()=>{if(!params.postId||!supabase)return;let active=true;supabase.from("community_posts").select("id,author_id,author_name,category,title,content,image_urls,created_at").eq("id",params.postId).maybeSingle().then(({data,error})=>{if(active&&data&&!error)void openPost(data as Post);});return()=>{active=false;};},[params.postId]);
 const requireLogin=()=>{Alert.alert("로그인이 필요합니다","게시글과 댓글 작성은 가입한 회원만 이용할 수 있습니다.",[{text:"취소",style:"cancel"},{text:"로그인",onPress:()=>router.push("/account")}]);};
 const requireMemberProfile=async()=>{if(!supabase||!userId)return false;const {data,error}=await supabase.from("user_profiles").select("display_name").eq("user_id",userId).maybeSingle();if(error){Alert.alert("회원 정보 확인 실패",error.message);return false;}if(!String(data?.display_name||"").trim()){Alert.alert("회원정보 등록 필요","게시글과 댓글을 작성하려면 회원정보 등록을 완료해 주세요.",[{text:"취소",style:"cancel"},{text:"등록하기",onPress:()=>router.push("/onboarding")}]);return false;}return true;};
 const explainError=(error:any)=>{
  const message=String(error?.message||"");
  if(message.includes("30초")||message.includes("P0001"))Alert.alert("잠시만 기다려 주세요",cooldownMessage);
  else if(message.includes("42501")||message.toLowerCase().includes("row-level security"))Alert.alert("로그인이 필요합니다","회원 로그인 후 작성할 수 있습니다.");
  else Alert.alert("작성 실패",message||"잠시 후 다시 시도해 주세요.");
 };

 const pickPhotos=async()=>{
  if(selectedPhotos.length>=4){Alert.alert("사진 첨부","게시글 사진은 최대 4장까지 첨부할 수 있습니다.");return;}
  const result=await ImagePicker.launchImageLibraryAsync({mediaTypes:["images"],allowsMultipleSelection:true,selectionLimit:4-selectedPhotos.length,quality:0.85});
  if(!result.canceled)setSelectedPhotos(current=>[...current,...result.assets].slice(0,4));
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
  if(title.trim().length<2||body.trim().length<2){Alert.alert("내용 확인","제목은 2자 이상, 내용은 2자 이상 입력해 주세요.");return;}
  setSubmitting(true);
  let uploadedPaths:string[]=[];
  try{
   const uploaded=await uploadCommunityPhotos();uploadedPaths=uploaded.paths;
   const {error}=await supabase.from("community_posts").insert({author_id:userId,author_name:authorName,category:newCategory,title:title.trim(),content:body.trim(),image_urls:uploaded.urls});
   if(error)throw error;
   setComposer(false);setTitle("");setBody("");setSelectedPhotos([]);setLoading(true);
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
  const accepted=await client.from("community_terms_acceptances").select("terms_version").eq("user_id",userId).eq("terms_version","2026-11-24").maybeSingle();
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
  const {data,error}=await client.from("community_terms_acceptances").select("terms_version").eq("user_id",userId).eq("terms_version","2026-11-24").maybeSingle();
  if(error){Alert.alert("이용규칙 확인 실패",error.message);return;}
  if(data){setComposer(true);return;}
  setTermsReturnTo("post");setTermsConsentOpen(true);
 };
 const acceptCommunityTerms=async()=>{
  const client=supabase;
  if(!client||!userId||termsAccepting)return;
  setTermsAccepting(true);
  try{
   const {error}=await client.from("community_terms_acceptances").insert({user_id:userId,terms_version:"2026-11-24"});
   if(error&&error.code!=="23505")throw error;
   setTermsConsentOpen(false);
   if(termsReturnTo==="post")setComposer(true);
   else if(termsReturnTo==="comment")await submitComment();
  }catch(error:any){Alert.alert("동의 처리 실패",error?.message||"이용규칙 동의를 저장하지 못했습니다.");}
  finally{setTermsAccepting(false);}
 };
 const reportContent=(contentType:"post"|"comment",contentId:string,targetUserId:string)=>{
  const client=supabase;
  if(!userId||!client){requireLogin();return;}
  if(targetUserId===userId){Alert.alert("신고 불가","본인이 작성한 콘텐츠는 신고할 수 없습니다.");return;}
  const reasons=["스팸/광고","욕설/괴롭힘","부적절한 콘텐츠","개인정보 노출","허위 정보","기타"];
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
     <Text style={s.postBody}>{selected.content}</Text>
     {!!selected.image_urls?.length&&<View style={s.postPhotos}>{selected.image_urls.map((url,index)=><Image key={url} source={{uri:url}} style={s.detailPhoto} resizeMode="cover" accessibilityLabel={"게시글 사진 "+(index+1)}/>)}</View>}
     {selected.author_id===userId||isAdmin?<Pressable onPress={()=>removePost(selected)}><Text style={s.deleteText}>{isAdmin&&selected.author_id!==userId?"관리자 삭제":"게시글 삭제"}</Text></Pressable>:<View style={s.moderationActions}><Pressable onPress={()=>reportContent("post",selected.id,selected.author_id)}><Text style={s.deleteText}>작성자·콘텐츠 신고</Text></Pressable><Pressable onPress={()=>blockUser(selected.author_id,selected.author_name||"해당")}><Text style={s.deleteText}>차단</Text></Pressable></View>}
    </View>
    <Text style={s.section}>댓글 {comments.length}</Text>
    {comments.filter(comment=>!blockedUserIds.includes(comment.author_id)).map(comment=><View key={comment.id} style={s.comment}>
     <View style={s.commentTop}><Text style={s.commentAuthor}>{comment.author_name||"발레메이트 회원"}</Text><Text style={s.meta}>{timeLabel(comment.created_at)}</Text></View>
     <Text style={s.commentBody}>{comment.content}</Text>
     {comment.author_id===userId||isAdmin?<Pressable onPress={()=>removeComment(comment)}><Text style={s.deleteText}>{isAdmin&&comment.author_id!==userId?"관리자 삭제":"삭제"}</Text></Pressable>:<View style={s.moderationActions}><Pressable onPress={()=>reportContent("comment",comment.id,comment.author_id)}><Text style={s.deleteText}>작성자·콘텐츠 신고</Text></Pressable><Pressable onPress={()=>blockUser(comment.author_id,comment.author_name||"해당")}><Text style={s.deleteText}>차단</Text></Pressable></View>}
    </View>)}
    {!comments.length&&<Text style={s.empty}>첫 댓글을 남겨보세요.</Text>}
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
      <View style={s.postTop}><View style={s.categoryBadge}><Text style={s.categoryText}>{item.category}</Text></View><Text style={s.meta}>{timeLabel(item.created_at)}</Text></View>
      <Text style={s.cardTitle} numberOfLines={2}>{item.title}</Text>
      <Text style={s.preview} numberOfLines={2}>{item.content}</Text>
      {!!item.image_urls?.length&&<View style={s.postPhotos}>{item.image_urls.slice(0,2).map((url,index)=><Image key={url} source={{uri:url}} style={s.listPhoto} resizeMode="cover"/>)}</View>}
      <View style={s.cardFoot}><Text style={s.author}>{item.author_name||"발레메이트 회원"}</Text><View style={{flexDirection:"row",alignItems:"center",gap:12}}><Pressable onPress={(event:any)=>{event.stopPropagation?.();void toggleBookmark(item);}} accessibilityRole="button" accessibilityLabel={bookmarkedIds.includes(item.id)?"북마크 해제":"북마크 저장"}><Ionicons name={bookmarkedIds.includes(item.id)?"bookmark":"bookmark-outline"} size={18} color={C.purple}/></Pressable><Text style={s.openLabel}>댓글 보기 ›</Text></View></View>
     </Pressable>} ListEmptyComponent={loadError?<View><Text style={s.empty}>게시글을 불러오지 못했습니다.</Text><Pressable onPress={()=>{setLoading(true);loadPosts();}}><Text style={s.openLabel}>다시 시도</Text></Pressable></View>:<Text style={s.empty}>아직 게시글이 없습니다. 첫 추천을 남겨보세요!</Text>}/>
    }
   </>
  }

  <Modal visible={termsConsentOpen} transparent animationType="fade" onRequestClose={()=>setTermsConsentOpen(false)}>
   <View style={s.shade}><View style={[s.modal,{maxHeight:"86%"}]}>
    <View style={s.modalHead}><Text style={s.modalTitle}>커뮤니티 첫 이용 안내</Text><Pressable onPress={()=>setTermsConsentOpen(false)}><Text style={s.close}>×</Text></Pressable></View>
    <ScrollView style={{marginTop:12}} contentContainerStyle={s.rulesContent} showsVerticalScrollIndicator={false}>
     <Text style={s.rulesIntro}>안전한 커뮤니티 이용을 위해 아래 내용을 확인하고 동의해 주세요. 동의 후 댓글과 게시글을 작성할 수 있습니다.</Text>
     {["욕설·괴롭힘·협박·차별 등 다른 회원을 공격하는 표현은 사용할 수 없습니다.","스팸·광고·도배·사기 및 사실과 다른 정보의 반복 게시를 금지합니다.","본인이나 타인의 전화번호·주소·계정정보 등 개인정보를 공개하지 마세요.","저작권·초상권 등 타인의 권리를 침해하는 사진이나 글을 올리지 마세요.","신고된 콘텐츠는 운영자가 검토하며, 운영정책 위반 시 삭제될 수 있습니다.","회원을 차단하면 해당 회원의 게시글과 댓글이 내 화면에서 숨겨집니다."].map((rule,index)=><View key={index} style={s.ruleRow}><Text style={s.ruleNumber}>{index+1}</Text><Text style={s.ruleText}>{rule}</Text></View>)}
    </ScrollView>
    <Pressable style={s.termsFullLink} onPress={()=>router.push("/terms")}><Text style={s.openLabel}>서비스 이용약관 전문 보기</Text></Pressable>
    <Pressable style={[s.submitBtn,termsAccepting&&{opacity:.5}]} disabled={termsAccepting} onPress={acceptCommunityTerms}><Text style={s.submitText}>{termsAccepting?"저장 중…":termsReturnTo==="comment"?"동의하고 댓글 등록":"동의하고 글쓰기"}</Text></Pressable>
    <Pressable style={s.legacyLink} onPress={()=>setTermsConsentOpen(false)}><Text style={s.legacyLinkText}>동의하지 않음</Text></Pressable>
   </View></View>
  </Modal>

  <Modal visible={composer} transparent animationType="slide" onRequestClose={()=>setComposer(false)}>
   <KeyboardAvoidingView style={s.shade} behavior={Platform.OS==="ios"?"padding":undefined}>
    <View style={s.modal}>
     <View style={s.modalHead}><Text style={s.modalTitle}>새 게시글</Text><Pressable onPress={()=>setComposer(false)}><Text style={s.close}>×</Text></Pressable></View>
     <Text style={s.label}>게시판 선택</Text>
     <View style={s.categoryChoices}>{(["학원 추천","발레복 추천","자유"] as const).map(item=><Pressable key={item} onPress={()=>setNewCategory(item)} style={[s.filter,newCategory===item&&s.filterActive]}><Text style={[s.filterText,newCategory===item&&s.filterTextActive]}>{item}</Text></Pressable>)}</View>
     <Text style={s.label}>제목</Text>
     <TextInput style={s.titleInput} value={title} onChangeText={setTitle} placeholder="어떤 정보를 나누고 싶으신가요?" maxLength={80}/>
     <Text style={s.label}>내용</Text>
     <TextInput style={s.bodyInput} value={body} onChangeText={setBody} placeholder="경험이나 추천 정보를 자세히 적어주세요." multiline textAlignVertical="top" maxLength={5000}/>
     <View style={s.photoPickerRow}><Pressable style={[s.photoPicker,{minWidth:92,minHeight:82,flexDirection:"column",justifyContent:"center",alignItems:"center",gap:5}]} onPress={pickPhotos} accessibilityRole="button" accessibilityLabel="사진 첨부"><Ionicons name="camera" size={30} color={C.purple}/><Text style={s.photoPickerText}>사진 첨부 ({selectedPhotos.length}/4)</Text></Pressable></View>
     {!!selectedPhotos.length&&<ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.photoPreviewRow}>{selectedPhotos.map((photo,index)=><View key={photo.assetId||photo.uri} style={s.photoPreviewWrap}><Image source={{uri:photo.uri}} style={s.photoPreview}/><Pressable style={s.photoRemove} onPress={()=>setSelectedPhotos(current=>current.filter((_,i)=>i!==index))}><Text style={s.photoRemoveText}>×</Text></Pressable></View>)}</ScrollView>}
     <Text style={s.cooldownNote}>게시글 등록 후 30초 동안 댓글을 포함한 새 작성이 제한됩니다.</Text>
     <Pressable style={[s.submitBtn,submitting&&{opacity:.5}]} disabled={submitting} onPress={submitPost}><Text style={s.submitText}>{submitting?"등록 중…":"게시글 등록"}</Text></Pressable>
    </View>
   </KeyboardAvoidingView>
  </Modal>
 </SafeAreaView>;
}

const createS = (dark:boolean) => StyleSheet.create(themeStyles({postPhotos:{flexDirection:"row",flexWrap:"wrap",gap:8,marginTop:10},detailPhoto:{width:"48%",height:170,borderRadius:10,backgroundColor:"#EEEAF4"},listPhoto:{width:88,height:68,borderRadius:8,backgroundColor:"#EEEAF4"},photoPickerRow:{flexDirection:"row",marginTop:10},photoPicker:{flexDirection:"row",alignItems:"center",gap:7,paddingHorizontal:12,paddingVertical:9,borderRadius:9,backgroundColor:C.pale},photoPickerText:{fontSize:12,fontWeight:"800",color:C.purple},photoPreviewRow:{gap:8,paddingVertical:10},photoPreviewWrap:{width:76,height:76,position:"relative"},photoPreview:{width:76,height:76,borderRadius:9,backgroundColor:"#EEEAF4"},photoRemove:{position:"absolute",right:-5,top:-5,width:22,height:22,borderRadius:11,backgroundColor:C.red,alignItems:"center",justifyContent:"center"},photoRemoveText:{fontSize:17,color:"#fff",fontWeight:"900",lineHeight:20},
 safe:{flex:1,backgroundColor:C.bg},header:{minHeight:56,paddingVertical:7,paddingHorizontal:12,flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:6,borderBottomWidth:1,borderColor:C.line},
 back:{color:C.muted,fontWeight:"700",fontSize:12,width:52},heading:{fontSize:16,fontWeight:"900",color:C.ink,flexShrink:1,textAlign:"center"},writeBtn:{backgroundColor:C.purple,borderRadius:10,paddingHorizontal:9,paddingVertical:8},writeText:{color:"#fff",fontSize:11,fontWeight:"800"},menuBtn:{borderWidth:1,borderColor:C.line,borderRadius:10,paddingHorizontal:9,paddingVertical:7,marginLeft:5},menuText:{color:C.ink,fontSize:17,fontWeight:"800"},
 intro:{color:C.muted,fontSize:12,paddingHorizontal:18,paddingTop:16},filterScroll:{flexGrow:0,flexShrink:0},filters:{paddingHorizontal:14,paddingVertical:9,gap:6,alignItems:"center"},filter:{paddingHorizontal:11,paddingVertical:7,borderRadius:18,borderWidth:1,borderColor:C.line,backgroundColor:"#fff"},filterActive:{backgroundColor:C.pale,borderColor:C.purple},filterText:{fontSize:12,color:C.muted,fontWeight:"700"},filterTextActive:{color:C.purple},
 list:{padding:12,paddingBottom:24},postCard:{backgroundColor:"#fff",padding:13,borderRadius:16,borderWidth:1,borderColor:C.line,marginBottom:10},postTop:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},categoryBadge:{backgroundColor:C.pale,borderRadius:8,paddingHorizontal:9,paddingVertical:5,alignSelf:"flex-start"},categoryText:{fontSize:10,color:C.purple,fontWeight:"800"},meta:{fontSize:10,color:C.muted},cardTitle:{fontSize:16,fontWeight:"900",color:C.ink,marginTop:11},preview:{fontSize:12,color:"#625E70",lineHeight:18,marginTop:6},cardFoot:{flexDirection:"row",justifyContent:"space-between",marginTop:13},author:{fontSize:11,color:C.muted,fontWeight:"700"},openLabel:{fontSize:11,color:C.purple,fontWeight:"800"},empty:{textAlign:"center",color:C.muted,padding:28,fontSize:13},
 detailContent:{padding:14,paddingBottom:24},postDetail:{backgroundColor:"#fff",borderRadius:17,borderWidth:1,borderColor:C.line,padding:16},postTitle:{fontSize:20,fontWeight:"900",color:C.ink,marginTop:12},postBody:{fontSize:14,color:"#4E4A5C",lineHeight:23,marginTop:20},section:{fontSize:15,fontWeight:"900",color:C.ink,marginTop:22,marginBottom:10},comment:{backgroundColor:"#fff",borderRadius:12,padding:13,marginBottom:8,borderWidth:1,borderColor:C.line},moderationActions:{flexDirection:"row",justifyContent:"flex-end",gap:16,marginTop:10},commentTop:{flexDirection:"row",justifyContent:"space-between"},commentAuthor:{fontSize:12,color:C.ink,fontWeight:"800"},commentBody:{fontSize:13,color:"#555164",lineHeight:20,marginTop:8},deleteText:{fontSize:10,color:C.red,fontWeight:"700",marginTop:10,alignSelf:"flex-end"},
 commentComposer:{flexDirection:"row",alignItems:"flex-end",gap:8,marginTop:15},commentInput:{flex:1,minHeight:44,maxHeight:110,backgroundColor:"#fff",borderRadius:12,borderWidth:1,borderColor:C.line,padding:11,fontSize:13,color:C.ink},sendBtn:{backgroundColor:C.purple,paddingHorizontal:15,paddingVertical:13,borderRadius:11},sendText:{color:"#fff",fontWeight:"800",fontSize:12},cooldownNote:{fontSize:10,color:C.muted,lineHeight:16,marginTop:10},rulesContent:{paddingBottom:6},rulesIntro:{fontSize:13,color:"#4E4A5C",lineHeight:21,marginBottom:14},ruleRow:{flexDirection:"row",alignItems:"flex-start",gap:10,marginBottom:13},ruleNumber:{width:22,height:22,borderRadius:11,backgroundColor:C.pale,color:C.purple,fontSize:11,fontWeight:"900",textAlign:"center",textAlignVertical:"center",overflow:"hidden",paddingTop:3},ruleText:{flex:1,minWidth:0,fontSize:13,color:"#4E4A5C",lineHeight:21,flexShrink:1},termsFullLink:{paddingVertical:12,alignItems:"center"},legacyLink:{alignItems:"center",paddingVertical:8},legacyLinkText:{fontSize:12,fontWeight:"800",color:C.purple},
 shade:{flex:1,backgroundColor:"rgba(30,25,45,0.38)",justifyContent:"flex-end"},modal:{backgroundColor:"#fff",borderTopLeftRadius:22,borderTopRightRadius:22,padding:16,paddingBottom:20,maxHeight:"92%"},modalHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},modalTitle:{fontSize:20,fontWeight:"900",color:C.ink},close:{fontSize:25,color:C.muted},label:{fontSize:12,color:C.ink,fontWeight:"800",marginTop:17,marginBottom:8},categoryChoices:{flexDirection:"row",flexWrap:"wrap",gap:7},titleInput:{height:47,borderWidth:1,borderColor:C.line,borderRadius:11,paddingHorizontal:12,fontSize:13,color:C.ink},bodyInput:{minHeight:140,maxHeight:220,borderWidth:1,borderColor:C.line,borderRadius:11,padding:12,fontSize:13,color:C.ink},submitBtn:{backgroundColor:C.purple,borderRadius:12,padding:15,alignItems:"center",marginTop:15},submitText:{color:"#fff",fontWeight:"900"}
},dark));

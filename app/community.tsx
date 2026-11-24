import React, { useCallback, useEffect, useRef, useState } from "react";
import { Ionicons } from "@expo/vector-icons";
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useRouter } from "expo-router";
import { supabase } from "../lib/supabase";

type Category="전체"|"학원 추천"|"발레복 추천"|"자유";
type Post={id:string;author_id:string;author_name:string;category:Exclude<Category,"전체">;title:string;content:string;created_at:string};
type Comment={id:string;post_id:string;author_id:string;author_name:string;content:string;created_at:string};
const C={bg:"#FAF9FC",ink:"#252238",muted:"#8B879A",purple:"#7661D8",pale:"#F3F0FF",line:"#EAE7F0",red:"#D04444",green:"#18875B"};
const categories:Category[]=["전체","학원 추천","발레복 추천","자유"];
const timeLabel=(value:string)=>{const date=new Date(value);return Number.isNaN(date.getTime())?"":date.toLocaleString("ko-KR",{month:"numeric",day:"numeric",hour:"2-digit",minute:"2-digit"});};
const cooldownMessage="도배 방지를 위해 작성 후 30초가 지나야 다음 글이나 댓글을 작성할 수 있습니다.";

export default function Community(){
 const router=useRouter();
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
 const [userId,setUserId]=useState<string|null>(null);
 const [authorName,setAuthorName]=useState("발레메이트 회원");
 const [blockedUserIds,setBlockedUserIds]=useState<string[]>([]);
 const commentRequestId=useRef(0);

 const postRequestId=useRef(0);
 const loadPosts=useCallback(async()=>{
  const requestId=++postRequestId.current;
  if(requestId===postRequestId.current)setLoadError(false);
  if(!supabase){if(requestId===postRequestId.current)setLoading(false);return;}
  try{
   let query=supabase.from("community_posts").select("id,author_id,author_name,category,title,content,created_at").order("created_at",{ascending:false}).limit(50);
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
   try{const {data}=await client.from("user_profiles").select("display_name,username").eq("user_id",user.id).maybeSingle();const profileName=data?.display_name||data?.username;if(profileName&&!String(profileName).startsWith("social_"))return String(profileName).trim().slice(0,40);}catch{}
   return resolveAuthorName(user);
  };
  client.auth.getSession().then(async({data})=>{setUserId(data.session?.user?.id||null);setAuthorName(await loadAuthorName(data.session?.user));});
  const {data:{subscription}}=client.auth.onAuthStateChange((_event,session)=>{setUserId(session?.user?.id||null);loadAuthorName(session?.user).then(setAuthorName);});
  return()=>subscription.unsubscribe();
 },[]);

 const loadComments=async(postId:string,requestId=++commentRequestId.current)=>{
  if(!supabase)return;
  const {data,error}=await supabase.from("community_comments").select("id,post_id,author_id,author_name,content,created_at").eq("post_id",postId).order("created_at",{ascending:true}).limit(100);
  if(requestId!==commentRequestId.current)return;
  if(error){Alert.alert("댓글 불러오기 실패",error.message);return;}
  setComments((data||[]) as Comment[]);
 };
 const openPost=async(post:Post)=>{
  const requestId=++commentRequestId.current;
  setSelected(post);
  setComments([]);
  await loadComments(post.id,requestId);
 };
 const requireLogin=()=>{Alert.alert("로그인이 필요합니다","게시글과 댓글 작성은 가입한 회원만 이용할 수 있습니다.",[{text:"취소",style:"cancel"},{text:"로그인",onPress:()=>router.push("/account")}]);};
 const explainError=(error:any)=>{
  const message=String(error?.message||"");
  if(message.includes("30초")||message.includes("P0001"))Alert.alert("잠시만 기다려 주세요",cooldownMessage);
  else if(message.includes("42501")||message.toLowerCase().includes("row-level security"))Alert.alert("로그인이 필요합니다","회원 로그인 후 작성할 수 있습니다.");
  else Alert.alert("작성 실패",message||"잠시 후 다시 시도해 주세요.");
 };

 const submitPost=async()=>{
  if(!userId){requireLogin();return;}
  if(!supabase)return;
  if(title.trim().length<2||body.trim().length<2){Alert.alert("내용 확인","제목은 2자 이상, 내용은 2자 이상 입력해 주세요.");return;}
  setSubmitting(true);
  try{
   const {error}=await supabase.from("community_posts").insert({author_id:userId,author_name:authorName,category:newCategory,title:title.trim(),content:body.trim()});
   if(error)throw error;
   setComposer(false);setTitle("");setBody("");setLoading(true);
   if(category!=="전체")setCategory("전체");else await loadPosts();
   Alert.alert("등록 완료","게시글이 등록되었습니다.");
  }catch(error:any){explainError(error);}
  finally{setSubmitting(false);}
 };

 const submitComment=async()=>{
  if(!userId){requireLogin();return;}
  if(!supabase||!selected)return;
  if(!commentText.trim()){Alert.alert("댓글 내용","댓글을 입력해 주세요.");return;}
  setSubmitting(true);
  try{
   const {error}=await supabase.from("community_comments").insert({post_id:selected.id,author_id:userId,author_name:authorName,content:commentText.trim()});
   if(error)throw error;
   setCommentText("");await loadComments(selected.id);
   Alert.alert("등록 완료","댓글이 등록되었습니다.");
  }catch(error:any){explainError(error);}
  finally{setSubmitting(false);}
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
    if(selected?.author_id===targetUserId){commentRequestId.current++;setSelected(null);setComments([]);}
    else if(selected){setComments(current=>current.filter(comment=>comment.author_id!==targetUserId));}
    Alert.alert("차단 완료","해당 회원의 콘텐츠를 숨겼습니다.");
   }}
  ]);
 };
 const removePost=async(post:Post)=>{
  const client=supabase;
  if(!client||post.author_id!==userId)return;
  Alert.alert("게시글 삭제","이 게시글을 삭제할까요?",[{text:"취소",style:"cancel"},{text:"삭제",style:"destructive",onPress:async()=>{
   const {error}=await client.from("community_posts").delete().eq("id",post.id);
   if(error){Alert.alert("삭제 실패",error.message);return;}
   commentRequestId.current++;setSelected(null);loadPosts();
  }}]);
 };
 const removeComment=async(comment:Comment)=>{
  const client=supabase;
  if(!client||comment.author_id!==userId)return;
  Alert.alert("댓글 삭제","이 댓글을 삭제할까요?",[{text:"취소",style:"cancel"},{text:"삭제",style:"destructive",onPress:async()=>{
   const {error}=await client.from("community_comments").delete().eq("id",comment.id);
   if(error){Alert.alert("삭제 실패",error.message);return;}
   if(selected)loadComments(selected.id);
  }}]);
 };

 return <SafeAreaView style={s.safe}>
  <View style={s.header}>
   <Pressable onPress={()=>{if(selected){commentRequestId.current++;setSelected(null);setComments([]);}else router.push("/");}}><><Ionicons name="chevron-back" size={16} color={C.muted} /><Text style={s.back}>{selected?"목록":"지도"}</Text></></Pressable>
   <Text style={s.heading}>발레 커뮤니티</Text>
   <View style={{flexDirection:"row",alignItems:"center"}}><Pressable style={s.writeBtn} onPress={()=>userId?setComposer(true):requireLogin()}><Text style={s.writeText}>＋ 글쓰기</Text></Pressable><Pressable style={s.menuBtn} onPress={()=>{if(router.canGoBack())router.back();else router.replace("/");}}><Ionicons name="menu-outline" size={22} color={C.ink} /></Pressable></View>
  </View>
  {selected?
   <ScrollView contentContainerStyle={s.detailContent} keyboardShouldPersistTaps="handled">
    <View style={s.postDetail}>
     <View style={s.categoryBadge}><Text style={s.categoryText}>{selected.category}</Text></View>
     <Text style={s.postTitle}>{selected.title}</Text>
     <Text style={s.meta}>{selected.author_name||"발레메이트 회원"} · {timeLabel(selected.created_at)}</Text>
     <Text style={s.postBody}>{selected.content}</Text>
     {selected.author_id===userId?<Pressable onPress={()=>removePost(selected)}><Text style={s.deleteText}>게시글 삭제</Text></Pressable>:<View style={s.moderationActions}><Pressable onPress={()=>reportContent("post",selected.id,selected.author_id)}><Text style={s.deleteText}>신고</Text></Pressable><Pressable onPress={()=>blockUser(selected.author_id,selected.author_name||"해당")}><Text style={s.deleteText}>차단</Text></Pressable></View>}
    </View>
    <Text style={s.section}>댓글 {comments.length}</Text>
    {comments.filter(comment=>!blockedUserIds.includes(comment.author_id)).map(comment=><View key={comment.id} style={s.comment}>
     <View style={s.commentTop}><Text style={s.commentAuthor}>{comment.author_name||"발레메이트 회원"}</Text><Text style={s.meta}>{timeLabel(comment.created_at)}</Text></View>
     <Text style={s.commentBody}>{comment.content}</Text>
     {comment.author_id===userId?<Pressable onPress={()=>removeComment(comment)}><Text style={s.deleteText}>삭제</Text></Pressable>:<View style={s.moderationActions}><Pressable onPress={()=>reportContent("comment",comment.id,comment.author_id)}><Text style={s.deleteText}>신고</Text></Pressable><Pressable onPress={()=>blockUser(comment.author_id,comment.author_name||"해당")}><Text style={s.deleteText}>차단</Text></Pressable></View>}
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
      <View style={s.cardFoot}><Text style={s.author}>{item.author_name||"발레메이트 회원"}</Text><Text style={s.openLabel}>댓글 보기 ›</Text></View>
     </Pressable>} ListEmptyComponent={loadError?<View><Text style={s.empty}>게시글을 불러오지 못했습니다.</Text><Pressable onPress={()=>{setLoading(true);loadPosts();}}><Text style={s.openLabel}>다시 시도</Text></Pressable></View>:<Text style={s.empty}>아직 게시글이 없습니다. 첫 추천을 남겨보세요!</Text>}/>
    }
   </>
  }

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
     <Text style={s.cooldownNote}>게시글 등록 후 30초 동안 댓글을 포함한 새 작성이 제한됩니다.</Text>
     <Pressable style={[s.submitBtn,submitting&&{opacity:.5}]} disabled={submitting} onPress={submitPost}><Text style={s.submitText}>{submitting?"등록 중…":"게시글 등록"}</Text></Pressable>
    </View>
   </KeyboardAvoidingView>
  </Modal>
 </SafeAreaView>;
}

const s=StyleSheet.create({
 safe:{flex:1,backgroundColor:C.bg},header:{minHeight:56,paddingVertical:7,paddingHorizontal:12,flexDirection:"row",alignItems:"center",justifyContent:"space-between",gap:6,borderBottomWidth:1,borderColor:C.line},
 back:{color:C.muted,fontWeight:"700",fontSize:12,width:52},heading:{fontSize:16,fontWeight:"900",color:C.ink,flexShrink:1,textAlign:"center"},writeBtn:{backgroundColor:C.purple,borderRadius:10,paddingHorizontal:9,paddingVertical:8},writeText:{color:"#fff",fontSize:11,fontWeight:"800"},menuBtn:{borderWidth:1,borderColor:C.line,borderRadius:10,paddingHorizontal:9,paddingVertical:7,marginLeft:5},menuText:{color:C.ink,fontSize:17,fontWeight:"800"},
 intro:{color:C.muted,fontSize:12,paddingHorizontal:18,paddingTop:16},filterScroll:{flexGrow:0,flexShrink:0},filters:{paddingHorizontal:14,paddingVertical:9,gap:6,alignItems:"center"},filter:{paddingHorizontal:11,paddingVertical:7,borderRadius:18,borderWidth:1,borderColor:C.line,backgroundColor:"#fff"},filterActive:{backgroundColor:C.pale,borderColor:C.purple},filterText:{fontSize:12,color:C.muted,fontWeight:"700"},filterTextActive:{color:C.purple},
 list:{padding:12,paddingBottom:24},postCard:{backgroundColor:"#fff",padding:13,borderRadius:16,borderWidth:1,borderColor:C.line,marginBottom:10},postTop:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},categoryBadge:{backgroundColor:C.pale,borderRadius:8,paddingHorizontal:9,paddingVertical:5,alignSelf:"flex-start"},categoryText:{fontSize:10,color:C.purple,fontWeight:"800"},meta:{fontSize:10,color:C.muted},cardTitle:{fontSize:16,fontWeight:"900",color:C.ink,marginTop:11},preview:{fontSize:12,color:"#625E70",lineHeight:18,marginTop:6},cardFoot:{flexDirection:"row",justifyContent:"space-between",marginTop:13},author:{fontSize:11,color:C.muted,fontWeight:"700"},openLabel:{fontSize:11,color:C.purple,fontWeight:"800"},empty:{textAlign:"center",color:C.muted,padding:28,fontSize:13},
 detailContent:{padding:14,paddingBottom:24},postDetail:{backgroundColor:"#fff",borderRadius:17,borderWidth:1,borderColor:C.line,padding:16},postTitle:{fontSize:20,fontWeight:"900",color:C.ink,marginTop:12},postBody:{fontSize:14,color:"#4E4A5C",lineHeight:23,marginTop:20},section:{fontSize:15,fontWeight:"900",color:C.ink,marginTop:22,marginBottom:10},comment:{backgroundColor:"#fff",borderRadius:12,padding:13,marginBottom:8,borderWidth:1,borderColor:C.line},moderationActions:{flexDirection:"row",justifyContent:"flex-end",gap:16,marginTop:10},commentTop:{flexDirection:"row",justifyContent:"space-between"},commentAuthor:{fontSize:12,color:C.ink,fontWeight:"800"},commentBody:{fontSize:13,color:"#555164",lineHeight:20,marginTop:8},deleteText:{fontSize:10,color:C.red,fontWeight:"700",marginTop:10,alignSelf:"flex-end"},
 commentComposer:{flexDirection:"row",alignItems:"flex-end",gap:8,marginTop:15},commentInput:{flex:1,minHeight:44,maxHeight:110,backgroundColor:"#fff",borderRadius:12,borderWidth:1,borderColor:C.line,padding:11,fontSize:13,color:C.ink},sendBtn:{backgroundColor:C.purple,paddingHorizontal:15,paddingVertical:13,borderRadius:11},sendText:{color:"#fff",fontWeight:"800",fontSize:12},cooldownNote:{fontSize:10,color:C.muted,lineHeight:16,marginTop:10},
 shade:{flex:1,backgroundColor:"rgba(30,25,45,0.38)",justifyContent:"flex-end"},modal:{backgroundColor:"#fff",borderTopLeftRadius:22,borderTopRightRadius:22,padding:16,paddingBottom:20,maxHeight:"92%"},modalHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},modalTitle:{fontSize:20,fontWeight:"900",color:C.ink},close:{fontSize:25,color:C.muted},label:{fontSize:12,color:C.ink,fontWeight:"800",marginTop:17,marginBottom:8},categoryChoices:{flexDirection:"row",flexWrap:"wrap",gap:7},titleInput:{height:47,borderWidth:1,borderColor:C.line,borderRadius:11,paddingHorizontal:12,fontSize:13,color:C.ink},bodyInput:{minHeight:140,maxHeight:220,borderWidth:1,borderColor:C.line,borderRadius:11,padding:12,fontSize:13,color:C.ink},submitBtn:{backgroundColor:C.purple,borderRadius:12,padding:15,alignItems:"center",marginTop:15},submitText:{color:"#fff",fontWeight:"900"}
});

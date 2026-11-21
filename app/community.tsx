import React, { useCallback, useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, SafeAreaView, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
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
 const [refreshing,setRefreshing]=useState(false);
 const [submitting,setSubmitting]=useState(false);
 const [composer,setComposer]=useState(false);
 const [newCategory,setNewCategory]=useState<Exclude<Category,"전체">>("학원 추천");
 const [title,setTitle]=useState("");
 const [body,setBody]=useState("");
 const [userId,setUserId]=useState<string|null>(null);

 const loadPosts=useCallback(async()=>{
  if(!supabase){setLoading(false);return;}
  try{
   let query=supabase.from("community_posts").select("id,author_id,author_name,category,title,content,created_at").order("created_at",{ascending:false}).limit(50);
   if(category!=="전체")query=query.eq("category",category);
   const {data,error}=await query;
   if(error)throw error;
   setPosts((data||[]) as Post[]);
  }catch(error:any){Alert.alert("커뮤니티 불러오기 실패",error?.message||"잠시 후 다시 시도해 주세요.");}
  finally{setLoading(false);setRefreshing(false);}
 },[category]);

 useEffect(()=>{loadPosts();},[loadPosts]);
 useEffect(()=>{
  if(!supabase)return;
  supabase.auth.getSession().then(({data})=>setUserId(data.session?.user?.id||null));
  const {data:{subscription}}=supabase.auth.onAuthStateChange((_event,session)=>setUserId(session?.user?.id||null));
  return()=>subscription.unsubscribe();
 },[]);

 const loadComments=async(postId:string)=>{
  if(!supabase)return;
  const {data,error}=await supabase.from("community_comments").select("id,post_id,author_id,author_name,content,created_at").eq("post_id",postId).order("created_at",{ascending:true}).limit(100);
  if(error){Alert.alert("댓글 불러오기 실패",error.message);return;}
  setComments((data||[]) as Comment[]);
 };
 const openPost=async(post:Post)=>{setSelected(post);setComments([]);await loadComments(post.id);};
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
   const {error}=await supabase.from("community_posts").insert({author_id:userId,author_name:"",category:newCategory,title:title.trim(),content:body.trim()});
   if(error)throw error;
   setComposer(false);setTitle("");setBody("");setCategory("전체");setLoading(true);
   await loadPosts();
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
   const {error}=await supabase.from("community_comments").insert({post_id:selected.id,author_id:userId,author_name:"",content:commentText.trim()});
   if(error)throw error;
   setCommentText("");await loadComments(selected.id);
   Alert.alert("등록 완료","댓글이 등록되었습니다.");
  }catch(error:any){explainError(error);}
  finally{setSubmitting(false);}
 };

 const removePost=async(post:Post)=>{
  if(!supabase||post.author_id!==userId)return;
  Alert.alert("게시글 삭제","이 게시글을 삭제할까요?",[{text:"취소",style:"cancel"},{text:"삭제",style:"destructive",onPress:async()=>{
   const {error}=await supabase.from("community_posts").delete().eq("id",post.id);
   if(error){Alert.alert("삭제 실패",error.message);return;}
   setSelected(null);loadPosts();
  }}]);
 };
 const removeComment=async(comment:Comment)=>{
  if(!supabase||comment.author_id!==userId)return;
  Alert.alert("댓글 삭제","이 댓글을 삭제할까요?",[{text:"취소",style:"cancel"},{text:"삭제",style:"destructive",onPress:async()=>{
   const {error}=await supabase.from("community_comments").delete().eq("id",comment.id);
   if(error){Alert.alert("삭제 실패",error.message);return;}
   if(selected)loadComments(selected.id);
  }}]);
 };

 return <SafeAreaView style={s.safe}>
  <View style={s.header}>
   <Pressable onPress={()=>selected?setSelected(null):router.back()}><Text style={s.back}>‹ {selected?"목록":"돌아가기"}</Text></Pressable>
   <Text style={s.heading}>발레 커뮤니티</Text>
   <Pressable style={s.writeBtn} onPress={()=>userId?setComposer(true):requireLogin()}><Text style={s.writeText}>＋ 글쓰기</Text></Pressable>
  </View>
  {selected?
   <ScrollView contentContainerStyle={s.detailContent} keyboardShouldPersistTaps="handled">
    <View style={s.postDetail}>
     <View style={s.categoryBadge}><Text style={s.categoryText}>{selected.category}</Text></View>
     <Text style={s.postTitle}>{selected.title}</Text>
     <Text style={s.meta}>{selected.author_name} · {timeLabel(selected.created_at)}</Text>
     <Text style={s.postBody}>{selected.content}</Text>
     {selected.author_id===userId&&<Pressable onPress={()=>removePost(selected)}><Text style={s.deleteText}>게시글 삭제</Text></Pressable>}
    </View>
    <Text style={s.section}>댓글 {comments.length}</Text>
    {comments.map(comment=><View key={comment.id} style={s.comment}>
     <View style={s.commentTop}><Text style={s.commentAuthor}>{comment.author_name}</Text><Text style={s.meta}>{timeLabel(comment.created_at)}</Text></View>
     <Text style={s.commentBody}>{comment.content}</Text>
     {comment.author_id===userId&&<Pressable onPress={()=>removeComment(comment)}><Text style={s.deleteText}>삭제</Text></Pressable>}
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
    <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filters}>
     {categories.map(item=><Pressable key={item} onPress={()=>setCategory(item)} style={[s.filter,item===category&&s.filterActive]}><Text style={[s.filterText,item===category&&s.filterTextActive]}>{item}</Text></Pressable>)}
    </ScrollView>
    {loading?<ActivityIndicator color={C.purple} style={{marginTop:40}}/>:
     <FlatList data={posts} keyExtractor={item=>item.id} contentContainerStyle={s.list} refreshControl={<RefreshControl refreshing={refreshing} onRefresh={()=>{setRefreshing(true);loadPosts();}} tintColor={C.purple}/>} renderItem={({item})=><Pressable style={s.postCard} onPress={()=>openPost(item)}>
      <View style={s.postTop}><View style={s.categoryBadge}><Text style={s.categoryText}>{item.category}</Text></View><Text style={s.meta}>{timeLabel(item.created_at)}</Text></View>
      <Text style={s.cardTitle} numberOfLines={2}>{item.title}</Text>
      <Text style={s.preview} numberOfLines={2}>{item.content}</Text>
      <View style={s.cardFoot}><Text style={s.author}>{item.author_name}</Text><Text style={s.openLabel}>댓글 보기 ›</Text></View>
     </Pressable>} ListEmptyComponent={<Text style={s.empty}>아직 게시글이 없습니다. 첫 추천을 남겨보세요!</Text>}/>
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
 safe:{flex:1,backgroundColor:C.bg},header:{height:56,paddingHorizontal:17,flexDirection:"row",alignItems:"center",justifyContent:"space-between",borderBottomWidth:1,borderColor:C.line},
 back:{color:C.muted,fontWeight:"700",fontSize:13,width:76},heading:{fontSize:18,fontWeight:"900",color:C.ink},writeBtn:{backgroundColor:C.purple,borderRadius:11,paddingHorizontal:12,paddingVertical:9},writeText:{color:"#fff",fontSize:12,fontWeight:"800"},
 intro:{color:C.muted,fontSize:12,paddingHorizontal:18,paddingTop:16},filters:{paddingHorizontal:16,paddingVertical:13,gap:7},filter:{paddingHorizontal:13,paddingVertical:8,borderRadius:18,borderWidth:1,borderColor:C.line,backgroundColor:"#fff"},filterActive:{backgroundColor:C.pale,borderColor:C.purple},filterText:{fontSize:12,color:C.muted,fontWeight:"700"},filterTextActive:{color:C.purple},
 list:{padding:14,paddingBottom:35},postCard:{backgroundColor:"#fff",padding:15,borderRadius:16,borderWidth:1,borderColor:C.line,marginBottom:10},postTop:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},categoryBadge:{backgroundColor:C.pale,borderRadius:8,paddingHorizontal:9,paddingVertical:5,alignSelf:"flex-start"},categoryText:{fontSize:10,color:C.purple,fontWeight:"800"},meta:{fontSize:10,color:C.muted},cardTitle:{fontSize:16,fontWeight:"900",color:C.ink,marginTop:11},preview:{fontSize:12,color:"#625E70",lineHeight:18,marginTop:6},cardFoot:{flexDirection:"row",justifyContent:"space-between",marginTop:13},author:{fontSize:11,color:C.muted,fontWeight:"700"},openLabel:{fontSize:11,color:C.purple,fontWeight:"800"},empty:{textAlign:"center",color:C.muted,padding:28,fontSize:13},
 detailContent:{padding:16,paddingBottom:35},postDetail:{backgroundColor:"#fff",borderRadius:17,borderWidth:1,borderColor:C.line,padding:16},postTitle:{fontSize:20,fontWeight:"900",color:C.ink,marginTop:12},postBody:{fontSize:14,color:"#4E4A5C",lineHeight:23,marginTop:20},section:{fontSize:15,fontWeight:"900",color:C.ink,marginTop:22,marginBottom:10},comment:{backgroundColor:"#fff",borderRadius:12,padding:13,marginBottom:8,borderWidth:1,borderColor:C.line},commentTop:{flexDirection:"row",justifyContent:"space-between"},commentAuthor:{fontSize:12,color:C.ink,fontWeight:"800"},commentBody:{fontSize:13,color:"#555164",lineHeight:20,marginTop:8},deleteText:{fontSize:10,color:C.red,fontWeight:"700",marginTop:10,alignSelf:"flex-end"},
 commentComposer:{flexDirection:"row",alignItems:"flex-end",gap:8,marginTop:15},commentInput:{flex:1,minHeight:44,maxHeight:110,backgroundColor:"#fff",borderRadius:12,borderWidth:1,borderColor:C.line,padding:11,fontSize:13,color:C.ink},sendBtn:{backgroundColor:C.purple,paddingHorizontal:15,paddingVertical:13,borderRadius:11},sendText:{color:"#fff",fontWeight:"800",fontSize:12},cooldownNote:{fontSize:10,color:C.muted,lineHeight:16,marginTop:10},
 shade:{flex:1,backgroundColor:"rgba(30,25,45,0.38)",justifyContent:"flex-end"},modal:{backgroundColor:"#fff",borderTopLeftRadius:23,borderTopRightRadius:23,padding:20,paddingBottom:30,maxHeight:"92%"},modalHead:{flexDirection:"row",justifyContent:"space-between",alignItems:"center"},modalTitle:{fontSize:20,fontWeight:"900",color:C.ink},close:{fontSize:25,color:C.muted},label:{fontSize:12,color:C.ink,fontWeight:"800",marginTop:17,marginBottom:8},categoryChoices:{flexDirection:"row",flexWrap:"wrap",gap:7},titleInput:{height:47,borderWidth:1,borderColor:C.line,borderRadius:11,paddingHorizontal:12,fontSize:13,color:C.ink},bodyInput:{height:175,borderWidth:1,borderColor:C.line,borderRadius:11,padding:12,fontSize:13,color:C.ink},submitBtn:{backgroundColor:C.purple,borderRadius:12,padding:15,alignItems:"center",marginTop:15},submitText:{color:"#fff",fontWeight:"900"}
});
